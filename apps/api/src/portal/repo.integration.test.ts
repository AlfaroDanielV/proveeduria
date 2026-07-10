import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgPortalStore } from './repo.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

describe.skipIf(!RUN)('PgPortalStore integration', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    client?.release();
    await pool.end();
  });

  it('lista detalle y comparativo con alcance de admin_materiales', async () => {
    client = await pool.connect();
    const pedidoId = '71000000-0000-4000-8000-000000000001';
    const itemId = '72000000-0000-4000-8000-000000000001';
    const quoteRequestId = '73000000-0000-4000-8000-000000000001';
    const quoteResponseId = '74000000-0000-4000-8000-000000000001';

    await client.query('BEGIN');
    try {
      await client.query(
        'INSERT INTO pedidos (id, numero, project_id, solicitante_user_id, estado, fecha_requerida, urgencia) ' +
          "VALUES ($1, 'PED-2026-901', '30000000-0000-4000-8000-000000000001', " +
          "'20000000-0000-4000-8000-000000000004', 'en_revision', '2026-07-15', 'alta') " +
          'ON CONFLICT (id) DO NOTHING',
        [pedidoId],
      );
      await client.query(
        'INSERT INTO pedido_items (id, pedido_id, descripcion, cantidad, unidad) ' +
          "VALUES ($1, $2, 'Cemento gris', 10, 'saco') ON CONFLICT (id) DO NOTHING",
        [itemId, pedidoId],
      );
      await client.query(
        'INSERT INTO quote_requests (id, pedido_id, supplier_id, plazo_at, estado) ' +
          "VALUES ($1, $2, '40000000-0000-4000-8000-000000000001', now(), 'respondida') " +
          'ON CONFLICT (id) DO NOTHING',
        [quoteRequestId, pedidoId],
      );
      await client.query(
        'INSERT INTO quote_responses ' +
          '(id, quote_request_id, recibido_at, fuente, condiciones, plazo_entrega, confianza_extraccion, estado) ' +
          "VALUES ($1, $2, now(), 'texto', 'Contado', '24h', 0.95, 'completa') " +
          'ON CONFLICT (id) DO NOTHING',
        [quoteResponseId, quoteRequestId],
      );
      await client.query(
        'INSERT INTO quote_items (quote_response_id, pedido_item_id, precio_unitario, cantidad, disponible) ' +
          'VALUES ($1, $2, 5000, 10, true)',
        [quoteResponseId, itemId],
      );

      const store = new PgPortalStore(client);
      const actor = await store.usuarioPorId('20000000-0000-4000-8000-000000000002');
      expect(actor).not.toBeNull();

      const lista = await store.listarPedidos(actor!, { estado: 'en_revision', limit: 10, offset: 0 });
      expect(lista.items.some((p) => p.id === pedidoId)).toBe(true);

      const detalle = await store.detallePedido(actor!, pedidoId);
      expect(detalle?.items[0]).toMatchObject({ descripcion: 'Cemento gris', cantidad: 10 });

      const comparativo = await store.comparativoPedido(actor!, pedidoId);
      expect(comparativo?.resumenProveedores[0]).toMatchObject({
        nombre: 'Rodex',
        total: 50000,
        itemsFaltantes: 0,
      });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
