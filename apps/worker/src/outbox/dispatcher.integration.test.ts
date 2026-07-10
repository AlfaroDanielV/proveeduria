import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PgTransactionRunner } from '../domain/handler.js';
import { despacharOutbox } from './dispatcher.js';
import type { OutboxMessagePendiente, OutboxSender } from './dispatcher.js';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = DATABASE_URL?.includes('provee_test') === true;
const describeIntegration = runIntegration ? describe : describe.skip;

class FakeSender implements OutboxSender {
  async enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }> {
    return { wamidSalida: `wamid.sent.${message.id}` };
  }
}

describeIntegration('outbox dispatcher con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('toma pendiente, envia y marca wamid_salida', async () => {
    const destino = `+5068${randomUUID().slice(0, 8)}`;
    const insert = await pool.query<{ id: string }>(
      'INSERT INTO outbox_messages (destino, texto, payload, created_at) ' +
        "VALUES ($1, $2, $3::jsonb, '2000-01-01T00:00:00.000Z') RETURNING id",
      [
        destino,
        'Mensaje de prueba',
        JSON.stringify({ test: 'outbox-dispatcher' }),
      ],
    );
    const id = insert.rows[0]?.id;
    if (id === undefined) throw new Error('No se pudo insertar outbox.');

    const result = await despacharOutbox({
      runner: new PgTransactionRunner(pool),
      sender: new FakeSender(),
      ahora: () => new Date('2026-07-08T12:00:00.000Z'),
      limit: 1,
    });

    expect(result).toEqual({ tomados: 1, enviados: 1, fallidos: 0 });
    const check = await pool.query<{
      estado: string;
      wamidSalida: string | null;
      intentos: number;
    }>(
      'SELECT estado, wamid_salida AS "wamidSalida", intentos ' +
        'FROM outbox_messages WHERE id = $1',
      [id],
    );
    expect(check.rows[0]).toEqual({
      estado: 'enviado',
      wamidSalida: `wamid.sent.${id}`,
      intentos: 1,
    });
  });
});
