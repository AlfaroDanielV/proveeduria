import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { confirmarPedido, crearPedido, enviarRfq } from './pedido.js';
import { procesarVencimientos } from './vencimientos.js';
import { crearCtx } from '../runtime/context.js';
import { crearCtxSistema } from '../runtime/context-sistema.js';
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

const actorAdminMateriales: Actor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

describeIntegration('cron E1 procesarVencimientos con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('vence RFQs, transiciona a en_revision, genera comparativo y audita e1_vencimiento', async () => {
    // `marcarVencidas` es GLOBAL (todo el portafolio). Vitest corre los tests de integracion
    // en paralelo contra la misma `provee_test`, asi que la ventana de este test se aisla en
    // el tiempo: el plazo de sus RFQs (ahoraRfq + 6h = 2026-07-06T18:00) y el `ahoraCron`
    // quedan ANTES del plazo mas temprano de cualquier otro test (>= 2026-07-08), de modo que
    // el barrido nunca toca RFQs `enviada` en vuelo de otro test (y las assertions de conteo
    // global quedan deterministas).
    const ahoraRfq = new Date('2026-07-06T12:00:00.000Z');
    const ahoraCron = new Date('2026-07-06T18:30:00.000Z');
    let pedidoId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora: ahoraRfq });
      const result = await crearPedido({
        projectId: '30000000-0000-4000-8000-000000000001',
        items: [
          { descripcion: 'Cemento', cantidad: 10, unidad: 'saco' },
          { descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
        ],
      }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      pedidoId = result.value.pedidoId;
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora: ahoraRfq });
      const result = await confirmarPedido({ pedidoId }, ctx);
      expect(result.ok).toBe(true);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora: ahoraRfq });
      const result = await enviarRfq({
        pedidoId,
        supplierIds: [
          '40000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000002',
        ],
        plazoHoras: 6,
      }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.estado).toBe('cotizando');
      expect(result.value.plazoAt.getTime()).toBeLessThan(ahoraCron.getTime());
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtxSistema({ tx, ahora: ahoraCron });
      const result = await procesarVencimientos(ctx, ahoraCron);
      expect(result).toEqual({ vencidas: 2, pedidosTransicionados: 1 });
    });

    const pedido = await pool.query<{ estado: string }>(
      'SELECT estado FROM pedidos WHERE id = $1',
      [pedidoId],
    );
    expect(pedido.rows[0]?.estado).toBe('en_revision');

    const rfqs = await pool.query<{ vencidas: string; total: string }>(
      "SELECT count(*) FILTER (WHERE estado = 'vencida')::text AS vencidas, " +
        'count(*)::text AS total FROM quote_requests WHERE pedido_id = $1',
      [pedidoId],
    );
    expect(rfqs.rows[0]).toMatchObject({ vencidas: '2', total: '2' });

    const e1 = await pool.query<{
      actorSistema: boolean;
      actorUserId: string | null;
      origen: string;
      despues: {
        transiciono_a_en_revision: boolean;
        quote_request_ids_vencidos: string[];
        supplier_ids_vencidos: string[];
      };
    }>(
      'SELECT actor_sistema AS "actorSistema", actor_user_id AS "actorUserId", origen, despues ' +
        "FROM audit_events WHERE accion = 'e1_vencimiento' AND pedido_id = $1",
      [pedidoId],
    );
    expect(e1.rows).toHaveLength(1);
    expect(e1.rows[0]?.actorSistema).toBe(true);
    expect(e1.rows[0]?.actorUserId).toBeNull();
    expect(e1.rows[0]?.origen).toBe('cron');
    expect(e1.rows[0]?.despues.transiciono_a_en_revision).toBe(true);
    expect(e1.rows[0]?.despues.quote_request_ids_vencidos).toHaveLength(2);
    expect(e1.rows[0]?.despues.supplier_ids_vencidos).toHaveLength(2);

    const comparativoAudit = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM audit_events " +
        "WHERE accion = 'generar_comparativo' AND pedido_id = $1 AND origen = 'cron'",
      [pedidoId],
    );
    expect(comparativoAudit.rows[0]?.total).toBe('1');

    const comparativoOutbox = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM outbox_messages " +
        "WHERE template = 'notificacion_interna' AND payload->>'portal_path' = $1",
      [`/pedidos/${pedidoId}/comparativo`],
    );
    expect(comparativoOutbox.rows[0]?.total).toBe('1');

    const e1Outbox = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM outbox_messages " +
        "WHERE template = 'notificacion_interna' AND payload->>'pedido_id' = $1 " +
        "AND payload::text LIKE '%vencio el plazo%'",
      [pedidoId],
    );
    expect(e1Outbox.rows[0]?.total).toBe('1');
  });
});
