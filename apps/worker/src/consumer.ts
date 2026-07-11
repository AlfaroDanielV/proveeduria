/**
 * Loop de consumo del worker.
 *
 * `procesarUno` toma un job de la cola, lo pasa al handler y hace ack; ante fallo del
 * handler hace nack para reintento (el backoff real vive en `AzureQueueConsumer.nack`,
 * ver docs/specs/broker-colas.md). `correrLoop` repite hasta que no queden jobs o se
 * cancele.
 *
 * Resiliencia ante el broker: un `poll()`/`ack()`/`nack()` que lanza (blip transitorio de
 * Azure) NUNCA debe tumbar el proceso del worker — se reporta como ciclo `error_broker` y
 * el loop espera y sigue. La reentrega es segura: idempotencia por `processed_at`/`wamid`.
 *
 * El lock advisory por `pedido_id` vive en el domain handler (`pg_advisory_xact_lock`);
 * aqui no se toma ningun lock.
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
  | { readonly estado: 'reintentar'; readonly job: Job; readonly error: unknown }
  | { readonly estado: 'error_broker'; readonly error: unknown };

/**
 * Procesa a lo sumo un job: poll -> handler -> ack. Si el handler lanza, hace nack y
 * reporta `reintentar`; si el broker lanza (poll/ack/nack), reporta `error_broker`.
 * Nunca propaga: el loop decide si continuar. Si la cola esta vacia devuelve `vacio`.
 */
export async function procesarUno(deps: ProcesarUnoDeps): Promise<ResultadoCiclo> {
  const { consumer, handler } = deps;
  const log = deps.log ?? consoleLogSink;

  let job: Job | null;
  try {
    job = await consumer.poll();
  } catch (error) {
    log.info('broker.error_poll', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { estado: 'error_broker', error };
  }
  if (job === null) {
    return { estado: 'vacio' };
  }

  try {
    await handler.manejar(job);
    await consumer.ack(job);
    return { estado: 'procesado', job };
  } catch (error) {
    // Fallo del handler (o del ack): devolvemos el job a la cola con nack; el backoff
    // real lo aplica el broker (visibility timeout). Nunca perdemos ni duplicamos el
    // efecto de dominio: el handler es idempotente por `processed_at`/`wamid`.
    log.info('job.nack', {
      jobId: job.id,
      wamid: job.wamid,
      intento: job.intento,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await consumer.nack(job);
    } catch (errorNack) {
      // Un nack fallido no es fatal: la visibilidad del broker expira sola y el mensaje
      // reaparece (at-least-once); solo se registra.
      log.info('broker.error_nack', {
        jobId: job.id,
        wamid: job.wamid,
        error: errorNack instanceof Error ? errorNack.message : String(errorNack),
      });
    }
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
    if (ciclo.estado === 'error_broker') {
      // Blip transitorio del broker: en modo one-shot (stub/tests) se corta; como proceso
      // real se espera (minimo 1s para no girar en caliente ante una caida sostenida) y
      // se reintenta el poll.
      if (detenerAlVaciar) {
        break;
      }
      await esperar(Math.max(esperaVacioMs, 1000), deps.signal);
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

/** Espera `ms` o hasta que el `signal` aborte. Sin timers ni listeners colgados. */
function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
