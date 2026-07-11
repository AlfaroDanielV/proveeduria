import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgEntregaStore } from './entregas.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

describe.skipIf(!RUN)('PgEntregaStore integration', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('aplica sent -> read -> delivered y queda en "read" (guard monotonico)', async () => {
    const client = await pool.connect();
    const outboxId = '75000000-0000-4000-8000-000000000001';
    const wamidSalida = 'wamid.OUT-INTEGRATION-1';

    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO outbox_messages (id, destino, texto, estado, wamid_salida) ' +
          "VALUES ($1, '50688887777', 'hola', 'enviado', $2) " +
          'ON CONFLICT (id) DO NOTHING',
        [outboxId, wamidSalida],
      );

      const store = new PgEntregaStore(client);

      expect(await store.aplicarStatus({ wamid: wamidSalida, estado: 'sent' })).toBe(true);
      expect(await store.aplicarStatus({ wamid: wamidSalida, estado: 'read' })).toBe(true);
      // 'delivered' llega despues de 'read' (fuera de orden): el guard NO debe pisar 'read'.
      expect(await store.aplicarStatus({ wamid: wamidSalida, estado: 'delivered' })).toBe(false);

      const { rows } = await client.query<{ entrega_estado: string }>(
        'SELECT entrega_estado FROM outbox_messages WHERE id = $1',
        [outboxId],
      );
      expect(rows[0]?.entrega_estado).toBe('read');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it("aplica 'failed' y guarda entrega_error", async () => {
    const client = await pool.connect();
    const outboxId = '75000000-0000-4000-8000-000000000002';
    const wamidSalida = 'wamid.OUT-INTEGRATION-2';
    const errores = [{ code: 131047, title: 'Message failed to send because more than 24 hours have passed' }];

    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO outbox_messages (id, destino, texto, estado, wamid_salida) ' +
          "VALUES ($1, '50688887777', 'hola', 'enviado', $2) " +
          'ON CONFLICT (id) DO NOTHING',
        [outboxId, wamidSalida],
      );

      const store = new PgEntregaStore(client);

      const aplicado = await store.aplicarStatus({ wamid: wamidSalida, estado: 'failed', errores });
      expect(aplicado).toBe(true);

      const { rows } = await client.query<{ entrega_estado: string; entrega_error: unknown }>(
        'SELECT entrega_estado, entrega_error FROM outbox_messages WHERE id = $1',
        [outboxId],
      );
      expect(rows[0]?.entrega_estado).toBe('failed');
      expect(rows[0]?.entrega_error).toEqual(errores);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('un wamid_salida desconocido no afecta ninguna fila', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const store = new PgEntregaStore(client);
      const aplicado = await store.aplicarStatus({
        wamid: 'wamid.NO-EXISTE-JAMAS',
        estado: 'sent',
      });
      expect(aplicado).toBe(false);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
