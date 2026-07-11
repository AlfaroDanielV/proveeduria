import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PgTransactionRunner } from '../domain/handler.js';
import { despacharOutbox, ErrorEnvio } from './dispatcher.js';
import type { OutboxMessagePendiente, OutboxSender } from './dispatcher.js';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = DATABASE_URL?.includes('provee_test') === true;
const describeIntegration = runIntegration ? describe : describe.skip;

class FakeSender implements OutboxSender {
  async enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }> {
    return { wamidSalida: `wamid.sent.${message.id}` };
  }
}

class SenderPermanente implements OutboxSender {
  async enviar(): Promise<{ readonly wamidSalida: string }> {
    throw new ErrorEnvio('permanente', 'plantilla no existe', { codigo: 132001 });
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

    expect(result).toEqual({ tomados: 1, enviados: 1, fallidos: 0, descartados: 0 });
    const check = await pool.query<{
      estado: string;
      wamidSalida: string | null;
      intentos: number;
      claimedAt: Date | null;
    }>(
      'SELECT estado, wamid_salida AS "wamidSalida", intentos, claimed_at AS "claimedAt" ' +
        'FROM outbox_messages WHERE id = $1',
      [id],
    );
    expect(check.rows[0]).toEqual({
      estado: 'enviado',
      wamidSalida: `wamid.sent.${id}`,
      intentos: 1,
      claimedAt: null,
    });
  });

  it('error permanente: descarta la fila y registra audit_event(outbox_descartado)', async () => {
    const destino = `+5068${randomUUID().slice(0, 8)}`;
    // created_at mas viejo que todo para que el claim (limit 1) lo tome primero.
    const insert = await pool.query<{ id: string }>(
      'INSERT INTO outbox_messages (destino, template, payload, created_at) ' +
        "VALUES ($1, $2, $3::jsonb, '1999-01-01T00:00:00.000Z') RETURNING id",
      [destino, 'plantilla_inexistente', JSON.stringify({ variables: ['x'] })],
    );
    const id = insert.rows[0]?.id;
    if (id === undefined) throw new Error('No se pudo insertar outbox.');

    const result = await despacharOutbox({
      runner: new PgTransactionRunner(pool),
      sender: new SenderPermanente(),
      ahora: () => new Date('2026-07-08T12:00:00.000Z'),
      limit: 1,
    });

    expect(result).toEqual({ tomados: 1, enviados: 0, fallidos: 0, descartados: 1 });
    const fila = await pool.query<{ estado: string; errorUltimo: string | null }>(
      'SELECT estado, error_ultimo AS "errorUltimo" FROM outbox_messages WHERE id = $1',
      [id],
    );
    expect(fila.rows[0]?.estado).toBe('descartado');
    expect(fila.rows[0]?.errorUltimo).toContain('132001');

    const audit = await pool.query<{ accion: string; origen: string }>(
      "SELECT accion, origen FROM audit_events WHERE accion = 'outbox_descartado' " +
        'AND entidad_id = $1',
      [id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.origen).toBe('system');
  });
});
