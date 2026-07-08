import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  confirmarPedido,
  crearPedido,
  enviarRfq,
  registrarCotizacion,
  sugerirProveedores,
} from './pedido.js';
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

const actorAdminMateriales: Actor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

describeIntegration('pedido tools con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('crea, confirma, sugiere proveedores y envia RFQ en base real', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';
    let quoteRequestIds: string[] = [];

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

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await sugerirProveedores({ pedidoId }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.proveedores.map((p) => p.supplierId)).toContain(
        '40000000-0000-4000-8000-000000000001',
      );
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await enviarRfq({
        pedidoId,
        supplierIds: [
          '40000000-0000-4000-8000-000000000001',
          '40000000-0000-4000-8000-000000000002',
        ],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.estado).toBe('cotizando');
      expect(result.value.quoteRequests).toHaveLength(2);
      expect(result.value.outbox).toBe(2);
      quoteRequestIds = result.value.quoteRequests.map((qr) => qr.id);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await registrarCotizacion({
        quoteRequestId: quoteRequestIds[0],
        fuente: 'texto',
        condiciones: 'Contado',
        plazoEntrega: '2 dias',
        confianzaExtraccion: 0.95,
        items: [
          { precioUnitario: 4500, cantidad: 10, disponible: true },
          { precioUnitario: 1200, cantidad: 25, disponible: true },
        ],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.pedidoEstado).toBe('cotizando');
      expect(result.value.transicionoAEnRevision).toBe(false);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await registrarCotizacion({
        quoteRequestId: quoteRequestIds[1],
        fuente: 'texto',
        condiciones: 'Credito 30 dias',
        plazoEntrega: '3 dias',
        confianzaExtraccion: 0.9,
        items: [
          { precioUnitario: 4600, cantidad: 10, disponible: true },
          { precioUnitario: 1250, cantidad: 25, disponible: true },
        ],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.pedidoEstado).toBe('en_revision');
      expect(result.value.transicionoAEnRevision).toBe(true);
    });

    const check = await pool.query<{
      numero: string;
      estado: string;
      confirmadoPor: string | null;
      itemCount: string;
      quoteRequestCount: string;
      quoteResponseCount: string;
      quoteItemCount: string;
      auditCount: string;
      approvalCount: string;
      internalOutboxCount: string;
      rfqOutboxCount: string;
    }>(
      'SELECT p.numero, p.estado, p.confirmado_por AS "confirmadoPor", ' +
        '(SELECT count(*) FROM pedido_items pi WHERE pi.pedido_id = p.id) AS "itemCount", ' +
        '(SELECT count(*) FROM quote_requests qr WHERE qr.pedido_id = p.id) AS "quoteRequestCount", ' +
        '(SELECT count(*) FROM quote_responses qres ' +
        'JOIN quote_requests qr ON qr.id = qres.quote_request_id ' +
        'WHERE qr.pedido_id = p.id) AS "quoteResponseCount", ' +
        '(SELECT count(*) FROM quote_items qi ' +
        'JOIN quote_responses qres ON qres.id = qi.quote_response_id ' +
        'JOIN quote_requests qr ON qr.id = qres.quote_request_id ' +
        'WHERE qr.pedido_id = p.id) AS "quoteItemCount", ' +
        '(SELECT count(*) FROM audit_events ae WHERE ae.pedido_id = p.id) AS "auditCount", ' +
        '(SELECT count(*) FROM approval_events ap WHERE ap.pedido_id = p.id) AS "approvalCount", ' +
        "(SELECT count(*) FROM outbox_messages om WHERE om.template = 'notificacion_interna' " +
        "AND om.payload->>'pedido_id' = p.id::text) AS \"internalOutboxCount\", " +
        "(SELECT count(*) FROM outbox_messages om WHERE om.template = 'rfq_solicitud' " +
        "AND om.payload->>'pedido_id' = p.id::text) AS \"rfqOutboxCount\" " +
        'FROM pedidos p WHERE p.id = $1',
      [pedidoId],
    );

    expect(check.rows[0]).toMatchObject({
      estado: 'en_revision',
      confirmadoPor: actorIngeniero.userId,
    });
    expect(check.rows[0]?.numero).toMatch(/^PED-2026-\d{3,}$/);
    expect(Number(check.rows[0]?.itemCount)).toBe(2);
    expect(Number(check.rows[0]?.quoteRequestCount)).toBe(2);
    expect(Number(check.rows[0]?.quoteResponseCount)).toBe(2);
    expect(Number(check.rows[0]?.quoteItemCount)).toBe(4);
    expect(Number(check.rows[0]?.auditCount)).toBe(6);
    expect(Number(check.rows[0]?.approvalCount)).toBe(1);
    expect(Number(check.rows[0]?.internalOutboxCount)).toBe(1);
    expect(Number(check.rows[0]?.rfqOutboxCount)).toBe(2);
  });
});
