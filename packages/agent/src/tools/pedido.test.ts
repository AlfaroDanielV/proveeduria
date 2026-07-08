import { describe, expect, it } from 'vitest';

import { confirmarPedido, crearPedido, enviarRfq, sugerirProveedores } from './pedido.js';
import { crearFakeCtx, FakeToolStore, withFakeCtx } from '../runtime/fakes.js';
import type { Actor, Pedido, Proyecto, Proveedor, UsuarioInterno } from '../runtime/types.js';

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

const actorBodeguero: Actor = {
  userId: '20000000-0000-4000-8000-000000000005',
  nombre: 'Bodeguero',
  roles: ['bodeguero'],
};

const actorOtroIngeniero: Actor = {
  userId: '20000000-0000-4000-8000-000000000099',
  nombre: 'Otro Ingeniero',
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
    estado: 'borrador',
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

describe('crearPedido', () => {
  it('crea pedido en borrador con numero, items y un audit_event', async () => {
    const store = storeBase();
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await crearPedido({
      projectId: proyectoActivo.id,
      items: [
        { descripcion: 'Cemento', cantidad: 10, unidad: 'saco' },
        { descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
      ],
      fechaRequerida: '2026-07-10',
      urgencia: 'alta',
    }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value).toMatchObject({
      numero: 'PED-2026-001',
      estado: 'borrador',
      proyecto: { id: proyectoActivo.id, nombre: proyectoActivo.nombre, codigo: 'LOP' },
      fechaRequerida: '2026-07-10',
      urgencia: 'alta',
    });
    expect(result.value.items).toHaveLength(2);
    expect(store.pedidos.size).toBe(1);
    expect([...store.itemsPorPedido.values()][0]).toHaveLength(2);
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'crear_pedido',
      entidad: 'pedido',
      entidadId: result.value.pedidoId,
    });
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza rol no permitido sin efectos', async () => {
    const store = storeBase();
    const ctx = crearFakeCtx(store, actorBodeguero, AHORA);

    const result = await crearPedido({
      projectId: proyectoActivo.id,
      items: [{ descripcion: 'Cemento', cantidad: 1, unidad: 'saco' }],
    }, ctx);

    expect(result).toEqual({
      ok: false,
      error: {
        codigo: 'rol_insuficiente',
        mensaje: 'No tenes permiso para usar esta herramienta.',
      },
    });
    expect(store.pedidos.size).toBe(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('devuelve E7 y no crea nada si el proyecto no esta activo', async () => {
    const store = new FakeToolStore();
    store.agregarProyecto({ ...proyectoActivo, activo: false });
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await crearPedido({
      projectId: proyectoActivo.id,
      items: [{ descripcion: 'Cemento', cantidad: 1, unidad: 'saco' }],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('El pedido no debia crearse.');
    expect(result.error.codigo).toBe('E7');
    expect(store.pedidos.size).toBe(0);
    expect(store.itemsPorPedido.size).toBe(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.pedidoSeq).toBe(1);
  });

  it.each<[unknown, string]>([
    [{ projectId: proyectoActivo.id, items: [] }, 'al menos un item'],
    [
      {
        projectId: proyectoActivo.id,
        items: [{ descripcion: 'Cemento', cantidad: 0, unidad: 'saco' }],
      },
      'mayor que 0',
    ],
    [
      {
        projectId: proyectoActivo.id,
        items: [{ descripcion: 'Cemento', cantidad: 1, unidad: '' }],
      },
      'necesita unidad',
    ],
    [
      {
        projectId: proyectoActivo.id,
        items: [{ descripcion: 'Cemento', cantidad: 1, unidad: 'saco', extra: true }],
      },
      'campos invalidos',
    ],
  ])('rechaza input invalido sin efectos', async (input, mensaje) => {
    const store = storeBase();
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await crearPedido(input, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('El pedido no debia crearse.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain(mensaje);
    expect(store.pedidos.size).toBe(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});

describe('confirmarPedido', () => {
  it('confirma el solicitante, registra audit y encola notificacion interna', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoBase());
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await confirmarPedido({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value).toMatchObject({
      pedidoId: 'pedido-1',
      numero: 'PED-2026-001',
      estado: 'borrador',
      confirmadoAt: AHORA,
      confirmadoPor: actorIngeniero.userId,
      notificaciones: 1,
    });
    expect(store.pedidos.get('pedido-1')).toMatchObject({
      confirmadoAt: AHORA,
      confirmadoPor: actorIngeniero.userId,
    });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'confirmar_pedido',
      entidad: 'pedido',
      entidadId: 'pedido-1',
    });
    expect(store.outboxMessages).toEqual([
      {
        destino: '+50688880002',
        template: 'notificacion_interna',
        payload: {
          variables: [
            'Jose Pablo',
            'Pedido PED-2026-001 confirmado por Ingeniero de Obra.',
          ],
          pedido_id: 'pedido-1',
        },
      },
    ]);
  });

  it('rechaza un usuario que no es el solicitante sin efectos', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoBase());
    const ctx = crearFakeCtx(store, actorOtroIngeniero, AHORA);

    const result = await confirmarPedido({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('El pedido no debia confirmarse.');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.pedidos.get('pedido-1')?.confirmadoAt).toBeNull();
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza pedido inexistente sin efectos', async () => {
    const store = storeBase();
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await confirmarPedido({ pedidoId: 'pedido-x' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('El pedido no debia existir.');
    expect(result.error.codigo).toBe('no_encontrado');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza pedido no-borrador con E12 sin efectos', async () => {
    const store = storeBase();
    store.pedidos.set('pedido-1', pedidoBase({ estado: 'cotizando' }));
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await confirmarPedido({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('El pedido no debia confirmarse.');
    expect(result.error.codigo).toBe('E12');
    expect(store.pedidos.get('pedido-1')?.confirmadoAt).toBeNull();
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});

describe('sugerirProveedores', () => {
  it('devuelve ranking editable de proveedores con contacto opt-in y registra audit', async () => {
    const store = storeBase();
    agregarPedidoConItems(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await sugerirProveedores({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value.numero).toBe('PED-2026-001');
    expect(result.value.proveedores.map((p) => p.supplierId)).toEqual([
      proveedorRodex.id,
      proveedorLagar.id,
    ]);
    expect(result.value.proveedores[0]).toMatchObject({
      supplierId: proveedorRodex.id,
      puntaje: 20,
      razones: ['categoria: cemento', 'categoria: varilla'],
    });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'sugerir_proveedores',
      entidad: 'pedido',
      entidadId: 'pedido-1',
    });
    expect(store.outboxMessages).toHaveLength(0);
    expect(store.quoteRequests).toHaveLength(0);
  });

  it('rechaza rol no permitido sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store);
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await sugerirProveedores({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia sugerir proveedores.');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});

describe('enviarRfq', () => {
  it('crea quote_requests, approval, audit, outbox y transiciona a cotizando', async () => {
    const store = storeBase();
    agregarPedidoConItems(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await enviarRfq({
      pedidoId: 'pedido-1',
      supplierIds: [proveedorRodex.id, proveedorLagar.id],
      plazoHoras: 12,
    }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value).toMatchObject({
      pedidoId: 'pedido-1',
      numero: 'PED-2026-001',
      estado: 'cotizando',
      supplierIds: [proveedorRodex.id, proveedorLagar.id],
      outbox: 2,
    });
    expect(result.value.plazoAt.toISOString()).toBe('2026-07-08T00:00:00.000Z');
    expect(store.pedidos.get('pedido-1')).toMatchObject({
      estado: 'cotizando',
      plazoCotizacionAt: result.value.plazoAt,
    });
    expect(store.quoteRequests).toHaveLength(2);
    expect(store.approvalEvents).toEqual([
      {
        tipo: 'lista_proveedores',
        pedidoId: 'pedido-1',
        canal: 'whatsapp',
        detalle: {
          supplier_ids: [proveedorRodex.id, proveedorLagar.id],
          plazo_horas: 12,
          plazo_at: '2026-07-08T00:00:00.000Z',
        },
      },
    ]);
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'enviar_rfq',
      entidad: 'pedido',
      entidadId: 'pedido-1',
    });
    expect(store.outboxMessages).toHaveLength(2);
    expect(store.outboxMessages[0]).toMatchObject({
      destino: '+50688881001',
      template: 'rfq_solicitud',
      payload: {
        variables: [
          'Ventas Rodex',
          'Residencial Lopez',
          '1. Cemento gris - 10 saco\n2. Varilla #4 - 25 unidad',
          '2026-07-08T00:00:00.000Z',
          'PED-2026-001',
        ],
        pedido_id: 'pedido-1',
        supplier_id: proveedorRodex.id,
      },
    });
  });

  it('rechaza rol no permitido sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store);
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await enviarRfq({
      pedidoId: 'pedido-1',
      supplierIds: [proveedorRodex.id],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia enviar RFQ.');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('borrador');
    expect(store.quoteRequests).toHaveLength(0);
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza estado no-borrador con E12 sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await enviarRfq({
      pedidoId: 'pedido-1',
      supplierIds: [proveedorRodex.id],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia enviar RFQ.');
    expect(result.error.codigo).toBe('E12');
    expect(store.quoteRequests).toHaveLength(0);
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza proveedor sin opt-in sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store);
    store.agregarProveedor({
      ...proveedorRodex,
      id: 'proveedor-sin-optin',
      contactoPrincipal: {
        id: 'contacto-sin-optin',
        supplierId: 'proveedor-sin-optin',
        nombre: 'Sin Optin',
        telefonoWhatsapp: '+50688889999',
        optinAt: null,
        esPrincipal: true,
      },
    });
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await enviarRfq({
      pedidoId: 'pedido-1',
      supplierIds: ['proveedor-sin-optin'],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia enviar RFQ.');
    expect(result.error.codigo).toBe('validacion');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('borrador');
    expect(store.quoteRequests).toHaveLength(0);
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});

describe('runtime fake transaccional', () => {
  it('revierte estado si falla despues de escribir dominio', async () => {
    const store = storeBase();
    store.failAudit = true;

    await expect(
      withFakeCtx(store, actorIngeniero, AHORA, async (ctx) => crearPedido({
        projectId: proyectoActivo.id,
        items: [{ descripcion: 'Cemento', cantidad: 1, unidad: 'saco' }],
      }, ctx)),
    ).rejects.toThrow('Fallo de auditoria fake.');

    expect(store.pedidos.size).toBe(0);
    expect(store.itemsPorPedido.size).toBe(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
    expect(store.pedidoSeq).toBe(1);
  });

  it('revierte estado si falla outbox despues de approval y quote_requests', async () => {
    const store = storeBase();
    agregarPedidoConItems(store);
    store.failOutbox = true;

    await expect(
      withFakeCtx(store, actorAdminMateriales, AHORA, async (ctx) => enviarRfq({
        pedidoId: 'pedido-1',
        supplierIds: [proveedorRodex.id],
      }, ctx)),
    ).rejects.toThrow('Fallo de outbox fake.');

    expect(store.pedidos.get('pedido-1')?.estado).toBe('borrador');
    expect(store.quoteRequests).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});
