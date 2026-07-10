import { describe, expect, it } from 'vitest';
import type { Tx } from '@proveeduria/agent';
import type { TransactionRunner } from '../domain/types.js';
import {
  despacharOutbox,
  PgOutboxStore,
} from './dispatcher.js';
import type {
  OutboxMessagePendiente,
  OutboxSender,
  OutboxStore,
} from './dispatcher.js';

const AHORA = new Date('2026-07-08T12:00:00.000Z');

class FakeRunner implements TransactionRunner {
  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({
      async query<TQuery = unknown>(): Promise<{ rows: TQuery[]; rowCount: number }> {
        return { rows: [], rowCount: 0 };
      },
    });
  }
}

class FakeStore implements OutboxStore {
  enviados: { id: string; wamidSalida: string }[] = [];
  fallidos: { id: string; nextRetryAt: Date }[] = [];

  constructor(private readonly messages: readonly OutboxMessagePendiente[]) {}

  async tomarPendientes(_now: Date, _limit: number): Promise<readonly OutboxMessagePendiente[]> {
    return this.messages;
  }

  async marcarEnviado(id: string, wamidSalida: string): Promise<void> {
    this.enviados.push({ id, wamidSalida });
  }

  async marcarFallido(id: string, nextRetryAt: Date): Promise<void> {
    this.fallidos.push({ id, nextRetryAt });
  }
}

class FakeSender implements OutboxSender {
  failIds = new Set<string>();

  async enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }> {
    if (this.failIds.has(message.id)) {
      throw new Error('fallo envio');
    }
    return { wamidSalida: `wamid.out.${message.id}` };
  }
}

function message(id: string, overrides: Partial<OutboxMessagePendiente> = {}): OutboxMessagePendiente {
  return {
    id,
    destino: '+50688880002',
    template: 'notificacion_interna',
    texto: null,
    payload: {},
    intentos: 0,
    ...overrides,
  };
}

describe('despacharOutbox', () => {
  it('marca enviados y fallidos con retry exponencial', async () => {
    const store = new FakeStore([
      message('m1'),
      message('m2', { intentos: 2 }),
    ]);
    const sender = new FakeSender();
    sender.failIds.add('m2');

    const result = await despacharOutbox({
      runner: new FakeRunner(),
      sender,
      store: () => store,
      ahora: () => AHORA,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
    });

    expect(result).toEqual({ tomados: 2, enviados: 1, fallidos: 1 });
    expect(store.enviados).toEqual([{ id: 'm1', wamidSalida: 'wamid.out.m1' }]);
    expect(store.fallidos).toEqual([
      { id: 'm2', nextRetryAt: new Date('2026-07-08T12:00:04.000Z') },
    ]);
  });
});

describe('PgOutboxStore', () => {
  it('usa SQL parametrizado para tomar y actualizar outbox', async () => {
    const queries: { sql: string; params: readonly unknown[] }[] = [];
    const tx: Tx = {
      async query<T = unknown>(
        sql: string,
        params: readonly unknown[] = [],
      ): Promise<{ rows: T[]; rowCount: number }> {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    };
    const store = new PgOutboxStore(tx);

    await store.tomarPendientes(AHORA, 10);
    await store.marcarEnviado('m1', 'wamid.out.1');
    await store.marcarFallido('m2', new Date('2026-07-08T12:01:00.000Z'));

    expect(queries[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(queries[0]?.params).toEqual([AHORA, 10]);
    expect(queries[1]?.params).toEqual(['m1', 'wamid.out.1']);
    expect(queries[2]?.params).toEqual(['m2', new Date('2026-07-08T12:01:00.000Z')]);
  });
});
