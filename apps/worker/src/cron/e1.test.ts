/**
 * Loop del cron E1: advisory lock (skip entre replicas), ejecucion de procesarVencimientos y
 * resiliencia a errores. Usa una `Tx`/`TransactionRunner` fake (sin Postgres): la query del
 * advisory lock devuelve `{ locked }` configurable y el resto devuelve filas vacias, con lo
 * que `procesarVencimientos` corta temprano (marcarVencidas -> []).
 */

import { describe, expect, it } from 'vitest';
import type { Tx } from '@proveeduria/agent';
import { correrLoopCronE1 } from './e1.js';
import type { TransactionRunner } from '../domain/types.js';
import type { LogSink } from '../handlers/echo.js';

class FakeTx implements Tx {
  readonly queries: { sql: string; params: readonly unknown[] }[] = [];

  constructor(private readonly locked: boolean) {}

  async query<T = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    if (sql.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ locked: this.locked } as unknown as T], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
}

interface FakeRunnerOpts {
  readonly locked: boolean;
  readonly abortAfter: number;
  readonly controller: AbortController;
  /** Numeros de ciclo (1-based) en los que `run` lanza para probar la resiliencia. */
  readonly lanzarEnCiclos?: readonly number[];
}

class FakeRunner implements TransactionRunner {
  runs = 0;
  readonly txs: FakeTx[] = [];

  constructor(private readonly opts: FakeRunnerOpts) {}

  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.runs += 1;
    const tx = new FakeTx(this.opts.locked);
    this.txs.push(tx);
    try {
      if (this.opts.lanzarEnCiclos?.includes(this.runs) === true) {
        throw new Error(`fallo-ciclo-${this.runs}`);
      }
      return await fn(tx);
    } finally {
      if (this.runs >= this.opts.abortAfter) this.opts.controller.abort();
    }
  }
}

function fakeLog(): {
  log: LogSink;
  eventos: { evento: string; datos: Record<string, unknown> }[];
} {
  const eventos: { evento: string; datos: Record<string, unknown> }[] = [];
  return {
    log: {
      info: (evento, datos): void => {
        eventos.push({ evento, datos });
      },
    },
    eventos,
  };
}

describe('correrLoopCronE1', () => {
  it('sin el advisory lock salta el ciclo sin barrer vencimientos', async () => {
    const controller = new AbortController();
    const runner = new FakeRunner({ locked: false, abortAfter: 1, controller });
    const { log, eventos } = fakeLog();

    await correrLoopCronE1({ runner, intervaloMs: 60000, signal: controller.signal, log });

    expect(runner.runs).toBe(1);
    const tx = runner.txs[0];
    expect(tx?.queries).toHaveLength(1);
    expect(tx?.queries[0]?.sql).toContain('pg_try_advisory_xact_lock');
    expect(eventos.map((e) => e.evento)).not.toContain('worker.cron_e1');
  });

  it('con el advisory lock ejecuta procesarVencimientos (marcarVencidas)', async () => {
    const controller = new AbortController();
    const runner = new FakeRunner({ locked: true, abortAfter: 1, controller });
    const { log } = fakeLog();

    await correrLoopCronE1({ runner, intervaloMs: 60000, signal: controller.signal, log });

    expect(runner.runs).toBe(1);
    const sqls = runner.txs[0]?.queries.map((q) => q.sql) ?? [];
    expect(sqls.some((sql) => sql.includes('pg_try_advisory_xact_lock'))).toBe(true);
    expect(sqls.some((sql) => sql.includes("UPDATE quote_requests SET estado = 'vencida'"))).toBe(true);
  });

  it('un error en un ciclo se loguea y el loop continua', async () => {
    const controller = new AbortController();
    const runner = new FakeRunner({
      locked: true,
      abortAfter: 2,
      controller,
      lanzarEnCiclos: [1],
    });
    const { log, eventos } = fakeLog();

    await correrLoopCronE1({ runner, intervaloMs: 1, signal: controller.signal, log });

    expect(runner.runs).toBe(2);
    const error = eventos.find((e) => e.evento === 'worker.cron_e1_error');
    expect(error?.datos.error).toContain('fallo-ciclo-1');
  });
});
