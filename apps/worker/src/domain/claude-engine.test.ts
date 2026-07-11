import { describe, expect, it } from 'vitest';
import { ACTOR_SISTEMA, crearFakeCtx, FakeToolStore } from '@proveeduria/agent';
import type {
  Actor,
  DecisionModelo,
  ExtractorCotizacion,
  MensajeModelo,
  ModeloConversacional,
  Proveedor,
  UsuarioInterno,
} from '@proveeduria/agent';
import { crearClaudeDomainEngine } from './claude-engine.js';
import type { DomainEngineInput, InboundMessage } from './types.js';

const AHORA = new Date('2026-07-10T12:00:00.000Z');
const PHONE = '+50688880002';

const actor: Actor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

interface LlamadaModelo {
  readonly sistema: string;
  readonly mensajes: readonly MensajeModelo[];
}

class ModeloFake implements ModeloConversacional {
  readonly llamadas: LlamadaModelo[] = [];

  constructor(private readonly decision: DecisionModelo) {}

  async decidir(input: {
    readonly sistema: string;
    readonly mensajes: readonly MensajeModelo[];
  }): Promise<DecisionModelo> {
    this.llamadas.push({ sistema: input.sistema, mensajes: input.mensajes });
    return this.decision;
  }
}

class ModeloQueFalla implements ModeloConversacional {
  async decidir(): Promise<DecisionModelo> {
    throw new Error('el modelo no deberia llamarse para un proveedor');
  }
}

function mensaje(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    wamid: 'wamid.1',
    fromPhone: PHONE,
    tipo: 'texto',
    payload: { text: { body: 'ocupo cemento' } },
    receivedAt: AHORA,
    processedAt: null,
    ...overrides,
  };
}

describe('crearClaudeDomainEngine', () => {
  it('interno: pasa el historial (sin el mensaje actual) al modelo, encola la respuesta y audita', async () => {
    const store = new FakeToolStore();
    store.agregarProyecto({ id: 'proj-1', nombre: 'Torre Lopez', codigo: 'LOP', activo: true });
    // Historial A4: 'hola' es previo; 'ocupo cemento' es el inbound actual (ultima fila entrante).
    store.agregarMensajeEntrante({ phone: PHONE, texto: 'hola', at: new Date('2026-07-10T11:00:00.000Z') });
    store.agregarMensajeEntrante({ phone: PHONE, texto: 'ocupo cemento', at: new Date('2026-07-10T11:59:00.000Z') });

    const ctx = crearFakeCtx(store, actor, AHORA);
    const modelo = new ModeloFake({ texto: 'Con gusto, ¿para cual proyecto es?', toolUse: null });
    const engine = crearClaudeDomainEngine({ modelo });

    const input: DomainEngineInput = {
      job: { id: 'job-1', wamid: 'wamid.1', intento: 1 },
      mensaje: mensaje(),
      contexto: { tipo: 'interno', actor, telefonoWhatsapp: PHONE },
      tx: store.tx,
      ahora: AHORA,
      ctx,
    };

    await engine.procesar(input);

    // Respuesta encolada por outbox (sesion libre) al telefono del actor.
    expect(store.outboxMessages).toHaveLength(1);
    expect(store.outboxMessages[0]?.destino).toBe(PHONE);
    expect(store.outboxMessages[0]?.texto).toBe('Con gusto, ¿para cual proyecto es?');

    // Audit del turno.
    expect(store.auditEvents.some((e) => e.accion === 'agente_turno')).toBe(true);

    // El historial pasado al modelo excluye el mensaje actual y lo agrega al final como user.
    const mensajes = modelo.llamadas[0]?.mensajes ?? [];
    expect(mensajes).toEqual([
      { rol: 'user', contenido: [{ tipo: 'texto', texto: 'hola' }] },
      { rol: 'user', contenido: [{ tipo: 'texto', texto: 'ocupo cemento' }] },
    ]);
    // El prompt de sistema real inyecta los proyectos activos.
    expect(modelo.llamadas[0]?.sistema).toContain('Torre Lopez');
  });

  it('proveedor: no corre el modelo y deja audit de seam (agente_proveedor_pendiente)', async () => {
    const store = new FakeToolStore();
    const engine = crearClaudeDomainEngine({ modelo: new ModeloQueFalla() });

    const input: DomainEngineInput = {
      job: { id: 'job-2', wamid: 'wamid.2', intento: 1 },
      mensaje: mensaje({ id: '70000000-0000-4000-8000-000000000002', wamid: 'wamid.2', fromPhone: '+50688881001' }),
      contexto: {
        tipo: 'proveedor',
        supplierContact: {
          id: 'contacto-1',
          supplierId: 'proveedor-1',
          nombre: 'Ventas Rodex',
          telefonoWhatsapp: '+50688881001',
          optinAt: AHORA,
        },
      },
      tx: store.tx,
      ahora: AHORA,
    };

    await engine.procesar(input);

    expect(store.tx.queries).toHaveLength(1);
    expect(store.tx.queries[0]?.sql).toContain('INSERT INTO audit_events');
    expect(store.tx.queries[0]?.params[0]).toBe('agente_proveedor_pendiente');
    expect(store.outboxMessages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Camino del proveedor (A6): extractor FAKE + tool `registrar_cotizacion` REAL sobre fakes,
// con Ctx sistema (crearFakeCtx sobre ACTOR_SISTEMA).
// ---------------------------------------------------------------------------

const CONTACTO_ID = 'contacto-1';
const SUPPLIER_ID = 'prov-1';
const TEL_PROV = '+50688881001';
const TEL_ADMIN = '+50688880002';

const proveedor: Proveedor = {
  id: SUPPLIER_ID,
  nombre: 'Rodex',
  categorias: ['cemento'],
  activo: true,
  contactoPrincipal: {
    id: CONTACTO_ID,
    supplierId: SUPPLIER_ID,
    nombre: 'Ventas Rodex',
    telefonoWhatsapp: TEL_PROV,
    optinAt: AHORA,
    esPrincipal: true,
  },
};

const admin: UsuarioInterno = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
  telefonoWhatsapp: TEL_ADMIN,
};

function sembrarProveedor(store: FakeToolStore): void {
  store.agregarProveedor(proveedor);
  store.agregarUsuario(admin);
}

function sembrarPedido(store: FakeToolStore, id: string, numero: string): void {
  store.pedidos.set(id, {
    id,
    numero,
    projectId: 'proj-1',
    solicitanteUserId: 'u-1',
    estado: 'cotizando',
    fechaRequerida: null,
    urgencia: null,
    confirmadoAt: null,
    confirmadoPor: null,
    plazoCotizacionAt: null,
  });
  store.itemsPorPedido.set(id, [
    { id: `${id}-item-1`, pedidoId: id, descripcion: 'Cemento gris', cantidad: 10, unidad: 'saco' },
    { id: `${id}-item-2`, pedidoId: id, descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
  ]);
}

function sembrarRfq(store: FakeToolStore, qrId: string, pedidoId: string): void {
  store.quoteRequests.push({
    id: qrId,
    pedidoId,
    supplierId: SUPPLIER_ID,
    plazoAt: new Date('2026-07-11T12:00:00.000Z'),
    estado: 'enviada',
  });
}

/** Extractor fake que mapea cada item del pedido; `precioNulo` fuerza cotizacion incompleta (E2). */
function extractorFake(opciones: { precioNulo?: boolean } = {}): ExtractorCotizacion {
  return {
    async extraer(entrada) {
      return {
        tipo: 'ok',
        input: {
          quoteRequestId: entrada.quoteRequestId,
          fuente: 'texto',
          confianzaExtraccion: 0.95,
          items: entrada.itemsPedido.map((item, i) => ({
            pedidoItemId: item.pedidoItemId,
            precioUnitario: opciones.precioNulo === true ? null : 1000 * (i + 1),
            cantidad: item.cantidad,
            disponible: true,
          })),
        },
      };
    },
  };
}

function inputProveedor(store: FakeToolStore, texto: string): DomainEngineInput {
  return {
    job: { id: 'job-p', wamid: 'wamid.p', intento: 1 },
    mensaje: mensaje({
      id: '70000000-0000-4000-8000-0000000000aa',
      wamid: 'wamid.p',
      fromPhone: TEL_PROV,
      payload: { text: { body: texto } },
    }),
    contexto: {
      tipo: 'proveedor',
      supplierContact: {
        id: CONTACTO_ID,
        supplierId: SUPPLIER_ID,
        nombre: 'Ventas Rodex',
        telefonoWhatsapp: TEL_PROV,
        optinAt: AHORA,
      },
    },
    tx: store.tx,
    ahora: AHORA,
  };
}

function engineProveedor(store: FakeToolStore, extractor: ExtractorCotizacion) {
  return crearClaudeDomainEngine({
    modelo: new ModeloQueFalla(),
    extractor,
    ctxProveedor: () => crearFakeCtx(store, ACTOR_SISTEMA, AHORA),
  });
}

describe('crearClaudeDomainEngine — camino del proveedor (A6)', () => {
  it('cotizacion completa: quote_response + confirmacion breve al proveedor', async () => {
    const store = new FakeToolStore();
    sembrarProveedor(store);
    sembrarPedido(store, 'pedido-1', 'PED-2026-001');
    sembrarRfq(store, 'qr-1', 'pedido-1');

    await engineProveedor(store, extractorFake()).procesar(
      inputProveedor(store, 'Aca va la cotizacion'),
    );

    expect(store.quoteResponses).toHaveLength(1);
    expect(store.quoteResponses[0]?.estado).toBe('completa');
    expect(store.quoteRequests[0]?.estado).toBe('respondida');
    const confirmacion = store.outboxMessages.find(
      (m) => m.destino === TEL_PROV && m.texto?.includes('Recibimos su cotización para PED-2026-001'),
    );
    expect(confirmacion).toBeDefined();
  });

  it('cotizacion incompleta: E2 (repregunta de la tool) sin confirmacion', async () => {
    const store = new FakeToolStore();
    sembrarProveedor(store);
    sembrarPedido(store, 'pedido-1', 'PED-2026-001');
    sembrarRfq(store, 'qr-1', 'pedido-1');

    await engineProveedor(store, extractorFake({ precioNulo: true })).procesar(
      inputProveedor(store, 'Aca va la cotizacion'),
    );

    // No transiciona ni confirma; la tool encolo su repregunta al proveedor.
    expect(store.pedidos.get('pedido-1')?.estado).toBe('cotizando');
    expect(store.outboxMessages.some((m) => m.texto?.includes('Recibimos su cotización'))).toBe(false);
    expect(store.outboxMessages.some((m) => m.destino === TEL_PROV && m.texto?.includes('precio y cantidad'))).toBe(true);
  });

  it('BAJA: optin_at=null + audit contacto_baja + notificacion interna + confirmacion fija', async () => {
    const store = new FakeToolStore();
    sembrarProveedor(store);

    await engineProveedor(store, extractorFake()).procesar(inputProveedor(store, 'Baja'));

    expect(store.tx.queries.some((q) => q.sql.includes('UPDATE supplier_contacts SET optin_at = null'))).toBe(true);
    expect(store.auditEvents.some((e) => e.accion === 'contacto_baja')).toBe(true);
    expect(store.outboxMessages.some((m) => m.destino === TEL_ADMIN && m.template === 'notificacion_interna')).toBe(true);
    expect(store.outboxMessages.some((m) => m.destino === TEL_PROV && m.texto?.includes('te dimos de baja'))).toBe(true);
    // No corre el extractor ni crea quote_response.
    expect(store.quoteResponses).toHaveLength(0);
  });

  it('sin RFQ activa: audit proveedor_sin_rfq + respuesta cortes', async () => {
    const store = new FakeToolStore();
    sembrarProveedor(store);

    await engineProveedor(store, extractorFake()).procesar(
      inputProveedor(store, 'Les mando la cotizacion'),
    );

    expect(store.auditEvents.some((e) => e.accion === 'proveedor_sin_rfq')).toBe(true);
    expect(store.outboxMessages.some((m) => m.destino === TEL_PROV && m.texto?.includes('No tenemos ninguna cotización pendiente'))).toBe(true);
    expect(store.quoteResponses).toHaveLength(0);
  });

  it('2 RFQs activas sin PED en el texto: repregunta el numero de pedido', async () => {
    const store = new FakeToolStore();
    sembrarProveedor(store);
    sembrarPedido(store, 'pedido-1', 'PED-2026-001');
    sembrarPedido(store, 'pedido-2', 'PED-2026-002');
    sembrarRfq(store, 'qr-1', 'pedido-1');
    sembrarRfq(store, 'qr-2', 'pedido-2');

    await engineProveedor(store, extractorFake()).procesar(
      inputProveedor(store, 'Les mando la cotizacion'),
    );

    expect(store.auditEvents.some((e) => e.accion === 'proveedor_rfq_ambigua')).toBe(true);
    expect(store.outboxMessages.some((m) => m.destino === TEL_PROV && m.texto?.includes('varias solicitudes'))).toBe(true);
    expect(store.quoteResponses).toHaveLength(0);
  });

  it('2 RFQs activas con PED-YYYY-NNN en el texto: matchea directo esa RFQ', async () => {
    const store = new FakeToolStore();
    sembrarProveedor(store);
    sembrarPedido(store, 'pedido-1', 'PED-2026-001');
    sembrarPedido(store, 'pedido-2', 'PED-2026-002');
    sembrarRfq(store, 'qr-1', 'pedido-1');
    sembrarRfq(store, 'qr-2', 'pedido-2');

    await engineProveedor(store, extractorFake()).procesar(
      inputProveedor(store, 'Cotizacion para PED-2026-002, adjunto precios'),
    );

    expect(store.quoteResponses).toHaveLength(1);
    expect(store.quoteResponses[0]?.quoteRequestId).toBe('qr-2');
    expect(store.outboxMessages.some((m) => m.destino === TEL_PROV && m.texto?.includes('PED-2026-002'))).toBe(true);
  });
});
