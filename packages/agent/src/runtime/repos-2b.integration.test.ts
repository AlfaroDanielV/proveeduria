import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { alquilerDebeCerrarse, estadoObjetivoOc, estadoObjetivoPedido } from '@proveeduria/core';
import type { EstadoObjetivoOc } from '@proveeduria/core';

import { crearPedido } from '../tools/pedido.js';
import { crearCtx } from './context.js';
import { withTx } from './tx.js';
import type { Actor } from './types.js';

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

const actorBodeguero: Actor = {
  userId: '20000000-0000-4000-8000-000000000005',
  nombre: 'Bodeguero',
  roles: ['bodeguero'],
};

const PROYECTO_LOPEZ = '30000000-0000-4000-8000-000000000001';
const SUPPLIER_RODEX = '40000000-0000-4000-8000-000000000001';

/**
 * `estadoObjetivoOc` (core) devuelve `EstadoObjetivoOc`, que incluye `sin_recepcion` — NO un
 * estado real de `purchase_orders.estado`. Una tool (B6 `confirmar_recepcion`, fuera de
 * alcance de B2) solo llamaria a `OcRepo.actualizarEstado` cuando hay recepcion que reportar;
 * este helper reproduce ese guard para el test de integracion.
 */
function estadoOcTransicionable(estado: EstadoObjetivoOc): 'recibida_parcial' | 'recibida_total' {
  if (estado === 'sin_recepcion') {
    throw new Error('sin_recepcion no es un estado de OC transicionable.');
  }
  return estado;
}

describeIntegration('repos Fase 2b (OC/factura/recepcion/equipos/dashboard) con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('OC->invoice->links->receipt->cobertura cruzada con core, y ciclo de estados de la OC', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const result = await crearPedido({
        projectId: PROYECTO_LOPEZ,
        items: [{ descripcion: 'Cemento', cantidad: 10, unidad: 'saco' }],
        fechaRequerida: '2026-07-10',
      }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      pedidoId = result.value.pedidoId;
    });

    let ocId = '';
    let itemAId = '';
    let itemBId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const numero = await ctx.repos.ocs.siguienteNumeroOc(ahora);
      expect(numero).toMatch(/^OC-2026-\d{3,}$/);

      const { oc, items } = await ctx.repos.ocs.crear({
        numero,
        pedidoId,
        supplierId: SUPPLIER_RODEX,
        montoTotal: 4500 * 6 + 1200 * 25,
        items: [
          { pedidoItemId: null, cantidad: 6, precioUnitario: 4500 },
          { pedidoItemId: null, cantidad: 25, precioUnitario: 1200 },
        ],
      });
      ocId = oc.id;
      expect(oc.estado).toBe('emitida');
      expect(items).toHaveLength(2);
      const [itemA, itemB] = items;
      if (itemA === undefined || itemB === undefined) throw new Error('setup invalido');
      itemAId = itemA.id;
      itemBId = itemB.id;

      const porPedido = await ctx.repos.ocs.porPedido(pedidoId);
      expect(porPedido.map((o) => o.id)).toContain(ocId);

      const itemsPorOc = await ctx.repos.ocs.itemsPorOc(ocId);
      expect(itemsPorOc).toHaveLength(2);
    });

    // Proveedor confirma la OC (fija confirmada_por_proveedor_at, sin cambiar estado por si
    // mismo) y luego la tool transiciona emitida->confirmada.
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const confirmada = await ctx.repos.ocs.fijarConfirmadaProveedor(ocId, ahora);
      expect(confirmada.confirmadaPorProveedorAt).not.toBeNull();
      expect(confirmada.estado).toBe('emitida');

      const transicionada = await ctx.repos.ocs.actualizarEstado(ocId, 'confirmada');
      expect(transicionada.estado).toBe('confirmada');

      const attachment = await tx.query<{ id: string }>(
        "INSERT INTO attachments (blob_path, content_type) VALUES ('oc/pdf/test.pdf', 'application/pdf') " +
          'RETURNING id',
      );
      const attachmentId = attachment.rows[0]?.id;
      if (attachmentId === undefined) throw new Error('setup invalido');

      const conPdf = await ctx.repos.ocs.fijarPdfAttachment(ocId, attachmentId);
      expect(conPdf.pdfAttachmentId).toBe(attachmentId);
    });

    // Transicion invalida: 'confirmada' -> 'emitida' no existe en la tabla de la OC. Se
    // valida en el repo ANTES del UPDATE (puedeTransicionarOc); el trigger 009 es la segunda
    // barrera.
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      await expect(ctx.repos.ocs.actualizarEstado(ocId, 'emitida')).rejects.toThrow(/invalida/);
    });

    // Registra factura, la linkea a la OC, la concilia, y confirma recepcion PARCIAL
    // (item A: 4 de 6 -> parcial; item B: 25 de 25 -> completo).
    let invoiceId = '';
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorBodeguero, ahora });
      const { invoice, items } = await ctx.repos.invoices.crear({
        numeroFactura: 'F-2026-001',
        supplierId: SUPPLIER_RODEX,
        projectId: PROYECTO_LOPEZ,
        fecha: '2026-07-08',
        montoTotal: 4500 * 4 + 1200 * 25,
        fuenteAttachmentId: null,
        confianzaExtraccion: 0.95,
        registradaPor: actorBodeguero.userId,
        items: [
          { descripcion: 'Cemento', cantidad: 4, precioUnitario: 4500 },
          { descripcion: 'Varilla #4', cantidad: 25, precioUnitario: 1200 },
        ],
      });
      invoiceId = invoice.id;
      expect(invoice.estado).toBe('pendiente_revision');
      expect(items).toHaveLength(2);

      const abiertas = await ctx.repos.invoices.abiertasPorProveedorYProyecto(
        SUPPLIER_RODEX,
        PROYECTO_LOPEZ,
      );
      expect(abiertas.map((i) => i.id)).toContain(invoiceId);

      const links = await ctx.repos.invoicePoLinks.crear(invoiceId, [
        { ocId, montoAsignado: invoice.montoTotal },
      ]);
      expect(links).toHaveLength(1);

      const porInvoice = await ctx.repos.invoicePoLinks.porInvoice(invoiceId);
      expect(porInvoice).toHaveLength(1);
      const porOc = await ctx.repos.invoicePoLinks.porOc(ocId);
      expect(porOc).toHaveLength(1);

      const conciliada = await ctx.repos.invoices.actualizarEstado(invoiceId, 'conciliada');
      expect(conciliada.estado).toBe('conciliada');

      // Ya no aparece en "abiertas" (pendiente_revision) tras conciliar.
      const abiertasTras = await ctx.repos.invoices.abiertasPorProveedorYProyecto(
        SUPPLIER_RODEX,
        PROYECTO_LOPEZ,
      );
      expect(abiertasTras.map((i) => i.id)).not.toContain(invoiceId);

      await ctx.repos.receiptConfirmations.crear({
        invoiceId,
        bodegueroUserId: actorBodeguero.userId,
        cantidades: { [itemAId]: 4, [itemBId]: 25 },
        diferenciasDetectadas: { [itemAId]: -2 },
        confirmadoAt: ahora,
      });

      const confirmaciones = await ctx.repos.receiptConfirmations.porInvoice(invoiceId);
      expect(confirmaciones).toHaveLength(1);
      expect(confirmaciones[0]?.cantidades).toEqual({ [itemAId]: 4, [itemBId]: 25 });
    });

    // Test cruzado core<->SQL obligatorio (state-machine.md §Computo de cobertura): la
    // cobertura calculada por SQL debe coincidir con lo esperado a mano, y alimentar
    // directamente estadoObjetivoOc de @proveeduria/core.
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const cobertura = await ctx.repos.cobertura.coberturaDeOc(ocId);
      expect(cobertura).toHaveLength(2);
      expect(cobertura).toEqual(
        expect.arrayContaining([
          { cantidad: 6, cantidadRecibida: 4 },
          { cantidad: 25, cantidadRecibida: 25 },
        ]),
      );

      const umbrales = await ctx.repos.config.umbrales();
      const estadoOc = estadoObjetivoOc(cobertura, umbrales);
      expect(estadoOc).toBe('recibida_parcial');

      const actualizada = await ctx.repos.ocs.actualizarEstado(ocId, estadoOcTransicionable(estadoOc));
      expect(actualizada.estado).toBe('recibida_parcial');

      const estadosPedido = await ctx.repos.cobertura.estadosOcDePedido(pedidoId);
      expect(estadoObjetivoPedido(estadosPedido)).toBe('recepcion_parcial');
    });

    // Segunda factura cubre el resto del item A (2 unidades) -> cobertura total -> OC
    // recibida_total (transicion recibida_parcial -> recibida_total permitida).
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorBodeguero, ahora });
      const { invoice } = await ctx.repos.invoices.crear({
        numeroFactura: 'F-2026-002',
        supplierId: SUPPLIER_RODEX,
        projectId: PROYECTO_LOPEZ,
        fecha: '2026-07-09',
        montoTotal: 4500 * 2,
        fuenteAttachmentId: null,
        confianzaExtraccion: 0.95,
        registradaPor: actorBodeguero.userId,
        items: [],
      });
      await ctx.repos.invoicePoLinks.crear(invoice.id, [{ ocId, montoAsignado: invoice.montoTotal }]);
      await ctx.repos.invoices.actualizarEstado(invoice.id, 'conciliada');
      await ctx.repos.receiptConfirmations.crear({
        invoiceId: invoice.id,
        bodegueroUserId: actorBodeguero.userId,
        cantidades: { [itemAId]: 2 },
        diferenciasDetectadas: null,
        confirmadoAt: ahora,
      });

      const cobertura = await ctx.repos.cobertura.coberturaDeOc(ocId);
      // item A: 4 (factura 1) + 2 (factura 2) = 6 = cantidad completa.
      expect(cobertura).toEqual(
        expect.arrayContaining([
          { cantidad: 6, cantidadRecibida: 6 },
          { cantidad: 25, cantidadRecibida: 25 },
        ]),
      );
      const umbrales = await ctx.repos.config.umbrales();
      const estadoOc = estadoObjetivoOc(cobertura, umbrales);
      expect(estadoOc).toBe('recibida_total');

      const actualizada = await ctx.repos.ocs.actualizarEstado(ocId, estadoOcTransicionable(estadoOc));
      expect(actualizada.estado).toBe('recibida_total');
    });

    // recibida_total es terminal: cualquier transicion posterior debe fallar (primera
    // barrera en el repo via puedeTransicionarOc).
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      await expect(ctx.repos.ocs.actualizarEstado(ocId, 'confirmada')).rejects.toThrow(/terminal/);
    });

    // El trigger 009 (segunda barrera) tambien bloquea el UPDATE crudo sobre una OC
    // terminal, incluso para columnas no-estado (regla dura 2: recibida_total es inmutable).
    await withTx(pool, async (tx) => {
      await expect(
        tx.query('UPDATE purchase_orders SET monto_total = monto_total WHERE id = $1', [ocId]),
      ).rejects.toThrow(/inmutable/);
    });
  });

  it('CreditNoteRepo.pendientesPorPedido via join factura->OC->pedido, y aplicar()', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';
    let ocId = '';
    let invoiceId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const pedido = await crearPedido({
        projectId: PROYECTO_LOPEZ,
        items: [{ descripcion: 'Bloque', cantidad: 100, unidad: 'unidad' }],
      }, ctx);
      if (!pedido.ok) throw new Error(pedido.error.mensaje);
      pedidoId = pedido.value.pedidoId;
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const numero = await ctx.repos.ocs.siguienteNumeroOc(ahora);
      const { oc } = await ctx.repos.ocs.crear({
        numero,
        pedidoId,
        supplierId: SUPPLIER_RODEX,
        montoTotal: 100000,
        items: [{ pedidoItemId: null, cantidad: 100, precioUnitario: 1000 }],
      });
      ocId = oc.id;

      const { invoice } = await ctx.repos.invoices.crear({
        numeroFactura: 'F-2026-NC',
        supplierId: SUPPLIER_RODEX,
        projectId: PROYECTO_LOPEZ,
        fecha: '2026-07-08',
        montoTotal: 100000,
        fuenteAttachmentId: null,
        confianzaExtraccion: 0.9,
        registradaPor: actorAdminMateriales.userId,
        items: [],
      });
      invoiceId = invoice.id;
      await ctx.repos.invoicePoLinks.crear(invoiceId, [{ ocId, montoAsignado: 100000 }]);
    });

    let ncId = '';
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const nc = await ctx.repos.creditNotes.crear({
        numero: 'NC-2026-001',
        invoiceId,
        monto: 5000,
        motivo: 'Material defectuoso',
        attachmentId: null,
      });
      ncId = nc.id;
      expect(nc.estado).toBe('pendiente_asociacion');

      const pendientes = await ctx.repos.creditNotes.pendientesPorPedido(pedidoId);
      expect(pendientes.map((n) => n.id)).toEqual([ncId]);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const aplicada = await ctx.repos.creditNotes.aplicar(ncId, actorAdminMateriales.userId, ahora);
      expect(aplicada.estado).toBe('aplicada');

      const pendientes = await ctx.repos.creditNotes.pendientesPorPedido(pedidoId);
      expect(pendientes).toHaveLength(0);
    });
  });

  it('equipos: el trigger de DB recalcula cantidad_activa sobre el INSERT de movimiento', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let rentalId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const rental = await ctx.repos.equipment.crearRental({
        projectId: PROYECTO_LOPEZ,
        supplierId: SUPPLIER_RODEX,
        descripcionEquipo: 'Compactadora de placa',
        cantidadInicial: 3,
        boletaAttachmentId: null,
      });
      rentalId = rental.id;
      expect(rental.cantidadActiva).toBe(0);

      const { movimiento, rental: tras1 } = await ctx.repos.equipment.crearMovimiento({
        rentalId,
        tipo: 'entrada',
        cantidad: 3,
        boletaAttachmentId: null,
        registradoPor: actorAdminMateriales.userId,
        at: ahora,
      });
      expect(movimiento.tipo).toBe('entrada');
      // Prueba directa de que el trigger de la migracion 009 (no la app) recalculo el saldo.
      expect(tras1.cantidadActiva).toBe(3);

      const activosProyecto = await ctx.repos.equipment.rentalsActivosPorProyecto(PROYECTO_LOPEZ);
      expect(activosProyecto.map((r) => r.id)).toContain(rentalId);
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const { rental: tras2 } = await ctx.repos.equipment.crearMovimiento({
        rentalId,
        tipo: 'devolucion',
        cantidad: 3,
        boletaAttachmentId: null,
        registradoPor: actorAdminMateriales.userId,
        at: ahora,
      });
      expect(tras2.cantidadActiva).toBe(0);
      expect(alquilerDebeCerrarse(tras2.cantidadActiva)).toBe(true);

      const cerrado = await ctx.repos.equipment.cerrarRental(rentalId, ahora);
      expect(cerrado.estado).toBe('cerrado');

      const movimientos = await ctx.repos.equipment.movimientosPorRental(rentalId);
      expect(movimientos).toHaveLength(2);
    });

    // equipment_movements es inmutable (migracion 009): ni UPDATE ni DELETE.
    await withTx(pool, async (tx) => {
      const movimientos = await tx.query<{ id: string }>(
        'SELECT id FROM equipment_movements WHERE rental_id = $1 LIMIT 1',
        [rentalId],
      );
      const movimientoId = movimientos.rows[0]?.id;
      expect(movimientoId).toBeDefined();
      await expect(
        tx.query('UPDATE equipment_movements SET cantidad = cantidad WHERE id = $1', [movimientoId]),
      ).rejects.toThrow(/inmutable/);
    });
  });

  it('QuoteRequestRepo.marcarVencidas (E1) contra Postgres real', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const pedido = await crearPedido({
        projectId: PROYECTO_LOPEZ,
        items: [{ descripcion: 'Arena', cantidad: 5, unidad: 'm3' }],
      }, ctx);
      if (!pedido.ok) throw new Error(pedido.error.mensaje);
      pedidoId = pedido.value.pedidoId;

      await ctx.repos.quoteRequests.crear({
        pedidoId,
        supplierId: SUPPLIER_RODEX,
        plazoAt: new Date('2026-07-06T12:00:00.000Z'), // ya vencido respecto a `ahora`
      });
    });

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const afectadas = await ctx.repos.quoteRequests.marcarVencidas(ahora);
      const propias = afectadas.filter((qr) => qr.pedidoId === pedidoId);
      expect(propias).toHaveLength(1);
      expect(propias[0]?.estado).toBe('vencida');
    });

    const check = await pool.query<{ estado: string }>(
      'SELECT estado FROM quote_requests WHERE pedido_id = $1',
      [pedidoId],
    );
    expect(check.rows[0]?.estado).toBe('vencida');
  });

  it('DashboardLinkRepo: vigente vs expirado contra Postgres real', async () => {
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({
        tx,
        actor: actorAdminMateriales,
        ahora: new Date('2026-07-07T12:00:00.000Z'),
      });
      const link = await ctx.repos.dashboardLinks.crear({
        tokenHash: `hash-${Date.now()}`,
        projectId: PROYECTO_LOPEZ,
        expiresAt: new Date('2026-07-08T12:00:00.000Z'),
        createdBy: actorAdminMateriales.userId,
      });

      const vigente = await ctx.repos.dashboardLinks.porTokenHashVigente(
        link.tokenHash,
        new Date('2026-07-08T00:00:00.000Z'),
      );
      expect(vigente?.id).toBe(link.id);

      const expirado = await ctx.repos.dashboardLinks.porTokenHashVigente(
        link.tokenHash,
        new Date('2026-07-09T00:00:00.000Z'),
      );
      expect(expirado).toBeNull();
    });
  });

  it('ReviewQueueRepo.abiertasPorPedido y FeedbackRepo.crear', async () => {
    const ahora = new Date('2026-07-07T12:00:00.000Z');
    let pedidoId = '';

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const pedido = await crearPedido({
        projectId: PROYECTO_LOPEZ,
        items: [{ descripcion: 'Alambre', cantidad: 50, unidad: 'kg' }],
      }, ctx);
      if (!pedido.ok) throw new Error(pedido.error.mensaje);
      pedidoId = pedido.value.pedidoId;

      const entry = await ctx.repos.reviewQueue.crear({
        tipo: 'material_no_coincide',
        entidad: 'invoices',
        entidadId: '00000000-0000-4000-8000-000000000099',
        pedidoId,
        detalle: { motivo: 'test' },
      });
      expect(entry.estado).toBe('pendiente');

      const abiertas = await ctx.repos.reviewQueue.abiertasPorPedido(pedidoId);
      expect(abiertas.map((e) => e.id)).toContain(entry.id);

      const feedback = await ctx.repos.feedback.crear({
        userId: actorIngeniero.userId,
        tipo: 'sugerencia',
        texto: 'Probando FeedbackRepo desde el test de integracion 2b.',
        contexto: { origen: 'repos-2b.integration.test' },
      });
      expect(feedback.texto).toContain('FeedbackRepo');
    });

    const proyectosActivos = await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      return ctx.repos.proyectos.listarActivos();
    });
    expect(proyectosActivos.map((p) => p.id)).toContain(PROYECTO_LOPEZ);
  });
});
