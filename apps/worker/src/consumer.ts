/**
 * Loop de consumo del worker.
 *
 * Fase 1: `procesarUno` toma un job de la cola, lo pasa al handler y hace ack; ante fallo
 * hace nack para reintento. `correrLoop` repite hasta que no queden jobs o se cancele.
 *
 * TODO(Fase 2): antes de `handler.manejar(job)` el loop (o el handler) debe tomar el lock
 * advisory de Postgres por `job.pedidoId` (`pg_advisory_xact_lock`) para garantizar orden
 * por pedido; sin `pedidoId` no hay lock (mensajes aun no ligados a un pedido). El backoff
 * de reintento debe pasar a ser exponencial con jitter y respetar `next_retry_at` /
 * visibility timeout del broker en lugar del reencolado inmediato del InMemoryConsumer.
 */

import type { QueueConsumer, Job } from './queue/index.js';
import type { JobHandler, LogSink } from './handlers/echo.js';
import { consoleLogSink } from './handlers/echo.js';

export interface ProcesarUnoDeps {
  readonly consumer: QueueConsumer;
  readonly handler: JobHandler;
  readonly log?: LogSink;
}

/** Resultado de un ciclo de `procesarUno`, util para el loop y para tests. */
export type ResultadoCiclo =
  | { readonly estado: 'vacio' }
  | { readonly estado: 'procesado'; readonly job: Job }
  | { readonly estado: 'reintentar'; readonly job: Job; readonly error: unknown };

/**
 * Procesa a lo sumo un job: poll -> handler -> ack. Si el handler lanza, hace nack y
 * reporta `reintentar` (nunca propaga: el loop decide si continuar). Si la cola esta
 * vacia devuelve `vacio`.
 */
export async function procesarUno(deps: ProcesarUnoDeps): Promise<ResultadoCiclo> {
  const { consumer, handler } = deps;
  const log = deps.log ?? consoleLogSink;

  const job = await consumer.poll();
  if (job === null) {
    return { estado: 'vacio' };
  }

  try {
    await handler.manejar(job);
    await consumer.ack(job);
    return { estado: 'procesado', job };
  } catch (error) {
    // Fallo transitorio: devolvemos el job a la cola. En Fase 2 esto aplica backoff real
    // (ver TODO de cabecera). Nunca perdemos ni duplicamos el efecto de dominio.
    log.info('job.nack', {
      jobId: job.id,
      wamid: job.wamid,
      intento: job.intento,
      error: error instanceof Error ? error.message : String(error),
    });
    await consumer.nack(job);
    return { estado: 'reintentar', job, error };
  }
}

export interface CorrerLoopDeps extends ProcesarUnoDeps {
  /** Senal de cancelacion para apagado ordenado (SIGTERM en el runtime). */
  readonly signal?: AbortSignal;
  /**
   * Si es `true` (default en el stub), el loop termina cuando la cola queda vacia. En
   * produccion (Fase 2) sera `false`: el worker hace long-poll indefinido.
   */
  readonly detenerAlVaciar?: boolean;
  /** Milisegundos de espera entre polls cuando la cola esta vacia (solo si sigue vivo). */
  readonly esperaVacioMs?: number;
}

/**
 * Corre `procesarUno` en bucle hasta que: (a) la cola queda vacia y `detenerAlVaciar`, o
 * (b) el `AbortSignal` se dispara. Devuelve cuantos jobs proceso con exito.
 */
export async function correrLoop(deps: CorrerLoopDeps): Promise<number> {
  const detenerAlVaciar = deps.detenerAlVaciar ?? true;
  const esperaVacioMs = deps.esperaVacioMs ?? 0;
  let procesados = 0;

  while (deps.signal?.aborted !== true) {
    const ciclo = await procesarUno(deps);
    if (ciclo.estado === 'procesado') {
      procesados += 1;
      continue;
    }
    if (ciclo.estado === 'reintentar') {
      continue;
    }
    // estado === 'vacio'
    if (detenerAlVaciar) {
      break;
    }
    if (esperaVacioMs > 0) {
      await esperar(esperaVacioMs, deps.signal);
    }
  }

  return procesados;
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}
