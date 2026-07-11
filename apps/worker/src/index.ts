/**
 * Composition root del worker.
 *
 * `planificarArranque` es una FUNCION PURA que traduce la `WorkerConfig` en una descripcion
 * de modo (que handler, que consumer, si corre el dispatcher de outbox) mas advertencias —
 * es la matriz testeable de decisiones de arranque, sin efectos secundarios. `main()` es el
 * unico lugar impuro: lee ese plan, abre el `Pool` de Postgres / crea el consumer real y
 * corre los loops con apagado ordenado por SIGTERM/SIGINT.
 *
 * `arrancar` sigue siendo el ensamblador parametrizable del loop de consumo (usado por tests
 * y por `main`): acepta un `QueueConsumer`/handler inyectado para evitar procesos colgados.
 *
 * Modos (ver `planificarArranque`):
 *   - Sin DATABASE_URL  -> stub dev: handler echo + InMemoryConsumer, outbox off.
 *   - Con DATABASE_URL  -> dominio real (router/E11 + engine estructurado); consumer Azure si
 *                          hay AZURE_STORAGE_QUEUE_CONNECTION, si no InMemory con advertencia.
 *   - WORKER_OUTBOX_MODE=console (solo con DB) -> loop de dispatcher con `ConsoleSender`.
 *   - WORKER_OUTBOX_MODE=meta (solo con DB)    -> loop de dispatcher con `MetaOutboxSender`
 *                                                 (envio real; requiere META_PHONE_NUMBER_ID
 *                                                 y META_ACCESS_TOKEN, ver config.ts).
 *
 * TODO(Fase 2 A5): loop Claude model-backed y extractores. Ver apps/worker/CLAUDE.md y
 * docs/PLAN_FASE2A_2B_CONTROL_CENTER.md.
 */

import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { QueueConsumer } from './queue/index.js';
import { InMemoryConsumer } from './queue/index.js';
import { AzureQueueConsumer } from './queue/azure.js';
import type { JobHandler, LogSink } from './handlers/echo.js';
import { crearEchoHandler, consoleLogSink } from './handlers/echo.js';
import { correrLoop } from './consumer.js';
import type { WorkerConfig } from './config.js';
import { cargarConfig } from './config.js';
import { crearDomainHandler, PgTransactionRunner } from './domain/handler.js';
import { crearStructuredToolEngine } from './domain/structured-engine.js';
import type { TransactionRunner } from './domain/types.js';
import { despacharOutbox } from './outbox/dispatcher.js';
import type { OutboxMessagePendiente, OutboxSender } from './outbox/dispatcher.js';
import { MetaOutboxSender } from './outbox/meta-sender.js';

export interface ArrancarDeps {
  readonly config?: WorkerConfig;
  readonly consumer?: QueueConsumer;
  readonly handler?: JobHandler;
  readonly log?: LogSink;
  readonly signal?: AbortSignal;
  /** En el stub el loop termina al vaciar la cola; como proceso real es long-poll (false). */
  readonly detenerAlVaciar?: boolean;
}

/** Arma y corre el loop de consumo. Devuelve la cantidad de jobs procesados con exito. */
export async function arrancar(deps: ArrancarDeps = {}): Promise<number> {
  const config = deps.config ?? cargarConfig();
  const log = deps.log ?? consoleLogSink;
  const consumer = deps.consumer ?? new InMemoryConsumer();
  const handler = deps.handler ?? crearEchoHandler(log);
  const detenerAlVaciar = deps.detenerAlVaciar ?? true;

  const procesados = await correrLoop({
    consumer,
    handler,
    log,
    detenerAlVaciar,
    esperaVacioMs: config.esperaVacioMs,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });

  return procesados;
}

/** Handler a montar segun la config. */
export type ModoHandler = 'echo' | 'dominio';
/** Consumer a montar segun la config. */
export type ModoConsumer = 'memoria' | 'azure';
/** Modo del dispatcher de outbox resuelto para el arranque. */
export type ModoOutbox = 'off' | 'console' | 'meta';

/** Descripcion (pura, sin efectos) del arranque que `main` debe materializar. */
export interface PlanArranque {
  readonly handler: ModoHandler;
  readonly consumer: ModoConsumer;
  readonly outbox: ModoOutbox;
  /** Mensajes a loguear al arrancar (degradaciones/omisiones), en orden. */
  readonly advertencias: readonly string[];
}

/**
 * Selecciona el modo de arranque a partir de la config. Funcion pura: no abre conexiones ni
 * crea objetos con IO — solo decide y explica. `main` la materializa.
 *
 * Reglas:
 *   - Sin `databaseUrl`: modo stub dev (echo + InMemory, outbox off). Si se pidio outbox
 *     `console` o `meta`, se advierte y se desactiva (el dispatcher necesita Postgres).
 *   - Con `databaseUrl`: dominio real. Consumer Azure si hay `azureQueueConnection`; si no,
 *     InMemory con advertencia (no durable, solo dev/test). El outbox toma `config.outboxMode`.
 */
export function planificarArranque(config: WorkerConfig): PlanArranque {
  const advertencias: string[] = [];
  const tieneDb = config.databaseUrl !== undefined;
  const tieneAzure = config.azureQueueConnection !== undefined;

  if (!tieneDb) {
    if (config.outboxMode === 'console' || config.outboxMode === 'meta') {
      advertencias.push(
        `WORKER_OUTBOX_MODE=${config.outboxMode} requiere DATABASE_URL (el dispatcher usa Postgres): outbox desactivado.`,
      );
    }
    return { handler: 'echo', consumer: 'memoria', outbox: 'off', advertencias };
  }

  if (!tieneAzure) {
    advertencias.push(
      'DATABASE_URL presente sin AZURE_STORAGE_QUEUE_CONNECTION: se usa InMemoryConsumer (solo dev/test, no durable).',
    );
  }

  return {
    handler: 'dominio',
    consumer: tieneAzure ? 'azure' : 'memoria',
    outbox: config.outboxMode,
    advertencias,
  };
}

/**
 * Sender de outbox de desarrollo: NO envia por WhatsApp. Loguea el mensaje y devuelve un
 * `wamid_salida` sintetico (`console:<uuid>`) para que el dispatcher lo marque `enviado`.
 * El sender real de Meta llega en A3 del plan; `console` solo desatasca el outbox en dev.
 */
export class ConsoleSender implements OutboxSender {
  constructor(private readonly log: LogSink) {}

  enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }> {
    const wamidSalida = `console:${randomUUID()}`;
    this.log.info('worker.outbox_console', {
      id: message.id,
      destino: message.destino,
      template: message.template,
      texto: message.texto,
      wamidSalida,
    });
    return Promise.resolve({ wamidSalida });
  }
}

interface CorrerLoopOutboxDeps {
  readonly runner: TransactionRunner;
  readonly sender: OutboxSender;
  readonly intervaloMs: number;
  readonly signal: AbortSignal;
  readonly log: LogSink;
  /** Lease del claim, en ms (`OUTBOX_CLAIM_LEASE_S` * 1000). */
  readonly claimLeaseMs: number;
  /** Tamano del batch por ciclo (`OUTBOX_BATCH`). */
  readonly limit: number;
}

/** Corre `despacharOutbox` en bucle cada `intervaloMs` hasta que el `signal` se dispare. */
async function correrLoopOutbox(deps: CorrerLoopOutboxDeps): Promise<void> {
  while (!deps.signal.aborted) {
    try {
      const resultado = await despacharOutbox({
        runner: deps.runner,
        sender: deps.sender,
        claimLeaseMs: deps.claimLeaseMs,
        limit: deps.limit,
      });
      if (resultado.tomados > 0) {
        deps.log.info('worker.outbox_despacho', { ...resultado });
      }
    } catch (error) {
      deps.log.info('worker.outbox_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (deps.signal.aborted) break;
    await esperar(deps.intervaloMs, deps.signal);
  }
}

/** Espera `ms` o hasta que el `signal` aborte, lo que ocurra primero. Sin timers colgados. */
function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Registra el apagado ordenado y arranca en modo long-poll (uso como proceso real). */
function main(): void {
  const config = cargarConfig();
  const plan = planificarArranque(config);
  const log = consoleLogSink;

  log.info('worker.arranque', {
    handler: plan.handler,
    consumer: plan.consumer,
    outbox: plan.outbox,
    queueName: config.queueName,
  });
  for (const advertencia of plan.advertencias) {
    log.info('worker.advertencia', { mensaje: advertencia });
  }

  const abort = new AbortController();
  const pool = config.databaseUrl !== undefined
    ? new Pool({ connectionString: config.databaseUrl })
    : null;
  const runner = pool !== null ? new PgTransactionRunner(pool) : null;

  const handler: JobHandler = plan.handler === 'dominio' && runner !== null
    ? crearDomainHandler({ runner, engine: crearStructuredToolEngine(), log })
    : crearEchoHandler(log);

  const consumer: QueueConsumer = plan.consumer === 'azure'
    && config.azureQueueConnection !== undefined
    ? new AzureQueueConsumer({
        connectionString: config.azureQueueConnection,
        queueName: config.queueName,
        visibilidadSegundos: config.visibilidadSegundos,
        maxDequeue: config.maxDequeue,
      })
    : new InMemoryConsumer();

  const loops: Promise<unknown>[] = [
    arrancar({ config, consumer, handler, detenerAlVaciar: false, signal: abort.signal, log }),
  ];

  if ((plan.outbox === 'console' || plan.outbox === 'meta') && runner !== null) {
    const sender: OutboxSender = plan.outbox === 'meta'
      ? new MetaOutboxSender({
          graphUrl: config.metaGraphUrl,
          // Falla-cerrado en cargarConfig garantiza los cuatro definidos cuando outboxMode='meta'.
          phoneNumberId: config.metaPhoneNumberId as string,
          accessToken: config.metaAccessToken as string,
          publicApiUrl: config.publicApiUrl as string,
          attachmentsLinkSecret: config.attachmentsLinkSecret as string,
        })
      : new ConsoleSender(log);
    loops.push(
      correrLoopOutbox({
        runner,
        sender,
        intervaloMs: config.outboxPollMs,
        signal: abort.signal,
        log,
        claimLeaseMs: config.claimLeaseSegundos * 1000,
        limit: config.outboxBatch,
      }),
    );
  }

  const apagar = (sig: string): void => {
    log.info('worker.senal', { sig });
    abort.abort();
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));

  void (async (): Promise<void> => {
    try {
      await Promise.all(loops);
    } catch (error: unknown) {
      log.info('worker.error_fatal', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
    } finally {
      if (pool !== null) {
        await pool.end();
      }
      log.info('worker.detenido', {});
    }
  })();
}

// Ejecuta `main` solo cuando se corre como entrypoint (no al importarse en tests).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
