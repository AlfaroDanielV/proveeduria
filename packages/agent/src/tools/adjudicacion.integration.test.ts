import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { aprobarGanador } from './adjudicacion.js';
import { confirmarPedido, crearPedido, enviarRfq, registrarCotizacion } from './pedido.js';
import { crearCtx } from '../runtime/context.js';
import { withTx } from '../runtime/tx.js';
import type { Actor } from '../runtime/types.js';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = DATABASE_URL?.includes('provee_test') === true;
const describeIntegration = runIntegration ? describe : describe.skip;

const RODEX_ID = '40000000-0000-4000-8000-000000000001';
const LAGAR_ID = '40000000-0000-4000-8000-000000000002';

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

describeIntegration('aprobarGanador con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('adjudica dividido entre 2 proveedores y deja evidencia normativa en approval_events', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';
    let itemCementoId = '';
    let itemVarillaId = '';
    let quoteRequestRodexId = '';
    let quoteRequestLagarId = '';

    // Siembra hasta en_revision: crear, confirmar, enviar RFQ a 2 proveedores y registrar
    // cotizaciones completas ligadas a pedido_item_id (a diferencia de pedido.integration.test.ts,
    // aqui SI se fija pedidoItemId para poder adjudicar item por item).
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
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
      itemCementoId = result.value.items[0]?.id ?? '';
      itemVarillaId = result.value.items[1]?.id ?? '';
      expect(itemCementoId).not.toBe('');
      expect(itemVarillaId).not.toBe('');
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const result = await confirmarPedido({ pedidoId }, ctx);
      expect(result.ok).toBe(true);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await enviarRfq({
        pedidoId,
        supplierIds: [RODEX_ID, LAGAR_ID],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      const quoteRequestRodex = result.value.quoteRequests.find((qr) => qr.supplierId === RODEX_ID);
      const quoteRequestLagar = result.value.quoteRequests.find((qr) => qr.supplierId === LAGAR_ID);
      quoteRequestRodexId = quoteRequestRodex?.id ?? '';
      quoteRequestLagarId = quoteRequestLagar?.id ?? '';
      expect(quoteRequestRodexId).not.toBe('');
      expect(quoteRequestLagarId).not.toBe('');
    });

    // Rodex cotiza el cemento; El Lagar cotiza la varilla (division limpia entre proveedores).
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await registrarCotizacion({
        quoteRequestId: quoteRequestRodexId,
        fuente: 'texto',
        condiciones: 'Contado',
        plazoEntrega: '2 dias',
        confianzaExtraccion: 0.95,
        items: [
          { pedidoItemId: itemCementoId, precioUnitario: 4500, cantidad: 10, disponible: true },
        ],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.transicionoAEnRevision).toBe(false);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await registrarCotizacion({
        quoteRequestId: quoteRequestLagarId,
        fuente: 'texto',
        condiciones: 'Credito 30 dias',
        plazoEntrega: '3 dias',
        confianzaExtraccion: 0.9,
        items: [
          { pedidoItemId: itemVarillaId, precioUnitario: 1250, cantidad: 25, disponible: true },
        ],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.transicionoAEnRevision).toBe(true);
      expect(result.value.pedidoEstado).toBe('en_revision');
    });

    // Adjudicacion real: Rodex gana el cemento, El Lagar gana la varilla.
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await aprobarGanador({
        pedidoId,
        asignaciones: [
          { supplierId: RODEX_ID, pedidoItemIds: [itemCementoId] },
          { supplierId: LAGAR_ID, pedidoItemIds: [itemVarillaId] },
        ],
      }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.estado).toBe('aprobado');
      expect(result.value.asignaciones).toEqual([
        { supplierId: RODEX_ID, pedidoItemIds: [itemCementoId], quoteResponseId: expect.any(String) },
        { supplierId: LAGAR_ID, pedidoItemIds: [itemVarillaId], quoteResponseId: expect.any(String) },
      ]);
      expect(result.value.comparativo.filas.length).toBeGreaterThan(0);
    });

    const pedidoRow = await pool.query<{ estado: string }>(
      'SELECT estado FROM pedidos WHERE id = $1',
      [pedidoId],
    );
    expect(pedidoRow.rows[0]?.estado).toBe('aprobado');

    const approvalRow = await pool.query<{
      tipo: string;
      canal: string;
      detalle: {
        asignaciones: readonly {
          supplierId: string;
          pedidoItemIds: readonly string[];
          quoteResponseId: string;
        }[];
        comparativo: {
          pedidoId: string;
          numero: string;
          filas: readonly unknown[];
          resumenProveedores: readonly unknown[];
        };
      };
    }>(
      "SELECT tipo, canal, detalle FROM approval_events " +
        "WHERE pedido_id = $1 AND tipo = 'ganador' ORDER BY at DESC LIMIT 1",
      [pedidoId],
    );

    const approval = approvalRow.rows[0];
    expect(approval).toBeDefined();
    expect(approval?.canal).toBe('whatsapp');
    expect(approval?.detalle.asignaciones).toEqual([
      { supplierId: RODEX_ID, pedidoItemIds: [itemCementoId], quoteResponseId: expect.any(String) },
      { supplierId: LAGAR_ID, pedidoItemIds: [itemVarillaId], quoteResponseId: expect.any(String) },
    ]);
    expect(approval?.detalle.comparativo.pedidoId).toBe(pedidoId);
    expect(approval?.detalle.comparativo.filas.length).toBeGreaterThan(0);
    expect(approval?.detalle.comparativo.resumenProveedores.length).toBe(2);
  });
});
