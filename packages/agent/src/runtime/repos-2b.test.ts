import { describe, expect, it } from 'vitest';

import {
  alquilerDebeCerrarse,
  estadoObjetivoOc,
  estadoObjetivoPedido,
  UMBRALES_DEFAULT,
} from '@proveeduria/core';

import { crearFakeRepos, FakeToolStore } from './fakes.js';
import type { CreditNote, DashboardLink, QuoteRequest, ReviewQueueEntry } from './types.js';

const UMBRALES_COBERTURA = { difCantidadMenor: UMBRALES_DEFAULT.difCantidadMenor };

describe('CoberturaRepo (fake) — agregado de receipt_confirmations/invoice_po_links', () => {
  it('coberturaDeOc suma solo confirmaciones de facturas conciliadas linkeadas a la OC', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const { oc, items } = await repos.ocs.crear({
      numero: 'OC-2026-001',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      montoTotal: 1000,
      items: [
        { pedidoItemId: 'item-a', cantidad: 10, precioUnitario: 100 },
        { pedidoItemId: 'item-b', cantidad: 5, precioUnitario: 200 },
      ],
    });
    const [itemA, itemB] = items;
    if (itemA === undefined || itemB === undefined) throw new Error('setup invalido');

    // Factura conciliada linkeada a la OC: cuenta.
    const conciliada = await repos.invoices.crear({
      numeroFactura: 'F-001',
      supplierId: 'supplier-1',
      projectId: 'proyecto-1',
      fecha: '2026-07-01',
      montoTotal: 1000,
      fuenteAttachmentId: null,
      confianzaExtraccion: 0.95,
      registradaPor: 'user-1',
      items: [],
    });
    await repos.invoices.actualizarEstado(conciliada.invoice.id, 'conciliada');
    await repos.invoicePoLinks.crear(conciliada.invoice.id, [{ ocId: oc.id, montoAsignado: 1000 }]);
    await repos.receiptConfirmations.crear({
      invoiceId: conciliada.invoice.id,
      bodegueroUserId: 'user-2',
      cantidades: { [itemA.id]: 6, [itemB.id]: 5 },
      diferenciasDetectadas: null,
      confirmadoAt: new Date('2026-07-02T12:00:00.000Z'),
    });

    // Factura pendiente_revision linkeada: NO cuenta (aun no concilia).
    const pendiente = await repos.invoices.crear({
      numeroFactura: 'F-002',
      supplierId: 'supplier-1',
      projectId: 'proyecto-1',
      fecha: '2026-07-03',
      montoTotal: 400,
      fuenteAttachmentId: null,
      confianzaExtraccion: 0.9,
      registradaPor: 'user-1',
      items: [],
    });
    await repos.invoicePoLinks.crear(pendiente.invoice.id, [{ ocId: oc.id, montoAsignado: 400 }]);
    await repos.receiptConfirmations.crear({
      invoiceId: pendiente.invoice.id,
      bodegueroUserId: 'user-2',
      cantidades: { [itemA.id]: 999 },
      diferenciasDetectadas: null,
      confirmadoAt: new Date('2026-07-03T12:00:00.000Z'),
    });

    // Factura conciliada pero NO linkeada a esta OC: NO cuenta.
    const otraOc = await repos.ocs.crear({
      numero: 'OC-2026-002',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      montoTotal: 500,
      items: [{ pedidoItemId: 'item-c', cantidad: 3, precioUnitario: 50 }],
    });
    const conciliadaOtraOc = await repos.invoices.crear({
      numeroFactura: 'F-003',
      supplierId: 'supplier-1',
      projectId: 'proyecto-1',
      fecha: '2026-07-04',
      montoTotal: 500,
      fuenteAttachmentId: null,
      confianzaExtraccion: 0.9,
      registradaPor: 'user-1',
      items: [],
    });
    await repos.invoices.actualizarEstado(conciliadaOtraOc.invoice.id, 'conciliada');
    await repos.invoicePoLinks.crear(conciliadaOtraOc.invoice.id, [
      { ocId: otraOc.oc.id, montoAsignado: 500 },
    ]);
    await repos.receiptConfirmations.crear({
      invoiceId: conciliadaOtraOc.invoice.id,
      bodegueroUserId: 'user-2',
      cantidades: { [itemA.id]: 999 },
      diferenciasDetectadas: null,
      confirmadoAt: new Date('2026-07-04T12:00:00.000Z'),
    });

    const cobertura = await repos.cobertura.coberturaDeOc(oc.id);

    expect(cobertura).toEqual([
      { cantidad: 10, cantidadRecibida: 6 },
      { cantidad: 5, cantidadRecibida: 5 },
    ]);

    // Cruce con core: item A esta parcialmente cubierto (6 < 10) => OC recibida_parcial.
    expect(estadoObjetivoOc(cobertura, UMBRALES_COBERTURA)).toBe('recibida_parcial');

    // Si el item A tambien llega a cantidad completa, la OC pasa a recibida_total.
    const coberturaCompleta = [
      { cantidad: 10, cantidadRecibida: 10 },
      { cantidad: 5, cantidadRecibida: 5 },
    ];
    expect(estadoObjetivoOc(coberturaCompleta, UMBRALES_COBERTURA)).toBe('recibida_total');
  });

  it('estadosOcDePedido alimenta estadoObjetivoPedido (core) ignorando OCs anuladas', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const oc1 = await repos.ocs.crear({
      numero: 'OC-2026-010',
      pedidoId: 'pedido-x',
      supplierId: 'supplier-1',
      montoTotal: 100,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 100 }],
    });
    const oc2 = await repos.ocs.crear({
      numero: 'OC-2026-011',
      pedidoId: 'pedido-x',
      supplierId: 'supplier-2',
      montoTotal: 200,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 200 }],
    });
    const oc3 = await repos.ocs.crear({
      numero: 'OC-2026-012',
      pedidoId: 'pedido-x',
      supplierId: 'supplier-3',
      montoTotal: 300,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 300 }],
    });

    await repos.ocs.actualizarEstado(oc1.oc.id, 'recibida_total');
    await repos.ocs.actualizarEstado(oc2.oc.id, 'anulada');
    // oc3 se queda 'emitida' (sin recepcion).

    const estados = await repos.cobertura.estadosOcDePedido('pedido-x');
    expect(estados).toHaveLength(3);
    // La anulada NO bloquea la cobertura total: solo las no-anuladas cuentan (oc1 total, oc3
    // sin recepcion) => parcial, no total.
    expect(estadoObjetivoPedido(estados)).toBe('recepcion_parcial');

    // Si tambien oc3 llega a recibida_total, el pedido pasa a recepcion_total pese a oc2
    // anulada.
    await repos.ocs.actualizarEstado(oc3.oc.id, 'recibida_total');
    const estadosFinal = await repos.cobertura.estadosOcDePedido('pedido-x');
    expect(estadoObjetivoPedido(estadosFinal)).toBe('recepcion_total');
  });
});

describe('OcRepo (fake) — actualizarEstado valida con puedeTransicionarOc (core)', () => {
  it('permite una transicion valida de la tabla de la OC', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const { oc } = await repos.ocs.crear({
      numero: 'OC-2026-020',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      montoTotal: 100,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 100 }],
    });

    const actualizada = await repos.ocs.actualizarEstado(oc.id, 'confirmada');
    expect(actualizada.estado).toBe('confirmada');
  });

  it('rechaza una transicion invalida (fuera de la tabla de la OC)', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const { oc } = await repos.ocs.crear({
      numero: 'OC-2026-021',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      montoTotal: 100,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 100 }],
    });

    // 'confirmada' -> 'emitida' no existe en TRANSICIONES_OC.
    await repos.ocs.actualizarEstado(oc.id, 'confirmada');
    await expect(repos.ocs.actualizarEstado(oc.id, 'emitida')).rejects.toThrow(/invalida/);
  });

  it('rechaza cualquier transicion desde un estado terminal (recibida_total/anulada)', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const { oc } = await repos.ocs.crear({
      numero: 'OC-2026-022',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      montoTotal: 100,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 100 }],
    });

    await repos.ocs.actualizarEstado(oc.id, 'recibida_total');
    await expect(repos.ocs.actualizarEstado(oc.id, 'anulada')).rejects.toThrow(/terminal/);
  });
});

describe('QuoteRequestRepo (fake) — marcarVencidas (E1)', () => {
  it('marca vencida solo la enviada con plazo cumplido, y devuelve las afectadas con pedidoId', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const vencida: QuoteRequest = {
      id: 'qr-vencida',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      plazoAt: new Date('2026-07-01T12:00:00.000Z'),
      estado: 'enviada',
    };
    const vigente: QuoteRequest = {
      id: 'qr-vigente',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-2',
      plazoAt: new Date('2026-07-10T12:00:00.000Z'),
      estado: 'enviada',
    };
    const yaRespondida: QuoteRequest = {
      id: 'qr-respondida',
      pedidoId: 'pedido-2',
      supplierId: 'supplier-3',
      plazoAt: new Date('2026-07-01T12:00:00.000Z'),
      estado: 'respondida',
    };
    store.quoteRequests.push(vencida, vigente, yaRespondida);

    const ahora = new Date('2026-07-05T00:00:00.000Z');
    const afectadas = await repos.quoteRequests.marcarVencidas(ahora);

    expect(afectadas).toHaveLength(1);
    expect(afectadas[0]).toMatchObject({ id: 'qr-vencida', pedidoId: 'pedido-1', estado: 'vencida' });

    // Persistido en el store: la vigente y la ya-respondida quedan intactas.
    const porId = new Map(store.quoteRequests.map((qr) => [qr.id, qr]));
    expect(porId.get('qr-vencida')?.estado).toBe('vencida');
    expect(porId.get('qr-vigente')?.estado).toBe('enviada');
    expect(porId.get('qr-respondida')?.estado).toBe('respondida');
  });

  it('no afecta nada si ninguna enviada vencio', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    store.quoteRequests.push({
      id: 'qr-1',
      pedidoId: 'pedido-1',
      supplierId: 'supplier-1',
      plazoAt: new Date('2026-07-10T12:00:00.000Z'),
      estado: 'enviada',
    });

    const afectadas = await repos.quoteRequests.marcarVencidas(new Date('2026-07-05T00:00:00.000Z'));
    expect(afectadas).toHaveLength(0);
  });
});

describe('EquipmentRepo (fake) — trigger de cantidad_activa emulado', () => {
  it('recalcula cantidad_activa como Σ entradas − Σ devoluciones en cada movimiento', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const rental = await repos.equipment.crearRental({
      projectId: 'proyecto-1',
      supplierId: 'supplier-1',
      descripcionEquipo: 'Compactadora',
      cantidadInicial: 10,
      boletaAttachmentId: null,
    });
    expect(rental.cantidadActiva).toBe(0);

    const m1 = await repos.equipment.crearMovimiento({
      rentalId: rental.id,
      tipo: 'entrada',
      cantidad: 10,
      boletaAttachmentId: null,
      registradoPor: 'user-1',
      at: new Date('2026-07-01T08:00:00.000Z'),
    });
    expect(m1.rental.cantidadActiva).toBe(10);
    expect(alquilerDebeCerrarse(m1.rental.cantidadActiva)).toBe(false);

    const m2 = await repos.equipment.crearMovimiento({
      rentalId: rental.id,
      tipo: 'entrada',
      cantidad: 5,
      boletaAttachmentId: null,
      registradoPor: 'user-1',
      at: new Date('2026-07-02T08:00:00.000Z'),
    });
    expect(m2.rental.cantidadActiva).toBe(15);

    const m3 = await repos.equipment.crearMovimiento({
      rentalId: rental.id,
      tipo: 'devolucion',
      cantidad: 3,
      boletaAttachmentId: null,
      registradoPor: 'user-2',
      at: new Date('2026-07-03T08:00:00.000Z'),
    });
    expect(m3.rental.cantidadActiva).toBe(12);
    expect(alquilerDebeCerrarse(m3.rental.cantidadActiva)).toBe(false);

    const m4 = await repos.equipment.crearMovimiento({
      rentalId: rental.id,
      tipo: 'devolucion',
      cantidad: 12,
      boletaAttachmentId: null,
      registradoPor: 'user-2',
      at: new Date('2026-07-04T08:00:00.000Z'),
    });
    expect(m4.rental.cantidadActiva).toBe(0);
    expect(alquilerDebeCerrarse(m4.rental.cantidadActiva)).toBe(true);

    // rentalPorId refleja el mismo saldo recalculado (no un contador separado).
    const releido = await repos.equipment.rentalPorId(rental.id);
    expect(releido?.cantidadActiva).toBe(0);

    // La tool decide cerrar (guard alquilerDebeCerrarse vive fuera del repo); el repo solo
    // ejecuta el cierre cuando se lo piden.
    const cerrado = await repos.equipment.cerrarRental(rental.id, new Date('2026-07-04T09:00:00.000Z'));
    expect(cerrado.estado).toBe('cerrado');
    expect(cerrado.cerradoAt).not.toBeNull();

    const movimientos = await repos.equipment.movimientosPorRental(rental.id);
    expect(movimientos).toHaveLength(4);
  });

  it('rentalsActivosPorProyecto/Proveedor solo devuelven alquileres en estado activo', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const activo = await repos.equipment.crearRental({
      projectId: 'proyecto-1',
      supplierId: 'supplier-1',
      descripcionEquipo: 'Andamio',
      cantidadInicial: 4,
      boletaAttachmentId: null,
    });
    const paraCerrar = await repos.equipment.crearRental({
      projectId: 'proyecto-1',
      supplierId: 'supplier-1',
      descripcionEquipo: 'Vibrador',
      cantidadInicial: 1,
      boletaAttachmentId: null,
    });
    await repos.equipment.cerrarRental(paraCerrar.id, new Date('2026-07-01T00:00:00.000Z'));

    const activosProyecto = await repos.equipment.rentalsActivosPorProyecto('proyecto-1');
    expect(activosProyecto.map((r) => r.id)).toEqual([activo.id]);

    const activosProveedor = await repos.equipment.rentalsActivosPorProveedor('supplier-1');
    expect(activosProveedor.map((r) => r.id)).toEqual([activo.id]);
  });
});

describe('ReviewQueueRepo (fake) — abiertasPorPedido', () => {
  it('devuelve solo entradas pendiente del pedido pedido', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    await repos.reviewQueue.crear({
      tipo: 'cotizacion_incompleta',
      entidad: 'quote_responses',
      entidadId: 'qres-1',
      pedidoId: 'pedido-a',
      detalle: null,
    });
    const resuelta = await repos.reviewQueue.crear({
      tipo: 'diferencia_monto',
      entidad: 'invoices',
      entidadId: 'invoice-1',
      pedidoId: 'pedido-a',
      detalle: null,
    });
    await repos.reviewQueue.crear({
      tipo: 'nc_ambigua',
      entidad: 'credit_notes',
      entidadId: 'nc-1',
      pedidoId: 'pedido-b',
      detalle: null,
    });

    // Simula resolucion (no hay tool/metodo "resolver" en B2; se muta el store directamente
    // para probar que abiertasPorPedido filtra por estado, no solo por pedido_id).
    const index = store.reviewQueue.findIndex((e) => e.id === resuelta.id);
    const entradaResuelta: ReviewQueueEntry = { ...resuelta, estado: 'resuelta' };
    store.reviewQueue[index] = entradaResuelta;

    const abiertasA = await repos.reviewQueue.abiertasPorPedido('pedido-a');
    expect(abiertasA).toHaveLength(1);
    expect(abiertasA[0]?.entidadId).toBe('qres-1');

    const abiertasB = await repos.reviewQueue.abiertasPorPedido('pedido-b');
    expect(abiertasB).toHaveLength(1);

    const abiertasInexistente = await repos.reviewQueue.abiertasPorPedido('pedido-z');
    expect(abiertasInexistente).toHaveLength(0);
  });
});

describe('CreditNoteRepo (fake) — pendientesPorPedido (join invoice -> links -> OC -> pedido)', () => {
  it('encuentra NC pendientes via el join y las excluye tras aplicar', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const { oc } = await repos.ocs.crear({
      numero: 'OC-2026-030',
      pedidoId: 'pedido-nc',
      supplierId: 'supplier-1',
      montoTotal: 500,
      items: [{ pedidoItemId: null, cantidad: 1, precioUnitario: 500 }],
    });
    const { invoice } = await repos.invoices.crear({
      numeroFactura: 'F-100',
      supplierId: 'supplier-1',
      projectId: 'proyecto-1',
      fecha: '2026-07-01',
      montoTotal: 500,
      fuenteAttachmentId: null,
      confianzaExtraccion: 0.9,
      registradaPor: 'user-1',
      items: [],
    });
    await repos.invoicePoLinks.crear(invoice.id, [{ ocId: oc.id, montoAsignado: 500 }]);

    const nc = await repos.creditNotes.crear({
      numero: 'NC-001',
      invoiceId: invoice.id,
      monto: 50,
      motivo: 'Devolucion parcial',
      attachmentId: null,
    });

    // NC sin invoice_id (aun sin match, E6): no pertenece a ningun pedido todavia.
    const ncSinInvoice = await repos.creditNotes.crear({
      numero: 'NC-002',
      invoiceId: null,
      monto: 20,
      motivo: null,
      attachmentId: null,
    });
    void ncSinInvoice;

    let pendientes = await repos.creditNotes.pendientesPorPedido('pedido-nc');
    expect(pendientes.map((n: CreditNote) => n.id)).toEqual([nc.id]);

    await repos.creditNotes.aplicar(nc.id, 'user-1', new Date('2026-07-05T00:00:00.000Z'));

    pendientes = await repos.creditNotes.pendientesPorPedido('pedido-nc');
    expect(pendientes).toHaveLength(0);

    const aplicada = await repos.creditNotes.porId(nc.id);
    expect(aplicada?.estado).toBe('aplicada');
    expect(aplicada?.aplicadaPor).toBe('user-1');
  });
});

describe('DashboardLinkRepo (fake) — vigente vs expirado', () => {
  it('porTokenHashVigente solo devuelve el link si no ha expirado', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);

    const link: DashboardLink = await repos.dashboardLinks.crear({
      tokenHash: 'hash-abc',
      projectId: 'proyecto-1',
      expiresAt: new Date('2026-07-10T12:00:00.000Z'),
      createdBy: 'user-1',
    });
    expect(link.tokenHash).toBe('hash-abc');

    const vigente = await repos.dashboardLinks.porTokenHashVigente(
      'hash-abc',
      new Date('2026-07-10T00:00:00.000Z'),
    );
    expect(vigente?.projectId).toBe('proyecto-1');

    const expirado = await repos.dashboardLinks.porTokenHashVigente(
      'hash-abc',
      new Date('2026-07-11T00:00:00.000Z'),
    );
    expect(expirado).toBeNull();

    const inexistente = await repos.dashboardLinks.porTokenHashVigente(
      'hash-que-no-existe',
      new Date('2026-07-01T00:00:00.000Z'),
    );
    expect(inexistente).toBeNull();
  });
});

describe('ProyectoRepo (fake) — listarActivos', () => {
  it('devuelve solo proyectos activos', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    store.agregarProyecto({ id: 'p-activo', nombre: 'Activo', codigo: 'ACT', activo: true });
    store.agregarProyecto({ id: 'p-inactivo', nombre: 'Inactivo', codigo: 'INA', activo: false });

    const activos = await repos.proyectos.listarActivos();
    expect(activos.map((p) => p.id)).toEqual(['p-activo']);
  });
});
