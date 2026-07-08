import { describe, expect, it } from 'vitest';
import type { Tx } from '@proveeduria/agent';
import type { DomainEngineInput, InboundMessage } from './types.js';
import { crearStructuredToolEngine } from './structured-engine.js';

const AHORA = new Date('2026-07-08T12:00:00.000Z');

class FakeTx implements Tx {
  readonly queries: { sql: string; params: readonly unknown[] }[] = [];

  async query<T = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }
}

function input(payload: unknown, tx: Tx): DomainEngineInput {
  const mensaje: InboundMessage = {
    id: '70000000-0000-4000-8000-000000000001',
    wamid: 'wamid.1',
    fromPhone: '+50688880002',
    tipo: 'texto',
    payload,
    receivedAt: AHORA,
    processedAt: null,
  };
  return {
    job: {
      id: 'job-1',
      wamid: 'wamid.1',
      fromPhone: '+50688880002',
      tipo: 'texto',
      payload,
      recibidoEn: AHORA.toISOString(),
      intento: 1,
    },
    mensaje,
    contexto: {
      tipo: 'desconocido',
      telefonoWhatsapp: '+50688880002',
    },
    tx,
    ahora: AHORA,
  };
}

describe('crearStructuredToolEngine', () => {
  it('audita mensajes sin tool_call sin ejecutar herramientas', async () => {
    const tx = new FakeTx();
    const engine = crearStructuredToolEngine();

    await engine.procesar(input({ text: 'hola' }, tx));

    expect(tx.queries).toHaveLength(1);
    expect(tx.queries[0]?.params[2]).toBe('worker_mensaje_sin_tool_call');
    expect(tx.queries[0]?.params[5]).toBe(JSON.stringify({
      wamid: 'wamid.1',
      remitente: 'desconocido',
    }));
  });

  it('rechaza tool_call estructurado sin Ctx interno y lo responde por outbox', async () => {
    const tx = new FakeTx();
    const engine = crearStructuredToolEngine();

    await engine.procesar(input({
      tool_call: {
        name: 'generar_comparativo',
        input: { pedidoId: 'pedido-1' },
      },
    }, tx));

    expect(tx.queries).toHaveLength(2);
    expect(tx.queries[0]?.params[2]).toBe('worker_tool_call');
    expect(tx.queries[1]?.sql).toContain('INSERT INTO outbox_messages');
    expect(tx.queries[1]?.params[0]).toBe('+50688880002');
  });
});
