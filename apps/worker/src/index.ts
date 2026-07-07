/**
 * Punto de arranque del worker (stub navegable de Fase 1).
 *
 * Arma las dependencias (config + cola + handler echo) y corre el loop de consumo con
 * apagado ordenado por SIGTERM/SIGINT. `arrancar` es parametrizable para poder inyectar
 * un `QueueConsumer` de test y evitar procesos colgados.
 *
 * TODO(Fase 2): sustituir `InMemoryConsumer` por el consumidor real del broker, el handler
 * echo por el motor de dominio (agente + state-machine + outbox) y abrir el pool de
 * Postgres con `config.databaseUrl`. Ver apps/worker/CLAUDE.md.
 */

import type { QueueConsumer } from './queue/index.js';
import { InMemoryConsumer } from './queue/index.js';
import type { JobHandler, LogSink } from './handlers/echo.js';
import { crearEchoHandler, consoleLogSink } from './handlers/echo.js';
import { correrLoop } from './consumer.js';
import type { WorkerConfig } from './config.js';
import { cargarConfig } from './config.js';

export interface ArrancarDeps {
  readonly config?: WorkerConfig;
  readonly consumer?: QueueConsumer;
  readonly handler?: JobHandler;
  readonly log?: LogSink;
  readonly signal?: AbortSignal;
  /** En el stub el loop termina al vaciar la cola; en Fase 2 sera long-poll (false). */
  readonly detenerAlVaciar?: boolean;
}

/** Arma y corre el worker. Devuelve la cantidad de jobs procesados con exito. */
export async function arrancar(deps: ArrancarDeps = {}): Promise<number> {
  const config = deps.config ?? cargarConfig();
  const log = deps.log ?? consoleLogSink;
  const consumer = deps.consumer ?? new InMemoryConsumer();
  const handler = deps.handler ?? crearEchoHandler(log);
  const detenerAlVaciar = deps.detenerAlVaciar ?? true;

  log.info('worker.arranque', {
    queueName: config.queueName,
    tieneDb: config.databaseUrl !== undefined,
    fase: 1,
  });

  const procesados = await correrLoop({
    consumer,
    handler,
    log,
    detenerAlVaciar,
    esperaVacioMs: config.esperaVacioMs,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });

  log.info('worker.detenido', { procesados });
  return procesados;
}

/** Registra el apagado ordenado y arranca en modo long-poll (uso como proceso real). */
function main(): void {
  const abort = new AbortController();
  const apagar = (sig: string) => {
    consoleLogSink.info('worker.senal', { sig });
    abort.abort();
  };
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));

  arrancar({ detenerAlVaciar: false, signal: abort.signal }).catch((error: unknown) => {
    consoleLogSink.info('worker.error_fatal', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}

// Ejecuta `main` solo cuando se corre como entrypoint (no al importarse en tests).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
