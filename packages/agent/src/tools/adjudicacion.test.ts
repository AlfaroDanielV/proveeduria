import { describe, expect, it } from 'vitest';

import { aprobarGanador } from './adjudicacion.js';
import { crearFakeCtx, FakeToolStore, withFakeCtx } from '../runtime/fakes.js';
import type {
  Actor,
  Pedido,
  Proyecto,
  Proveedor,
  QuoteRequest,
  QuoteResponse,
  UsuarioInterno,
} from '../runtime/types.js';

const AHORA = new Date('2026-07-07T12:00:00.000Z');

const proyectoActivo: Proyecto = {
  id: '30000000-0000-4000-8000-000000000001',
  nombre: 'Residencial Lopez',
  codigo: 'LOP',
  activo: true,
};

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

const adminMateriales: UsuarioInterno = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
  telefonoWhatsapp: '+50688880002',
};

const proveedorRodex: Proveedor = {
  id: '40000000-0000-4000-8000-000000000001',
  nombre: 'Rodex',
  categorias: ['cemento', 'varilla', 'agregados'],
  activo: true,
  contactoPrincipal: {
    id: '50000000-0000-4000-8000-000000000001',
    supplierId: '40000000-0000-4000-8000-000000000001',
    nombre: 'Ventas Rodex',
    telefonoWhatsapp: '+50688881001',
    optinAt: AHORA,
    esPrincipal: true,
  },
};

const proveedorLagar: Proveedor = {
  id: '40000000-0000-4000-8000-000000000002',
  nombre: 'El Lagar',
  categorias: ['materiales', 'acabados', 'ferreteria'],
  activo: true,
  contactoPrincipal: {
    id: '50000000-0000-4000-8000-000000000002',
    supplierId: '40000000-0000-4000-8000-000000000002',
    nombre: 'Ventas El Lagar',
    telefonoWhatsapp: '+50688881002',
    optinAt: AHORA,
    esPrincipal: true,
  },
};

function storeBase(): FakeToolStore {
  const store = new FakeToolStore();
  store.agregarProyecto(proyectoActivo);
  store.agregarUsuario(adminMateriales);
  store.agregarProveedor(proveedorRodex);
  store.agregarProveedor(proveedorLagar);
  return store;
}

function pedidoBase(overrides: Partial<Pedido> = {}): Pedido {
  return {
    id: 'pedido-1',
    numero: 'PED-2026-001',
    projectId: proyectoActivo.id,
    solicitanteUserId: actorIngeniero.userId,
    estado: 'en_revision',
    fechaRequerida: null,
    urgencia: null,
    confirmadoAt: null,
    confirmadoPor: null,
    plazoCotizacionAt: null,
    ...overrides,
  };
}

function agregarPedidoConItems(store: FakeToolStore, pedido: Pedido = pedidoBase()): void {
  store.pedidos.set(pedido.id, pedido);
  store.itemsPorPedido.set(pedido.id, [
    {
      id: 'item-1',
      pedidoId: pedido.id,
      descripcion: 'Cemento gris',
      cantidad: 10,
      unidad: 'saco',
    },
    {
      id: 'item-2',
      pedidoId: pedido.id,
      descripcion: 'Varilla #4',
      cantidad: 25,
      unidad: 'unidad',
    },
  ]);
}

function quoteRequestBase(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    id: 'quote-request-1',
    pedidoId: 'pedido-1',
    supplierId: proveedorRodex.id,
    plazoAt: new Date('2026-07-08T12:00:00.000Z'),
    estado: 'respondida',
    ...overrides,
  };
}

function quoteResponseCompleta(
  id: string,
  quoteRequestId: string,
  overrides: Partial<QuoteResponse> = {},
): QuoteResponse {
  return {
    id,
    quoteRequestId,
    recibidoAt: AHORA,
    fuente: 'texto',
    condiciones: 'Credito 30 dias',
    plazoEntrega: '2 dias',
    confianzaExtraccion: 0.95,
    estado: 'completa',
    intentosRepregunta: 0,
    ...overrides,
  };
}

/**
 * Siembra el escenario feliz: pedido en_revision con 2 items, RFQ enviada a Rodex y
 * El Lagar, cada una respondida completa cotizando UNICAMENTE el item que se le
 * asignara despues (division entre 2 proveedores).
 */
function sembrarPedidoConDosCotizacionesCompletas(store: FakeToolStore): void {
  agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
  store.quoteRequests.push(
    quoteRequestBase({ id: 'quote-request-1', supplierId: proveedorRodex.id }),
    quoteRequestBase({ id: 'quote-request-2', supplierId: proveedorLagar.id }),
  );
  store.quoteResponses.push(
    quoteResponseCompleta('quote-response-1', 'quote-request-1'),
    quoteResponseCompleta('quote-response-2', 'quote-request-2'),
  );
  store.quoteItems.push(
    {
      id: 'quote-item-1',
      quoteResponseId: 'quote-response-1',
      pedidoItemId: 'item-1',
      precioUnitario: 4500,
      cantidad: 10,
      disponible: true,
      notas: null,
    },
    {
      id: 'quote-item-2',
      quoteResponseId: 'quote-response-2',
      pedidoItemId: 'item-2',
      precioUnitario: 1250,
      cantidad: 25,
      disponible: true,
      notas: null,
    },
  );
}

describe('aprobarGanador', () => {
  it('adjudica con division entre 2 proveedores: approval normativo, estado aprobado y audit', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'] },
        { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value).toMatchObject({
      pedidoId: 'pedido-1',
      numero: 'PED-2026-001',
      estado: 'aprobado',
    });
    expect(result.value.asignaciones).toEqual([
      { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'], quoteResponseId: 'quote-response-1' },
      { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'], quoteResponseId: 'quote-response-2' },
    ]);
    expect(result.value.comparativo.filas.length).toBeGreaterThan(0);
    expect(result.value.comparativo.resumenProveedores.length).toBe(2);

    expect(store.pedidos.get('pedido-1')?.estado).toBe('aprobado');

    expect(store.approvalEvents).toEqual([
      {
        tipo: 'ganador',
        pedidoId: 'pedido-1',
        canal: 'whatsapp',
        detalle: {
          asignaciones: [
            { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'], quoteResponseId: 'quote-response-1' },
            { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'], quoteResponseId: 'quote-response-2' },
          ],
          comparativo: result.value.comparativo,
        },
      },
    ]);
    expect(store.approvalEvents[0]?.detalle).toMatchObject({
      comparativo: {
        pedidoId: 'pedido-1',
        numero: 'PED-2026-001',
      },
    });

    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'aprobar_ganador',
      entidad: 'pedido',
      entidadId: 'pedido-1',
      pedidoId: 'pedido-1',
    });
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza rol insuficiente sin efectos', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza pedido en estado distinto de en_revision con E12 sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('E12');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('cotizando');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza item sin asignar sin efectos', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('Faltan items por asignar');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza item duplicado entre asignaciones sin efectos', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-2'] },
        { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('mas de un proveedor');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza supplier duplicado entre asignaciones sin efectos', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'] },
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('mas de una asignacion');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza item ajeno al pedido sin efectos', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-ajeno'] },
        { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('no pertenece al pedido');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza proveedor sin respuesta completa sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
    store.quoteRequests.push(
      quoteRequestBase({ id: 'quote-request-1', supplierId: proveedorRodex.id, estado: 'enviada' }),
    );

    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('no tiene una cotizacion completa');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza proveedor que no cotizo un item asignado sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
    store.quoteRequests.push(
      quoteRequestBase({ id: 'quote-request-1', supplierId: proveedorRodex.id }),
    );
    store.quoteResponses.push(quoteResponseCompleta('quote-response-1', 'quote-request-1'));
    // Solo cotizo item-1; item-2 queda sin quote_item.
    store.quoteItems.push({
      id: 'quote-item-1',
      quoteResponseId: 'quote-response-1',
      pedidoItemId: 'item-1',
      precioUnitario: 4500,
      cantidad: 10,
      disponible: true,
      notas: null,
    });

    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await aprobarGanador({
      pedidoId: 'pedido-1',
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-2'] },
      ],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia aprobar ganador.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('no cotizo el item');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('revierte todo si falla la auditoria despues de escribir approval y estado', async () => {
    const store = storeBase();
    sembrarPedidoConDosCotizacionesCompletas(store);
    store.failAudit = true;

    await expect(
      withFakeCtx(store, actorAdminMateriales, AHORA, async (ctx) => aprobarGanador({
        pedidoId: 'pedido-1',
        asignaciones: [
          { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'] },
          { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'] },
        ],
      }, ctx)),
    ).rejects.toThrow('Fallo de auditoria fake.');

    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });
});
