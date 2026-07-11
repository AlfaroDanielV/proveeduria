import { describe, expect, it } from 'vitest';

import {
  confirmarPedido,
  crearPedido,
  enviarRfq,
  generarComparativo,
  registrarCotizacion,
  sugerirProveedores,
} from './pedido.js';
import { crearFakeCtx, FakeToolStore, withFakeCtx } from '../runtime/fakes.js';
import { ACTOR_SISTEMA } from '../runtime/context-sistema.js';
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

function quoteRequestBase(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    id: 'quote-request-1',
    pedidoId: 'pedido-1',
    supplierId: proveedorRodex.id,
    plazoAt: new Date('2026-07-08T12:00:00.000Z'),
    estado: 'enviada',
    ...overrides,
  };
}

function quoteResponseIncompleta(id: string): QuoteResponse {
  return {
    id,
    quoteRequestId: 'quote-request-1',
    recibidoAt: AHORA,
    fuente: 'texto',
    condiciones: null,
    plazoEntrega: null,
    confianzaExtraccion: 0.5,
    estado: 'incompleta',
    intentosRepregunta: 1,
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

describe('generarComparativo', () => {
  it('genera matriz item x proveedor, audita y encola notificacion interna', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
    store.quoteRequests.push(
      quoteRequestBase({
        id: 'quote-request-1',
        supplierId: proveedorRodex.id,
        estado: 'respondida',
      }),
      quoteRequestBase({
        id: 'quote-request-2',
        supplierId: proveedorLagar.id,
        estado: 'respondida',
      }),
    );
    store.quoteResponses.push(
      quoteResponseCompleta('quote-response-1', 'quote-request-1', {
        condiciones: 'Credito 30 dias',
        plazoEntrega: '2 dias',
      }),
      quoteResponseCompleta('quote-response-2', 'quote-request-2', {
        condiciones: 'Contado',
        plazoEntrega: '3 dias',
      }),
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
        quoteResponseId: 'quote-response-1',
        pedidoItemId: 'item-2',
        precioUnitario: 1200,
        cantidad: 25,
        disponible: true,
        notas: null,
      },
      {
        id: 'quote-item-3',
        quoteResponseId: 'quote-response-2',
        pedidoItemId: 'item-1',
        precioUnitario: 4600,
        cantidad: 10,
        disponible: true,
        notas: 'Entrega parcial de otros materiales',
      },
    );
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await generarComparativo({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value).toMatchObject({
      pedidoId: 'pedido-1',
      numero: 'PED-2026-001',
      estado: 'en_revision',
      portalPath: '/pedidos/pedido-1/comparativo',
      notificaciones: 1,
    });
    expect(result.value.filas).toHaveLength(4);
    expect(result.value.filas).toEqual([
      expect.objectContaining({
        pedidoItemId: 'item-1',
        proveedor: 'Rodex',
        precioUnitario: 4500,
        cantidadCotizada: 10,
        subtotal: 45000,
        faltante: false,
      }),
      expect.objectContaining({
        pedidoItemId: 'item-1',
        proveedor: 'El Lagar',
        precioUnitario: 4600,
        cantidadCotizada: 10,
        subtotal: 46000,
        faltante: false,
      }),
      expect.objectContaining({
        pedidoItemId: 'item-2',
        proveedor: 'Rodex',
        precioUnitario: 1200,
        cantidadCotizada: 25,
        subtotal: 30000,
        faltante: false,
      }),
      expect.objectContaining({
        pedidoItemId: 'item-2',
        proveedor: 'El Lagar',
        precioUnitario: null,
        cantidadCotizada: null,
        subtotal: null,
        faltante: true,
      }),
    ]);
    expect(result.value.resumenProveedores).toEqual([
      {
        supplierId: proveedorRodex.id,
        nombre: 'Rodex',
        quoteRequestId: 'quote-request-1',
        quoteRequestEstado: 'respondida',
        quoteResponseId: 'quote-response-1',
        condiciones: 'Credito 30 dias',
        plazoEntrega: '2 dias',
        total: 75000,
        itemsCotizados: 2,
        itemsFaltantes: 0,
      },
      {
        supplierId: proveedorLagar.id,
        nombre: 'El Lagar',
        quoteRequestId: 'quote-request-2',
        quoteRequestEstado: 'respondida',
        quoteResponseId: 'quote-response-2',
        condiciones: 'Contado',
        plazoEntrega: '3 dias',
        total: 46000,
        itemsCotizados: 1,
        itemsFaltantes: 1,
      },
    ]);
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'generar_comparativo',
      entidad: 'pedido',
      entidadId: 'pedido-1',
    });
    expect(store.outboxMessages).toHaveLength(1);
    expect(store.outboxMessages[0]).toMatchObject({
      destino: '+50688880002',
      template: 'notificacion_interna',
      payload: {
        variables: [
          'Jose Pablo',
          'Comparativo PED-2026-001 listo. Rodex: CRC 75000.00, 0 faltantes; El Lagar: CRC 46000.00, 1 faltantes',
        ],
        pedido_id: 'pedido-1',
        portal_path: '/pedidos/pedido-1/comparativo',
      },
    });
  });

  it('rechaza rol no permitido sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await generarComparativo({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia generar comparativo.');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza pedido que aun no esta en_revision sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await generarComparativo({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia generar comparativo.');
    expect(result.error.codigo).toBe('E12');
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
  });
});

describe('registrarCotizacion', () => {
  it('registra cotizacion completa y transiciona a en_revision si no quedan pendientes', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      condiciones: 'Credito 30 dias',
      plazoEntrega: '2 dias',
      confianzaExtraccion: 0.95,
      items: [
        {
          pedidoItemId: 'item-1',
          precioUnitario: 4500,
          cantidad: 10,
          disponible: true,
        },
        {
          pedidoItemId: 'item-2',
          precioUnitario: 1200,
          cantidad: 25,
          disponible: true,
        },
      ],
    }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value).toMatchObject({
      quoteRequestId: 'quote-request-1',
      pedidoId: 'pedido-1',
      pedidoEstado: 'en_revision',
      transicionoAEnRevision: true,
    });
    expect(result.value.comparativo).toMatchObject({
      pedidoId: 'pedido-1',
      numero: 'PED-2026-001',
      estado: 'en_revision',
      notificaciones: 1,
    });
    expect(result.value.comparativo?.filas).toHaveLength(2);
    expect(result.value.comparativo?.resumenProveedores).toEqual([
      {
        supplierId: proveedorRodex.id,
        nombre: 'Rodex',
        quoteRequestId: 'quote-request-1',
        quoteRequestEstado: 'respondida',
        quoteResponseId: result.value.quoteResponse.id,
        condiciones: 'Credito 30 dias',
        plazoEntrega: '2 dias',
        total: 75000,
        itemsCotizados: 2,
        itemsFaltantes: 0,
      },
    ]);
    expect(store.quoteResponses).toHaveLength(1);
    expect(store.quoteResponses[0]).toMatchObject({
      estado: 'completa',
      confianzaExtraccion: 0.95,
    });
    expect(store.quoteItems).toHaveLength(2);
    expect(store.quoteRequests[0]?.estado).toBe('respondida');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('en_revision');
    expect(store.auditEvents).toHaveLength(2);
    expect(store.auditEvents[0]).toMatchObject({
      accion: 'registrar_cotizacion',
      entidad: 'quote_response',
    });
    expect(store.auditEvents[1]).toMatchObject({
      accion: 'generar_comparativo',
      entidad: 'pedido',
      entidadId: 'pedido-1',
    });
    expect(store.outboxMessages).toHaveLength(1);
    expect(store.outboxMessages[0]).toMatchObject({
      destino: '+50688880002',
      template: 'notificacion_interna',
      payload: {
        variables: [
          'Jose Pablo',
          'Comparativo PED-2026-001 listo. Rodex: CRC 75000.00, 0 faltantes',
        ],
        pedido_id: 'pedido-1',
        portal_path: '/pedidos/pedido-1/comparativo',
      },
    });
  });

  it('acepta el ACTOR SISTEMA (via flujo proveedor) aunque no tenga roles', async () => {
    // tools.md §registrar_cotizacion "Actor": el mensaje de proveedor corre como actor sistema
    // (sin roles); la tool lo acepta SOLO por esa via.
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    const ctx = crearFakeCtx(store, ACTOR_SISTEMA, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      confianzaExtraccion: 0.95,
      items: [
        { pedidoItemId: 'item-1', precioUnitario: 4500, cantidad: 10, disponible: true },
        { pedidoItemId: 'item-2', precioUnitario: 1200, cantidad: 25, disponible: true },
      ],
    }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(store.quoteResponses).toHaveLength(1);
  });

  it('rechaza a un actor con rol insuficiente (ingeniero) — no relaja la validacion por roles', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      confianzaExtraccion: 0.95,
      items: [{ pedidoItemId: 'item-1', precioUnitario: 4500, cantidad: 10, disponible: true }],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('no deberia permitir a un ingeniero');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.quoteResponses).toHaveLength(0);
  });

  it('registra E2 incompleta y encola repregunta al proveedor sin marcar respondida', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      confianzaExtraccion: 0.5,
      items: [],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('La cotizacion debia quedar incompleta.');
    expect(result.error.codigo).toBe('E2');
    expect(store.quoteResponses).toHaveLength(1);
    expect(store.quoteResponses[0]).toMatchObject({
      estado: 'incompleta',
      intentosRepregunta: 1,
    });
    expect(store.quoteRequests[0]?.estado).toBe('enviada');
    expect(store.pedidos.get('pedido-1')?.estado).toBe('cotizando');
    expect(store.reviewQueue).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(1);
    expect(store.outboxMessages[0]).toMatchObject({
      destino: '+50688881001',
      texto: 'No logramos identificar precio y cantidad en la cotizacion del pedido PED-2026-001. ¿Nos lo confirmas por favor?',
    });
    expect(store.auditEvents).toHaveLength(1);
  });

  it('escala E2 a review_queue despues de dos repreguntas previas', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    store.quoteResponses.push(
      quoteResponseIncompleta('quote-response-prev-1'),
      quoteResponseIncompleta('quote-response-prev-2'),
    );
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      confianzaExtraccion: 0.5,
      items: [],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('La cotizacion debia escalarse.');
    expect(result.error.codigo).toBe('E2');
    expect(store.reviewQueue).toHaveLength(1);
    expect(store.reviewQueue[0]).toMatchObject({
      tipo: 'cotizacion_incompleta',
      entidad: 'quote_responses',
      pedidoId: 'pedido-1',
    });
    expect(store.outboxMessages).toHaveLength(1);
    expect(store.outboxMessages[0]).toMatchObject({
      destino: '+50688880002',
      template: 'notificacion_interna',
    });
    expect(store.quoteRequests[0]?.estado).toBe('enviada');
  });

  it('rechaza pedido que no esta cotizando sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'borrador' }));
    store.quoteRequests.push(quoteRequestBase());
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      confianzaExtraccion: 0.95,
      items: [{ pedidoItemId: 'item-1', precioUnitario: 1, cantidad: 1 }],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia registrar cotizacion.');
    expect(result.error.codigo).toBe('E12');
    expect(store.quoteResponses).toHaveLength(0);
    expect(store.quoteItems).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
  });

  it('rechaza pedido_item_id que no pertenece al pedido sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await registrarCotizacion({
      quoteRequestId: 'quote-request-1',
      fuente: 'texto',
      confianzaExtraccion: 0.95,
      items: [{ pedidoItemId: 'item-ajeno', precioUnitario: 1, cantidad: 1 }],
    }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia registrar cotizacion.');
    expect(result.error.codigo).toBe('validacion');
    expect(store.quoteResponses).toHaveLength(0);
    expect(store.quoteItems).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
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

  it('revierte cotizacion incompleta si falla outbox de repregunta', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    store.quoteRequests.push(quoteRequestBase());
    store.failOutbox = true;

    await expect(
      withFakeCtx(store, actorAdminMateriales, AHORA, async (ctx) => registrarCotizacion({
        quoteRequestId: 'quote-request-1',
        fuente: 'texto',
        confianzaExtraccion: 0.5,
        items: [],
      }, ctx)),
    ).rejects.toThrow('Fallo de outbox fake.');

    expect(store.quoteResponses).toHaveLength(0);
    expect(store.quoteItems).toHaveLength(0);
    expect(store.reviewQueue).toHaveLength(0);
    expect(store.auditEvents).toHaveLength(0);
    expect(store.outboxMessages).toHaveLength(0);
    expect(store.quoteRequests[0]?.estado).toBe('enviada');
  });
});
