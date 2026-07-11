/**
 * Cron E1 — vencimiento de plazos de cotizacion (spec agente-conversacional.md §A7).
 *
 * Loop de timer del worker, mismo patron que el dispatcher de outbox (`correrLoopOutbox`):
 * cada `intervaloMs` abre una transaccion, toma un advisory lock transaccional para que solo
 * una replica corra el ciclo, construye el `Ctx` de sistema (`crearCtxSistema`) y delega en
 * `procesarVencimientos` de `@proveeduria/agent`. Si otra replica tiene el lock, el ciclo se
 * salta sin bloquear.
 */

import { crearCtxSistema, procesarVencimientos } from '@proveeduria/agent';
import type { LogSink } from '../handlers/echo.js';
import type { TransactionRunner } from '../domain/types.js';

/** Clave del advisory lock; una sola replica corre el barrido E1 por ciclo. */
const CLAVE_LOCK_CRON_E1 = 'cron:e1';

export interface CorrerLoopCronE1Deps {
  readonly runner: TransactionRunner;
  /** Intervalo entre ciclos, en ms (`WORKER_CRON_POLL_MS`). */
  readonly intervaloMs: number;
  readonly signal: AbortSignal;
  readonly log: LogSink;
  /** Reloj inyectable (tests); por defecto `new Date()` en cada ciclo. */
  readonly ahora?: () => Date;
}

interface AdvisoryLockRow {
  readonly locked: boolean;
}

/** Corre el barrido E1 en bucle cada `intervaloMs` hasta que el `signal` se dispare. */
export async function correrLoopCronE1(deps: CorrerLoopCronE1Deps): Promise<void> {
  const ahora = deps.ahora ?? ((): Date => new Date());
  while (!deps.signal.aborted) {
    try {
      await deps.runner.run(async (tx) => {
        const lock = await tx.query<AdvisoryLockRow>(
          'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
          [CLAVE_LOCK_CRON_E1],
        );
        if (lock.rows[0]?.locked !== true) {
          // Otra replica corre este ciclo; nos saltamos sin bloquear (el lock se libera al
          // terminar aquella transaccion).
          return;
        }
        const now = ahora();
        const ctx = crearCtxSistema({ tx, ahora: now, origen: 'cron' });
        const resultado = await procesarVencimientos(ctx, now);
        if (resultado.vencidas > 0 || resultado.pedidosTransicionados > 0) {
          deps.log.info('worker.cron_e1', { ...resultado });
        }
      });
    } catch (error) {
      deps.log.info('worker.cron_e1_error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (deps.signal.aborted) break;
    await esperar(deps.intervaloMs, deps.signal);
  }
}

/**
 * Espera `ms` o hasta que el `signal` aborte, lo que ocurra primero. Copia local del helper
 * homonimo de `index.ts` (mismo patron) para no acoplar el cron al composition root.
 */
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
