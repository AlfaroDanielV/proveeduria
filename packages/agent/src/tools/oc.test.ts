import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { aprobarGanador } from './adjudicacion.js';
import { emitirOc } from './oc.js';
import { crearFakeCtx, FakeToolStore, withFakeCtx } from '../runtime/fakes.js';
import type {
  Actor,
  ApprovalEvent,
  Pedido,
  Proyecto,
  Proveedor,
  QuoteRequest,
  QuoteResponse,
  UsuarioInterno,
} from '../runtime/types.js';

const AHORA = new Date('2026-07-10T12:00:00.000Z');

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
  cedulaJuridica: '3-101-111111',
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
  cedulaJuridica: '3-101-222222',
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

const proveedorSinOptIn: Proveedor = {
  id: '40000000-0000-4000-8000-000000000003',
  nombre: 'Sin Opt-in S.A.',
  cedulaJuridica: '3-101-333333',
  categorias: ['varios'],
  activo: true,
  contactoPrincipal: null,
};

function storeBase(): FakeToolStore {
  const store = new FakeToolStore();
  store.agregarProyecto(proyectoActivo);
  store.agregarUsuario(adminMateriales);
  store.agregarProveedor(proveedorRodex);
  store.agregarProveedor(proveedorLagar);
  store.agregarProveedor(proveedorSinOptIn);
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
    plazoAt: new Date('2026-07-11T12:00:00.000Z'),
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
 * Siembra el escenario feliz completo: pedido en_revision -> aprobar_ganador real (Rodex
 * gana item-1, El Lagar gana item-2) -> pedido queda `aprobado` con una `approval_events
 * (tipo='ganador')` normativa, listo para `emitir_oc`.
 */
async function sembrarPedidoAprobadoDividido(store: FakeToolStore): Promise<void> {
  agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
  store.quoteRequests.push(
    quoteRequestBase({ id: 'quote-request-1', supplierId: proveedorRodex.id }),
    quoteRequestBase({ id: 'quote-request-2', supplierId: proveedorLagar.id }),
  );
  store.quoteResponses.push(
    quoteResponseCompleta('quote-response-1', 'quote-request-1'),
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
      quoteResponseId: 'quote-response-2',
      pedidoItemId: 'item-2',
      precioUnitario: 1250,
      cantidad: 25,
      disponible: true,
      notas: null,
    },
  );

  const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);
  const result = await aprobarGanador({
    pedidoId: 'pedido-1',
    asignaciones: [
      { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1'] },
      { supplierId: proveedorLagar.id, pedidoItemIds: ['item-2'] },
    ],
  }, ctx);
  if (!result.ok) throw new Error(`Setup de test fallo: ${result.error.mensaje}`);
}

/** Inserta a mano una `approval_events(tipo='ganador')` sin pasar por `aprobarGanador` (para
 * escenarios que `aprobarGanador` jamas dejaria alcanzar, ej. item sin quote_item). */
function sembrarApprovalGanador(
  store: FakeToolStore,
  asignaciones: readonly { supplierId: string; pedidoItemIds: readonly string[]; quoteResponseId: string }[],
): void {
  const evento: ApprovalEvent = {
    tipo: 'ganador',
    pedidoId: 'pedido-1',
    canal: 'whatsapp',
    detalle: {
      asignaciones,
      comparativo: { pedidoId: 'pedido-1', numero: 'PED-2026-001', filas: [], resumenProveedores: [] },
    },
  };
  store.approvalEvents.push(evento);
}

describe('emitirOc', () => {
  it('emite OCs divididas entre 2 proveedores: numeros consecutivos, po_items correctos, outbox con adjunto', async () => {
    const store = storeBase();
    await sembrarPedidoAprobadoDividido(store);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await emitirOc({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.mensaje);
    expect(result.value.estado).toBe('ordenado');
    expect(result.value.ocs).toHaveLength(2);

    const [ocRodex, ocLagar] = result.value.ocs;
    expect(ocRodex?.numero).toBe('OC-2026-001');
    expect(ocLagar?.numero).toBe('OC-2026-002');
    expect(ocRodex?.supplierId).toBe(proveedorRodex.id);
    expect(ocRodex?.montoTotal).toBe(45000);
    expect(ocLagar?.supplierId).toBe(proveedorLagar.id);
    expect(ocLagar?.montoTotal).toBe(31250);

    expect(store.pedidos.get('pedido-1')?.estado).toBe('ordenado');

    // po_items: precio/cantidad copiados de los quote_items de la quote_response ganadora.
    const ocIdRodex = ocRodex?.ocId ?? '';
    const itemsOcRodex = store.ocItemsPorOc.get(ocIdRodex) ?? [];
    expect(itemsOcRodex).toEqual([
      { id: expect.any(String), ocId: ocIdRodex, pedidoItemId: 'item-1', cantidad: 10, precioUnitario: 4500 },
    ]);

    const ocIdLagar = ocLagar?.ocId ?? '';
    const itemsOcLagar = store.ocItemsPorOc.get(ocIdLagar) ?? [];
    expect(itemsOcLagar).toEqual([
      { id: expect.any(String), ocId: ocIdLagar, pedidoItemId: 'item-2', cantidad: 25, precioUnitario: 1250 },
    ]);

    // Attachments: PDF valido, sha256 consistente con los bytes guardados.
    expect(store.attachments.size).toBe(2);
    for (const oc of result.value.ocs) {
      const attachment = store.attachments.get(oc.attachmentId);
      expect(attachment).toBeDefined();
      expect(attachment?.contentType).toBe('application/pdf');
      const bytes = store.attachmentBlobs.get(oc.attachmentId);
      expect(bytes).toBeDefined();
      expect(bytes?.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(attachment?.sha256).toBe(createHash('sha256').update(bytes ?? Buffer.alloc(0)).digest('hex'));
    }

    // Outbox: 2 mensajes oc_emitida, con attachmentId y variables normativas.
    expect(store.outboxMessages).toHaveLength(2);
    const mensajeRodex = store.outboxMessages.find((m) => m.payload !== null &&
      typeof m.payload === 'object' &&
      (m.payload as { oc_id?: string }).oc_id === ocRodex?.ocId);
    expect(mensajeRodex).toMatchObject({
      destino: '+50688881001',
      template: 'oc_emitida',
      attachmentId: ocRodex?.attachmentId,
      payload: {
        variables: ['Ventas Rodex', 'OC-2026-001', 'Residencial Lopez', 'CRC 45000.00'],
        pedido_id: 'pedido-1',
        oc_id: ocRodex?.ocId,
        documento_nombre: 'OC-2026-001.pdf',
      },
    });

    // approval_events(emision_oc) + audit + estado ordenado.
    const approvalEmision = store.approvalEvents.find((e) => e.tipo === 'emision_oc');
    expect(approvalEmision).toBeDefined();
    expect(approvalEmision?.detalle).toMatchObject({
      ocs: [
        { ocId: ocRodex?.ocId, numero: 'OC-2026-001', supplierId: proveedorRodex.id, montoTotal: 45000 },
        { ocId: ocLagar?.ocId, numero: 'OC-2026-002', supplierId: proveedorLagar.id, montoTotal: 31250 },
      ],
    });

    const auditEmitirOc = store.auditEvents.find((e) => e.accion === 'emitir_oc');
    expect(auditEmitirOc).toBeDefined();
    expect(auditEmitirOc).toMatchObject({ entidad: 'pedido', entidadId: 'pedido-1', pedidoId: 'pedido-1' });
  });

  it('rechaza rol insuficiente sin efectos', async () => {
    const store = storeBase();
    await sembrarPedidoAprobadoDividido(store);
    const ctx = crearFakeCtx(store, actorIngeniero, AHORA);

    const result = await emitirOc({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia emitir OC.');
    expect(result.error.codigo).toBe('rol_insuficiente');
    expect(store.ocs.size).toBe(0);
    expect(store.pedidos.get('pedido-1')?.estado).toBe('aprobado');
  });

  it('rechaza pedido no aprobado con E12 sin efectos', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await emitirOc({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia emitir OC.');
    expect(result.error.codigo).toBe('E12');
    expect(store.ocs.size).toBe(0);
  });

  it('rechaza sin adjudicacion de ganador registrada (nunca emite "de memoria")', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'aprobado' }));
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await emitirOc({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia emitir OC.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('adjudicacion registrada');
    expect(store.ocs.size).toBe(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('rechaza proveedor adjudicado sin contacto opt-in y no persiste nada', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'aprobado' }));
    store.quoteResponses.push(quoteResponseCompleta('quote-response-x', 'quote-request-x'));
    store.quoteItems.push(
      { id: 'qi-1', quoteResponseId: 'quote-response-x', pedidoItemId: 'item-1', precioUnitario: 100, cantidad: 10, disponible: true, notas: null },
      { id: 'qi-2', quoteResponseId: 'quote-response-x', pedidoItemId: 'item-2', precioUnitario: 200, cantidad: 25, disponible: true, notas: null },
    );
    sembrarApprovalGanador(store, [
      { supplierId: proveedorSinOptIn.id, pedidoItemIds: ['item-1', 'item-2'], quoteResponseId: 'quote-response-x' },
    ]);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await emitirOc({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia emitir OC.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('opt-in');
    expect(store.ocs.size).toBe(0);
    expect(store.attachments.size).toBe(0);
    expect(store.outboxMessages).toHaveLength(0);
    expect(store.pedidos.get('pedido-1')?.estado).toBe('aprobado');
  });

  it('rechaza si falta un quote_item de la asignacion (no emite OC parcial)', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'aprobado' }));
    store.quoteResponses.push(quoteResponseCompleta('quote-response-1', 'quote-request-1'));
    // Solo cotizo item-1; item-2 queda sin quote_item, pero la asignacion pide ambos.
    store.quoteItems.push({
      id: 'qi-1',
      quoteResponseId: 'quote-response-1',
      pedidoItemId: 'item-1',
      precioUnitario: 4500,
      cantidad: 10,
      disponible: true,
      notas: null,
    });
    sembrarApprovalGanador(store, [
      { supplierId: proveedorRodex.id, pedidoItemIds: ['item-1', 'item-2'], quoteResponseId: 'quote-response-1' },
    ]);
    const ctx = crearFakeCtx(store, actorAdminMateriales, AHORA);

    const result = await emitirOc({ pedidoId: 'pedido-1' }, ctx);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('No debia emitir OC.');
    expect(result.error.codigo).toBe('validacion');
    expect(result.error.mensaje).toContain('no tiene precio/cantidad cotizados');
    expect(store.ocs.size).toBe(0);
    expect(store.outboxMessages).toHaveLength(0);
  });

  it('revierte todo (OCs, attachments, outbox, approval, estado) si falla la auditoria a mitad', async () => {
    const store = storeBase();
    await sembrarPedidoAprobadoDividido(store);
    store.failAudit = true;

    await expect(
      withFakeCtx(store, actorAdminMateriales, AHORA, async (ctx) => emitirOc({ pedidoId: 'pedido-1' }, ctx)),
    ).rejects.toThrow('Fallo de auditoria fake.');

    expect(store.pedidos.get('pedido-1')?.estado).toBe('aprobado');
    expect(store.ocs.size).toBe(0);
    expect(store.attachments.size).toBe(0);
    expect(store.outboxMessages).toHaveLength(0);
    expect(store.approvalEvents.some((e) => e.tipo === 'emision_oc')).toBe(false);
  });
});
