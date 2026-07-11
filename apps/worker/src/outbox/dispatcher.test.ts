import { describe, expect, it } from 'vitest';
import type { Tx } from '@proveeduria/agent';
import type { TransactionRunner } from '../domain/types.js';
import {
  despacharOutbox,
  clasificarErrorEnvio,
  ErrorEnvio,
  PgOutboxStore,
} from './dispatcher.js';
import type {
  OutboxMessagePendiente,
  OutboxSender,
  OutboxStore,
  ReclamarInput,
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
  fallidos: { id: string; nextRetryAt: Date; error: string }[] = [];
  descartados: { id: string; error: string }[] = [];
  liberados: string[][] = [];
  reclamos: ReclamarInput[] = [];
  consultasVentana: { destino: string; ahora: Date }[] = [];
  /** Destinos SIN ventana vigente para esta corrida (default: todos vigentes). */
  ventanaCerradaPara = new Set<string>();

  constructor(private readonly messages: readonly OutboxMessagePendiente[]) {}

  async reclamar(input: ReclamarInput): Promise<readonly OutboxMessagePendiente[]> {
    this.reclamos.push(input);
    return this.messages;
  }

  async marcarEnviado(id: string, wamidSalida: string): Promise<void> {
    this.enviados.push({ id, wamidSalida });
  }

  async marcarFallido(id: string, nextRetryAt: Date, error: string): Promise<void> {
    this.fallidos.push({ id, nextRetryAt, error });
  }

  async marcarDescartado(message: OutboxMessagePendiente, error: string): Promise<void> {
    this.descartados.push({ id: message.id, error });
  }

  async liberar(ids: readonly string[]): Promise<void> {
    this.liberados.push([...ids]);
  }

  async ventanaVigentePorDestino(destino: string, ahora: Date): Promise<boolean> {
    this.consultasVentana.push({ destino, ahora });
    return !this.ventanaCerradaPara.has(destino);
  }
}

class FakeSender implements OutboxSender {
  errores = new Map<string, unknown>();

  async enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }> {
    const error = this.errores.get(message.id);
    if (error !== undefined) {
      throw error;
    }
    return { wamidSalida: `wamid.out.${message.id}` };
  }
}

function message(
  id: string,
  overrides: Partial<OutboxMessagePendiente> = {},
): OutboxMessagePendiente {
  return {
    id,
    destino: '+50688880002',
    template: 'notificacion_interna',
    texto: null,
    payload: {},
    intentos: 1, // el claim ya incremento
    maxIntentos: 8,
    attachmentId: null,
    ...overrides,
  };
}

function despachar(store: FakeStore, sender: FakeSender) {
  return despacharOutbox({
    runner: new FakeRunner(),
    sender,
    store: () => store,
    ahora: () => AHORA,
    retryBaseMs: 1_000,
    retryMaxMs: 60_000,
    claimLeaseMs: 300_000,
  });
}

describe('despacharOutbox', () => {
  it('marca enviados, y fallidos transitorios con backoff exponencial por intentos', async () => {
    const store = new FakeStore([
      message('m1'),
      message('m2', { intentos: 3 }), // backoff 1000 * 2^2 = 4s
    ]);
    const sender = new FakeSender();
    sender.errores.set('m2', new Error('timeout'));

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 2, enviados: 1, fallidos: 1, descartados: 0 });
    expect(store.enviados).toEqual([{ id: 'm1', wamidSalida: 'wamid.out.m1' }]);
    expect(store.fallidos).toEqual([
      { id: 'm2', nextRetryAt: new Date('2026-07-08T12:00:04.000Z'), error: 'timeout' },
    ]);
    // El claim recibe el lease correcto.
    expect(store.reclamos[0]?.leaseVencidoAntesDe).toEqual(
      new Date(AHORA.getTime() - 300_000),
    );
  });

  it('descarta de inmediato los errores permanentes (sin reintento)', async () => {
    const store = new FakeStore([message('m1')]);
    const sender = new FakeSender();
    sender.errores.set(
      'm1',
      new ErrorEnvio('permanente', 'plantilla no existe', { codigo: 132001 }),
    );

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 1, enviados: 0, fallidos: 0, descartados: 1 });
    expect(store.descartados).toEqual([{ id: 'm1', error: '[132001] plantilla no existe' }]);
    expect(store.fallidos).toEqual([]);
  });

  it('descarta cuando un transitorio agota max_intentos', async () => {
    const store = new FakeStore([message('m1', { intentos: 8, maxIntentos: 8 })]);
    const sender = new FakeSender();
    sender.errores.set('m1', new Error('red caida'));

    const result = await despachar(store, sender);

    expect(result.descartados).toBe(1);
    expect(store.descartados[0]?.error).toContain('intentos agotados');
  });

  it('ante rate limit: fallido con max(retryAfter, backoff), corta el batch y libera el resto', async () => {
    const store = new FakeStore([message('m1'), message('m2'), message('m3')]);
    const sender = new FakeSender();
    sender.errores.set(
      'm1',
      new ErrorEnvio('rate_limit', 'throttled', { codigo: 80007, retryAfterMs: 30_000 }),
    );

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 3, enviados: 0, fallidos: 1, descartados: 0 });
    // retryAfter (30s) > backoff (1s con intentos=1) -> gana retryAfter.
    expect(store.fallidos).toEqual([
      { id: 'm1', nextRetryAt: new Date('2026-07-08T12:00:30.000Z'), error: '[80007] throttled' },
    ]);
    // m2 y m3 nunca se intentaron: liberados de vuelta a pendiente.
    expect(store.liberados).toEqual([['m2', 'm3']]);
    expect(store.enviados).toEqual([]);
  });

  it('ventana 24h: descarta sesion libre sin ventana vigente sin llamar al sender', async () => {
    const store = new FakeStore([
      message('m1', { destino: '+50688881001', template: null, texto: 'hola' }),
    ]);
    store.ventanaCerradaPara.add('+50688881001');
    const sender = new FakeSender();

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 1, enviados: 0, fallidos: 0, descartados: 1 });
    expect(store.descartados).toEqual([{ id: 'm1', error: 'ventana_24h_cerrada' }]);
    expect(store.enviados).toEqual([]);
    expect(store.fallidos).toEqual([]);
    // La consulta de ventana ocurre ANTES de intentar el envio (nunca llega al sender).
    expect(store.consultasVentana).toEqual([{ destino: '+50688881001', ahora: AHORA }]);
  });

  it('ventana 24h: envia sesion libre cuando la ventana esta vigente', async () => {
    const store = new FakeStore([
      message('m1', { destino: '+50688881001', template: null, texto: 'hola' }),
    ]);
    const sender = new FakeSender();

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 1, enviados: 1, fallidos: 0, descartados: 0 });
    expect(store.enviados).toEqual([{ id: 'm1', wamidSalida: 'wamid.out.m1' }]);
    expect(store.consultasVentana).toEqual([{ destino: '+50688881001', ahora: AHORA }]);
  });

  it('ventana 24h: las plantillas se envian siempre, sin consultar la ventana', async () => {
    const store = new FakeStore([
      message('m1', { destino: '+50688881001', template: 'rfq_solicitud', texto: null }),
    ]);
    store.ventanaCerradaPara.add('+50688881001');
    const sender = new FakeSender();

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 1, enviados: 1, fallidos: 0, descartados: 0 });
    expect(store.enviados).toEqual([{ id: 'm1', wamidSalida: 'wamid.out.m1' }]);
    expect(store.consultasVentana).toEqual([]);
  });

  it('ventana 24h: en un batch mixto, solo la fila de sesion libre sin ventana se descarta', async () => {
    const store = new FakeStore([
      message('m1', { destino: '+50688880002', template: null, texto: 'repregunta' }),
      message('m2', { destino: '+50688881001', template: 'notificacion_interna', texto: null }),
    ]);
    store.ventanaCerradaPara.add('+50688880002');
    const sender = new FakeSender();

    const result = await despachar(store, sender);

    expect(result).toEqual({ tomados: 2, enviados: 1, fallidos: 0, descartados: 1 });
    expect(store.descartados).toEqual([{ id: 'm1', error: 'ventana_24h_cerrada' }]);
    expect(store.enviados).toEqual([{ id: 'm2', wamidSalida: 'wamid.out.m2' }]);
  });
});

describe('clasificarErrorEnvio', () => {
  it('preserva ErrorEnvio y normaliza throws no tipados a transitorio', () => {
    const tipado = new ErrorEnvio('permanente', 'x');
    expect(clasificarErrorEnvio(tipado)).toBe(tipado);
    expect(clasificarErrorEnvio(new Error('y')).tipo).toBe('transitorio');
    expect(clasificarErrorEnvio('z').tipo).toBe('transitorio');
  });
});

describe('PgOutboxStore', () => {
  it('usa SQL parametrizado para reclamar y marcar', async () => {
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
    const lease = new Date('2026-07-08T11:55:00.000Z');

    await store.reclamar({ ahora: AHORA, leaseVencidoAntesDe: lease, limit: 10 });
    await store.marcarEnviado('m1', 'wamid.out.1');
    await store.marcarFallido('m2', new Date('2026-07-08T12:01:00.000Z'), 'timeout');
    await store.marcarDescartado(
      message('m3', { payload: { pedido_id: 'ped-1' } }),
      'plantilla rota',
      AHORA,
    );
    await store.liberar(['m4', 'm5']);

    // Claim: UPDATE con subselect FOR UPDATE SKIP LOCKED + lease + estado enviando.
    expect(queries[0]?.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(queries[0]?.sql).toContain('intentos = intentos + 1');
    expect(queries[0]?.params).toEqual([AHORA, lease, 10, 'enviando']);
    expect(queries[1]?.params).toEqual(['m1', 'wamid.out.1']);
    expect(queries[2]?.params).toEqual([
      'm2',
      new Date('2026-07-08T12:01:00.000Z'),
      'timeout',
    ]);
    // Descartado: UPDATE + audit_event con pedido_id sacado del payload.
    expect(queries[3]?.sql).toContain("estado = 'descartado'");
    expect(queries[4]?.sql).toContain('INSERT INTO audit_events');
    expect(queries[4]?.params?.[0]).toBe('outbox_descartado');
    expect(queries[4]?.params?.[3]).toBe('ped-1');
    // Liberar: vuelve a pendiente revirtiendo el intento del claim.
    expect(queries[5]?.sql).toContain("estado = 'pendiente'");
    expect(queries[5]?.sql).toContain('greatest(intentos - 1, 0)');
    expect(queries[5]?.params).toEqual([['m4', 'm5']]);
  });
});
