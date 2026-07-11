import { describe, expect, it } from 'vitest';

import { procesarVencimientos } from './vencimientos.js';
import { crearFakeCtx, FakeToolStore, withFakeCtx } from '../runtime/fakes.js';
import { ACTOR_SISTEMA } from '../runtime/context-sistema.js';
import type {
  Pedido,
  Proyecto,
  Proveedor,
  QuoteRequest,
  UsuarioInterno,
} from '../runtime/types.js';

// El cron corre "ahora"; los plazos vencidos quedan antes y los vigentes despues.
const AHORA = new Date('2026-07-08T12:00:00.000Z');
const PLAZO_VENCIDO = new Date('2026-07-07T12:00:00.000Z');
const PLAZO_VIGENTE = new Date('2026-07-09T12:00:00.000Z');

const proyectoActivo: Proyecto = {
  id: '30000000-0000-4000-8000-000000000001',
  nombre: 'Residencial Lopez',
  codigo: 'LOP',
  activo: true,
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

function pedidoCotizando(overrides: Partial<Pedido> = {}): Pedido {
  return {
    id: 'pedido-1',
    numero: 'PED-2026-001',
    projectId: proyectoActivo.id,
    solicitanteUserId: '20000000-0000-4000-8000-000000000004',
    estado: 'cotizando',
    fechaRequerida: null,
    urgencia: null,
    confirmadoAt: null,
    confirmadoPor: null,
    plazoCotizacionAt: PLAZO_VENCIDO,
    ...overrides,
  };
}

function agregarItems(store: FakeToolStore, pedidoId = 'pedido-1'): void {
  store.itemsPorPedido.set(pedidoId, [
    { id: 'item-1', pedidoId, descripcion: 'Cemento gris', cantidad: 10, unidad: 'saco' },
    { id: 'item-2', pedidoId, descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
  ]);
}

function quoteRequest(
  id: string,
  supplierId: string,
  plazoAt: Date,
  overrides: Partial<QuoteRequest> = {},
): QuoteRequest {
  return {
    id,
    pedidoId: 'pedido-1',
    supplierId,
    plazoAt,
    estado: 'enviada',
    ...overrides,
  };
}

describe('procesarVencimientos', () => {
  it('vence 1 de 2 RFQs: sin transicion, con notificacion E1 y audit', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoCotizando());
    agregarItems(store);
    store.quoteRequests.push(
      quoteRequest('qr-vencida', proveedorRodex.id, PLAZO_VENCIDO),
      quoteRequest('qr-vigente', proveedorLagar.id, PLAZO_VIGENTE),
    );
    const ctx = crearFakeCtx(store, ACTOR_SISTEMA, AHORA);

    const result = await procesarVencimientos(ctx, AHORA);

    expect(result).toEqual({ vencidas: 1, pedidosTransicionados: 0 });
    expect(store.quoteRequests.find((qr) => qr.id === 'qr-vencida')?.estado).toBe('vencida');
    expect(store.quoteRequests.find((qr) => qr.id === 'qr-vigente')?.estado).toBe('enviada');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('cotizando');

    // Solo el audit E1 (no hubo comparativo).
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'e1_vencimiento',
      entidad: 'pedido',
      entidadId: 'pedido-1',
      despues: {
        pedido_id: 'pedido-1',
        quote_request_ids_vencidos: ['qr-vencida'],
        supplier_ids_vencidos: [proveedorRodex.id],
        transiciono_a_en_revision: false,
      },
    });

    expect(store.outboxMessages).toHaveLength(1);
    const notif = store.outboxMessages[0];
    expect(notif).toMatchObject({
      destino: '+50688880002',
      template: 'notificacion_interna',
      payload: { pedido_id: 'pedido-1' },
    });
    const variables = (notif?.payload as { variables: string[] }).variables;
    expect(variables[0]).toBe('Jose Pablo');
    expect(variables[1]).toContain('PED-2026-001');
    expect(variables[1]).toContain('Rodex');
    expect(variables[1]).toContain('extender plazo');
    expect(variables[1]).toContain('continuar con lo recibido');
  });

  it('vencen todas las RFQs restantes: transiciona a en_revision con comparativo y notifica', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoCotizando());
    agregarItems(store);
    store.quoteRequests.push(
      quoteRequest('qr-1', proveedorRodex.id, PLAZO_VENCIDO),
      quoteRequest('qr-2', proveedorLagar.id, PLAZO_VENCIDO),
    );
    const ctx = crearFakeCtx(store, ACTOR_SISTEMA, AHORA);

    const result = await procesarVencimientos(ctx, AHORA);

    expect(result).toEqual({ vencidas: 2, pedidosTransicionados: 1 });
    expect(store.quoteRequests.every((qr) => qr.estado === 'vencida')).toBe(true);
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');

    // El comparativo (del helper compartido) se audita antes que el e1_vencimiento.
    expect(store.auditEvents.map((e) => e.accion)).toEqual([
      'generar_comparativo',
      'e1_vencimiento',
    ]);
    expect(store.auditEvents[1]).toMatchObject({
      accion: 'e1_vencimiento',
      despues: {
        quote_request_ids_vencidos: ['qr-1', 'qr-2'],
        supplier_ids_vencidos: [proveedorRodex.id, proveedorLagar.id],
        transiciono_a_en_revision: true,
      },
    });

    // Notificacion del comparativo + notificacion E1, ambas internas.
    expect(store.outboxMessages).toHaveLength(2);
    expect(store.outboxMessages[0]?.payload).toMatchObject({
      portal_path: '/pedidos/pedido-1/comparativo',
    });
    const e1 = store.outboxMessages[1];
    expect(e1).toMatchObject({ template: 'notificacion_interna', payload: { pedido_id: 'pedido-1' } });
    expect((e1?.payload as { variables: string[] }).variables[1]).toContain('El Lagar');
  });

  it('pedido ya en_revision: marca vencida pero no transiciona, notifica ni audita', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoCotizando({ estado: 'en_revision' }));
    agregarItems(store);
    store.quoteRequests.push(quoteRequest('qr-1', proveedorRodex.id, PLAZO_VENCIDO));
    const ctx = crearFakeCtx(store, ACTOR_SISTEMA, AHORA);

    const result = await procesarVencimientos(ctx, AHORA);

    expect(result).toEqual({ vencidas: 1, pedidosTransicionados: 0 });
    expect(store.quoteRequests[0]?.estado).toBe('vencida');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('nada vencido: no-op sin efectos', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoCotizando());
    agregarItems(store);
    store.quoteRequests.push(quoteRequest('qr-1', proveedorRodex.id, PLAZO_VIGENTE));
    const ctx = crearFakeCtx(store, ACTOR_SISTEMA, AHORA);

    const result = await procesarVencimientos(ctx, AHORA);

    expect(result).toEqual({ vencidas: 0, pedidosTransicionados: 0 });
    expect(store.quoteRequests[0]?.estado).toBe('enviada');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('revierte todo si el comparativo falla al transicionar', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoCotizando());
    // Sin items: comparativos.porPedido devuelve [] -> generarComparativo err -> throw.
    store.quoteRequests.push(
      quoteRequest('qr-1', proveedorRodex.id, PLAZO_VENCIDO),
      quoteRequest('qr-2', proveedorLagar.id, PLAZO_VENCIDO),
    );

    await expect(
      withFakeCtx(store, ACTOR_SISTEMA, AHORA, async (ctx) => procesarVencimientos(ctx, AHORA)),
    ).rejects.toThrow('No se pudo generar comparativo');

    // withFakeCtx restaura el snapshot: nada quedo persistido.
    expect(store.quoteRequests.every((qr) => qr.estado === 'enviada')).toBe(true);
    expect(store.pedidos.get('pedido-1')?.estado).toBe('cotizando');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});
