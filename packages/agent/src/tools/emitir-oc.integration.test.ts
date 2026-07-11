import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { aprobarGanador } from './adjudicacion.js';
import { emitirOc } from './oc.js';
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

describeIntegration('emitirOc con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('llega hasta aprobado (mismo seed que aprobarGanador), emite 2 OCs y deja pedido ordenado', async () => {
    const ahora = new Date('2026-07-10T12:00:00.000Z');
    let pedidoId = '';
    let itemCementoId = '';
    let itemVarillaId = '';
    let quoteRequestRodexId = '';
    let quoteRequestLagarId = '';

    // Siembra hasta en_revision, igual que adjudicacion.integration.test.ts: crear,
    // confirmar, enviar RFQ a 2 proveedores y registrar cotizaciones completas ligadas a
    // pedido_item_id (division limpia: Rodex cotiza cemento, El Lagar cotiza varilla).
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

    // Adjudicacion: Rodex gana el cemento, El Lagar gana la varilla.
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
    });

    let ocIdRodex = '';
    let ocIdLagar = '';
    let attachmentIdRodex = '';
    let attachmentIdLagar = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await emitirOc({ pedidoId }, ctx);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.estado).toBe('ordenado');
      expect(result.value.ocs).toHaveLength(2);

      const ocRodex = result.value.ocs.find((oc) => oc.supplierId === RODEX_ID);
      const ocLagar = result.value.ocs.find((oc) => oc.supplierId === LAGAR_ID);
      expect(ocRodex).toBeDefined();
      expect(ocLagar).toBeDefined();
      expect(ocRodex?.montoTotal).toBe(45000);
      expect(ocLagar?.montoTotal).toBe(31250);

      ocIdRodex = ocRodex?.ocId ?? '';
      ocIdLagar = ocLagar?.ocId ?? '';
      attachmentIdRodex = ocRodex?.attachmentId ?? '';
      attachmentIdLagar = ocLagar?.attachmentId ?? '';
    });

    // purchase_orders + po_items.
    const ocsRow = await pool.query<{
      id: string;
      numero: string;
      supplier_id: string;
      estado: string;
      monto_total: string;
      pdf_attachment_id: string | null;
    }>(
      'SELECT id, numero, supplier_id, estado, monto_total, pdf_attachment_id ' +
        'FROM purchase_orders WHERE pedido_id = $1 ORDER BY numero',
      [pedidoId],
    );
    expect(ocsRow.rows).toHaveLength(2);
    for (const row of ocsRow.rows) {
      expect(row.estado).toBe('emitida');
      expect(row.pdf_attachment_id).not.toBeNull();
    }

    const poItemsRow = await pool.query<{ po_id: string; cantidad: string; precio_unitario: string }>(
      'SELECT po_id, cantidad, precio_unitario FROM po_items WHERE po_id = ANY($1::uuid[]) ORDER BY po_id',
      [[ocIdRodex, ocIdLagar]],
    );
    expect(poItemsRow.rows).toHaveLength(2);
    const poItemRodex = poItemsRow.rows.find((row) => row.po_id === ocIdRodex);
    const poItemLagar = poItemsRow.rows.find((row) => row.po_id === ocIdLagar);
    expect(Number(poItemRodex?.cantidad)).toBe(10);
    expect(Number(poItemRodex?.precio_unitario)).toBe(4500);
    expect(Number(poItemLagar?.cantidad)).toBe(25);
    expect(Number(poItemLagar?.precio_unitario)).toBe(1250);

    // attachments + attachment_blobs: bytes empiezan con %PDF.
    const attachmentsRow = await pool.query<{ id: string; content_type: string | null; blob_path: string }>(
      'SELECT id, content_type, blob_path FROM attachments WHERE id = ANY($1::uuid[])',
      [[attachmentIdRodex, attachmentIdLagar]],
    );
    expect(attachmentsRow.rows).toHaveLength(2);
    for (const row of attachmentsRow.rows) {
      expect(row.content_type).toBe('application/pdf');
      expect(row.blob_path).toBe(`pg://attachment_blobs/${row.id}`);
    }

    const blobsRow = await pool.query<{ attachment_id: string; bytes: Buffer }>(
      'SELECT attachment_id, bytes FROM attachment_blobs WHERE attachment_id = ANY($1::uuid[])',
      [[attachmentIdRodex, attachmentIdLagar]],
    );
    expect(blobsRow.rows).toHaveLength(2);
    for (const row of blobsRow.rows) {
      expect(row.bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    }

    // outbox con attachment_id.
    const outboxRow = await pool.query<{ attachment_id: string | null; template: string; destino: string }>(
      "SELECT attachment_id, template, destino FROM outbox_messages " +
        "WHERE template = 'oc_emitida' AND payload ->> 'pedido_id' = $1",
      [pedidoId],
    );
    expect(outboxRow.rows).toHaveLength(2);
    for (const row of outboxRow.rows) {
      expect(row.attachment_id).not.toBeNull();
    }

    // approval_events(emision_oc).
    const approvalRow = await pool.query<{ tipo: string }>(
      "SELECT tipo FROM approval_events WHERE pedido_id = $1 AND tipo = 'emision_oc'",
      [pedidoId],
    );
    expect(approvalRow.rows).toHaveLength(1);

    // Pedido ordenado.
    const pedidoRow = await pool.query<{ estado: string }>(
      'SELECT estado FROM pedidos WHERE id = $1',
      [pedidoId],
    );
    expect(pedidoRow.rows[0]?.estado).toBe('ordenado');
  });
});
