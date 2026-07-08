import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { confirmarPedido, crearPedido } from './pedido.js';
import { crearCtx } from '../runtime/context.js';
import { withTx } from '../runtime/tx.js';
import type { Actor } from '../runtime/types.js';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = DATABASE_URL?.includes('provee_test') === true;
const describeIntegration = runIntegration ? describe : describe.skip;

const actorIngeniero: Actor = {
  userId: '20000000-0000-4000-8000-000000000004',
  nombre: 'Ingeniero de Obra',
  roles: ['ingeniero'],
};

describeIntegration('pedido tools con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('crea y confirma un pedido con dominio, audit y outbox en base real', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const result = await crearPedido({
        projectId: '30000000-0000-4000-8000-000000000001',
        items: [
          { descripcion: 'Cemento', cantidad: 10, unidad: 'saco' },
          { descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
        ],
        fechaRequerida: '2026-07-10',
        urgencia: 'alta',
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      pedidoId = result.value.pedidoId;
      expect(result.value.numero).toMatch(/^PED-2026-\d{3,}$/);
      expect(result.value.items).toHaveLength(2);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const result = await confirmarPedido({ pedidoId }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.notificaciones).toBe(1);
    });

    const check = await pool.query<{
      numero: string;
      estado: string;
      confirmadoPor: string | null;
      itemCount: string;
      auditCount: string;
      outboxCount: string;
    }>(
      'SELECT p.numero, p.estado, p.confirmado_por AS "confirmadoPor", ' +
        '(SELECT count(*) FROM pedido_items pi WHERE pi.pedido_id = p.id) AS "itemCount", ' +
        '(SELECT count(*) FROM audit_events ae WHERE ae.pedido_id = p.id) AS "auditCount", ' +
        "(SELECT count(*) FROM outbox_messages om WHERE om.template = 'notificacion_interna' " +
        "AND om.payload->>'pedido_id' = p.id::text) AS \"outboxCount\" " +
        'FROM pedidos p WHERE p.id = $1',
      [pedidoId],
    );

    expect(check.rows[0]).toMatchObject({
      estado: 'borrador',
      confirmadoPor: actorIngeniero.userId,
    });
    expect(check.rows[0]?.numero).toMatch(/^PED-2026-\d{3,}$/);
    expect(Number(check.rows[0]?.itemCount)).toBe(2);
    expect(Number(check.rows[0]?.auditCount)).toBe(2);
    expect(Number(check.rows[0]?.outboxCount)).toBe(1);
  });
});
