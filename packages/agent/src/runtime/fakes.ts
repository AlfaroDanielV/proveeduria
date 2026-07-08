import { formatNumero, UMBRALES_DEFAULT } from '@proveeduria/core';
import type { Rol, UmbralesConfig } from '@proveeduria/core';
import { crearCtx } from './context.js';
import type {
  Actor,
  ApprovalEvent,
  AuditEvent,
  ComparativoCotizacionFila,
  ComparativoRepo,
  ConfigRepo,
  Ctx,
  ItemPedidoInput,
  NuevoPedido,
  NuevoQuoteRequest,
  NuevoQuoteResponse,
  NuevoReviewQueueEntry,
  OutboxMessage,
  Pedido,
  PedidoItem,
  PedidoItemRepo,
  PedidoRepo,
  Proyecto,
  ProyectoRepo,
  Proveedor,
  ProveedorContacto,
  ProveedorRepo,
  QuoteItem,
  QuoteItemInput,
  QuoteRequest,
  QuoteRequestRepo,
  QuoteResponse,
  QuoteResponseRepo,
  Repos,
  ReviewQueueEntry,
  ReviewQueueRepo,
  Tx,
  UsuarioInterno,
  UsuarioRepo,
} from './types.js';

export class FakeTx implements Tx {
  readonly queries: { sql: string; params: readonly unknown[] }[] = [];

  async query<T = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }
}

interface FakeSnapshot {
  readonly proyectos: Map<string, Proyecto>;
  readonly pedidos: Map<string, Pedido>;
  readonly itemsPorPedido: Map<string, PedidoItem[]>;
  readonly proveedores: Map<string, Proveedor>;
  readonly quoteRequests: QuoteRequest[];
  readonly quoteResponses: QuoteResponse[];
  readonly quoteItems: QuoteItem[];
  readonly reviewQueue: ReviewQueueEntry[];
  readonly usuarios: UsuarioInterno[];
  readonly auditEvents: AuditEvent[];
  readonly outboxMessages: OutboxMessage[];
  readonly approvalEvents: ApprovalEvent[];
  readonly pedidoSeq: number;
  readonly idSeq: number;
  readonly umbrales: UmbralesConfig;
}

function clonePedido(pedido: Pedido): Pedido {
  return {
    ...pedido,
    confirmadoAt:
      pedido.confirmadoAt === null ? null : new Date(pedido.confirmadoAt.getTime()),
    plazoCotizacionAt:
      pedido.plazoCotizacionAt === null
        ? null
        : new Date(pedido.plazoCotizacionAt.getTime()),
  };
}

function cloneItem(item: PedidoItem): PedidoItem {
  return { ...item };
}

function cloneProyecto(proyecto: Proyecto): Proyecto {
  return { ...proyecto };
}

function cloneUsuario(usuario: UsuarioInterno): UsuarioInterno {
  return { ...usuario, roles: [...usuario.roles] };
}

function cloneContacto(contacto: ProveedorContacto): ProveedorContacto {
  return {
    ...contacto,
    optinAt: contacto.optinAt === null ? null : new Date(contacto.optinAt.getTime()),
  };
}

function cloneProveedor(proveedor: Proveedor): Proveedor {
  return {
    ...proveedor,
    categorias: [...proveedor.categorias],
    contactoPrincipal:
      proveedor.contactoPrincipal === null
        ? null
        : cloneContacto(proveedor.contactoPrincipal),
  };
}

function cloneQuoteRequest(quoteRequest: QuoteRequest): QuoteRequest {
  return {
    ...quoteRequest,
    plazoAt: new Date(quoteRequest.plazoAt.getTime()),
  };
}

function cloneQuoteResponse(quoteResponse: QuoteResponse): QuoteResponse {
  return {
    ...quoteResponse,
    recibidoAt: new Date(quoteResponse.recibidoAt.getTime()),
  };
}

function cloneQuoteItem(quoteItem: QuoteItem): QuoteItem {
  return { ...quoteItem };
}

function cloneReviewQueue(entry: ReviewQueueEntry): ReviewQueueEntry {
  return { ...entry };
}

export class FakeToolStore {
  readonly tx = new FakeTx();
  proyectos = new Map<string, Proyecto>();
  pedidos = new Map<string, Pedido>();
  itemsPorPedido = new Map<string, PedidoItem[]>();
  proveedores = new Map<string, Proveedor>();
  quoteRequests: QuoteRequest[] = [];
  quoteResponses: QuoteResponse[] = [];
  quoteItems: QuoteItem[] = [];
  reviewQueue: ReviewQueueEntry[] = [];
  usuarios: UsuarioInterno[] = [];
  auditEvents: AuditEvent[] = [];
  outboxMessages: OutboxMessage[] = [];
  approvalEvents: ApprovalEvent[] = [];
  pedidoSeq = 1;
  idSeq = 1;
  umbrales: UmbralesConfig = { ...UMBRALES_DEFAULT };
  failAudit = false;
  failOutbox = false;
  failApproval = false;

  agregarProyecto(proyecto: Proyecto): void {
    this.proyectos.set(proyecto.id, cloneProyecto(proyecto));
  }

  agregarUsuario(usuario: UsuarioInterno): void {
    this.usuarios.push(cloneUsuario(usuario));
  }

  agregarProveedor(proveedor: Proveedor): void {
    this.proveedores.set(proveedor.id, cloneProveedor(proveedor));
  }

  snapshot(): FakeSnapshot {
    return {
      proyectos: new Map(
        [...this.proyectos.entries()].map(([id, proyecto]) => [id, cloneProyecto(proyecto)]),
      ),
      pedidos: new Map(
        [...this.pedidos.entries()].map(([id, pedido]) => [id, clonePedido(pedido)]),
      ),
      itemsPorPedido: new Map(
        [...this.itemsPorPedido.entries()].map(([id, items]) => [
          id,
          items.map(cloneItem),
        ]),
      ),
      proveedores: new Map(
        [...this.proveedores.entries()].map(([id, proveedor]) => [
          id,
          cloneProveedor(proveedor),
        ]),
      ),
      quoteRequests: this.quoteRequests.map(cloneQuoteRequest),
      quoteResponses: this.quoteResponses.map(cloneQuoteResponse),
      quoteItems: this.quoteItems.map(cloneQuoteItem),
      reviewQueue: this.reviewQueue.map(cloneReviewQueue),
      usuarios: this.usuarios.map(cloneUsuario),
      auditEvents: this.auditEvents.map((event) => ({ ...event })),
      outboxMessages: this.outboxMessages.map((message) => ({ ...message })),
      approvalEvents: this.approvalEvents.map((event) => ({ ...event })),
      pedidoSeq: this.pedidoSeq,
      idSeq: this.idSeq,
      umbrales: { ...this.umbrales },
    };
  }

  restore(snapshot: FakeSnapshot): void {
    this.proyectos = snapshot.proyectos;
    this.pedidos = snapshot.pedidos;
    this.itemsPorPedido = snapshot.itemsPorPedido;
    this.proveedores = snapshot.proveedores;
    this.quoteRequests = snapshot.quoteRequests;
    this.quoteResponses = snapshot.quoteResponses;
    this.quoteItems = snapshot.quoteItems;
    this.reviewQueue = snapshot.reviewQueue;
    this.usuarios = snapshot.usuarios;
    this.auditEvents = snapshot.auditEvents;
    this.outboxMessages = snapshot.outboxMessages;
    this.approvalEvents = snapshot.approvalEvents;
    this.pedidoSeq = snapshot.pedidoSeq;
    this.idSeq = snapshot.idSeq;
    this.umbrales = snapshot.umbrales;
  }

  nextId(prefix: string): string {
    const id = `${prefix}-${this.idSeq}`;
    this.idSeq += 1;
    return id;
  }
}

class FakeProyectoRepo implements ProyectoRepo {
  constructor(private readonly store: FakeToolStore) {}

  async activoPorId(projectId: string): Promise<Proyecto | null> {
    const proyecto = this.store.proyectos.get(projectId);
    if (proyecto === undefined || !proyecto.activo) return null;
    return cloneProyecto(proyecto);
  }

  async porId(projectId: string): Promise<Proyecto | null> {
    const proyecto = this.store.proyectos.get(projectId);
    return proyecto === undefined ? null : cloneProyecto(proyecto);
  }
}

class FakePedidoRepo implements PedidoRepo {
  constructor(private readonly store: FakeToolStore) {}

  async siguienteNumeroPedido(ahora: Date): Promise<string> {
    const numero = formatNumero('PED', ahora.getFullYear(), this.store.pedidoSeq);
    this.store.pedidoSeq += 1;
    return numero;
  }

  async crear(input: NuevoPedido): Promise<Pedido> {
    const pedido: Pedido = {
      id: this.store.nextId('pedido'),
      numero: input.numero,
      projectId: input.projectId,
      solicitanteUserId: input.solicitanteUserId,
      estado: 'borrador',
      fechaRequerida: input.fechaRequerida,
      urgencia: input.urgencia,
      confirmadoAt: null,
      confirmadoPor: null,
      plazoCotizacionAt: null,
    };
    this.store.pedidos.set(pedido.id, clonePedido(pedido));
    return clonePedido(pedido);
  }

  async porId(pedidoId: string): Promise<Pedido | null> {
    const pedido = this.store.pedidos.get(pedidoId);
    return pedido === undefined ? null : clonePedido(pedido);
  }

  async bloquearPorId(pedidoId: string): Promise<Pedido | null> {
    return this.porId(pedidoId);
  }

  async confirmar(
    pedidoId: string,
    confirmadoAt: Date,
    confirmadoPor: string,
  ): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      confirmadoAt: new Date(confirmadoAt.getTime()),
      confirmadoPor,
    };
    this.store.pedidos.set(pedidoId, clonePedido(actualizado));
    return clonePedido(actualizado);
  }

  async marcarCotizando(pedidoId: string, plazoCotizacionAt: Date): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      estado: 'cotizando',
      plazoCotizacionAt: new Date(plazoCotizacionAt.getTime()),
    };
    this.store.pedidos.set(pedidoId, clonePedido(actualizado));
    return clonePedido(actualizado);
  }

  async marcarEnRevision(pedidoId: string): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      estado: 'en_revision',
    };
    this.store.pedidos.set(pedidoId, clonePedido(actualizado));
    return clonePedido(actualizado);
  }
}

class FakePedidoItemRepo implements PedidoItemRepo {
  constructor(private readonly store: FakeToolStore) {}

  async insertarMuchos(
    pedidoId: string,
    items: readonly ItemPedidoInput[],
  ): Promise<readonly PedidoItem[]> {
    const existentes = this.store.itemsPorPedido.get(pedidoId) ?? [];
    const insertados = items.map((item) => ({
      id: this.store.nextId('item'),
      pedidoId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      unidad: item.unidad,
    }));
    this.store.itemsPorPedido.set(pedidoId, [...existentes, ...insertados.map(cloneItem)]);
    return insertados.map(cloneItem);
  }

  async porPedido(pedidoId: string): Promise<readonly PedidoItem[]> {
    return (this.store.itemsPorPedido.get(pedidoId) ?? []).map(cloneItem);
  }
}

class FakeUsuarioRepo implements UsuarioRepo {
  constructor(private readonly store: FakeToolStore) {}

  async porTelefono(phone: string): Promise<Actor | null> {
    const usuario = this.store.usuarios.find((u) => u.telefonoWhatsapp === phone);
    if (usuario === undefined) return null;
    return {
      userId: usuario.userId,
      nombre: usuario.nombre,
      roles: [...usuario.roles],
    };
  }

  async activosPorRol(role: Rol): Promise<readonly UsuarioInterno[]> {
    return this.store.usuarios
      .filter((usuario) => usuario.roles.includes(role))
      .map(cloneUsuario);
  }
}

class FakeProveedorRepo implements ProveedorRepo {
  constructor(private readonly store: FakeToolStore) {}

  async activosConContactoOptIn(): Promise<readonly Proveedor[]> {
    return [...this.store.proveedores.values()]
      .filter((proveedor) => (
        proveedor.activo &&
        proveedor.contactoPrincipal !== null &&
        proveedor.contactoPrincipal.optinAt !== null
      ))
      .map(cloneProveedor);
  }

  async porIdsConContactoOptIn(supplierIds: readonly string[]): Promise<readonly Proveedor[]> {
    return supplierIds.flatMap((supplierId) => {
      const proveedor = this.store.proveedores.get(supplierId);
      if (
        proveedor === undefined ||
        !proveedor.activo ||
        proveedor.contactoPrincipal === null ||
        proveedor.contactoPrincipal.optinAt === null
      ) {
        return [];
      }
      return [cloneProveedor(proveedor)];
    });
  }
}

class FakeQuoteRequestRepo implements QuoteRequestRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevoQuoteRequest): Promise<QuoteRequest> {
    const quoteRequest: QuoteRequest = {
      id: this.store.nextId('quote-request'),
      pedidoId: input.pedidoId,
      supplierId: input.supplierId,
      plazoAt: new Date(input.plazoAt.getTime()),
      estado: 'enviada',
    };
    this.store.quoteRequests.push(cloneQuoteRequest(quoteRequest));
    return cloneQuoteRequest(quoteRequest);
  }

  async bloquearPorId(quoteRequestId: string): Promise<QuoteRequest | null> {
    const quoteRequest = this.store.quoteRequests.find((qr) => qr.id === quoteRequestId);
    return quoteRequest === undefined ? null : cloneQuoteRequest(quoteRequest);
  }

  async marcarRespondida(quoteRequestId: string): Promise<QuoteRequest> {
    const index = this.store.quoteRequests.findIndex((qr) => qr.id === quoteRequestId);
    const quoteRequest = this.store.quoteRequests[index];
    if (quoteRequest === undefined) throw new Error(`Quote request no encontrado: ${quoteRequestId}.`);
    const actualizado: QuoteRequest = {
      ...quoteRequest,
      estado: 'respondida',
    };
    this.store.quoteRequests[index] = cloneQuoteRequest(actualizado);
    return cloneQuoteRequest(actualizado);
  }

  async contarPendientesPorPedido(pedidoId: string): Promise<number> {
    return this.store.quoteRequests.filter((qr) => (
      qr.pedidoId === pedidoId && qr.estado === 'enviada'
    )).length;
  }
}

class FakeQuoteResponseRepo implements QuoteResponseRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevoQuoteResponse): Promise<QuoteResponse> {
    const quoteResponse: QuoteResponse = {
      id: this.store.nextId('quote-response'),
      quoteRequestId: input.quoteRequestId,
      recibidoAt: new Date(input.recibidoAt.getTime()),
      fuente: input.fuente,
      condiciones: input.condiciones,
      plazoEntrega: input.plazoEntrega,
      confianzaExtraccion: input.confianzaExtraccion,
      estado: input.estado,
      intentosRepregunta: input.intentosRepregunta,
    };
    this.store.quoteResponses.push(cloneQuoteResponse(quoteResponse));
    return cloneQuoteResponse(quoteResponse);
  }

  async insertarItems(
    quoteResponseId: string,
    items: readonly QuoteItemInput[],
  ): Promise<readonly QuoteItem[]> {
    const insertados = items.map((item) => ({
      id: this.store.nextId('quote-item'),
      quoteResponseId,
      pedidoItemId: item.pedidoItemId,
      precioUnitario: item.precioUnitario,
      cantidad: item.cantidad,
      disponible: item.disponible,
      notas: item.notas,
    }));
    this.store.quoteItems.push(...insertados.map(cloneQuoteItem));
    return insertados.map(cloneQuoteItem);
  }

  async contarIncompletas(quoteRequestId: string): Promise<number> {
    return this.store.quoteResponses.filter((qr) => (
      qr.quoteRequestId === quoteRequestId && qr.estado === 'incompleta'
    )).length;
  }
}

function subtotalComparativo(
  item: PedidoItem,
  quoteItem: QuoteItem | undefined,
): { subtotal: number | null; faltante: boolean } {
  if (
    quoteItem === undefined ||
    quoteItem.precioUnitario === null ||
    quoteItem.cantidad === null ||
    quoteItem.cantidad < item.cantidad ||
    quoteItem.disponible === false
  ) {
    return {
      subtotal:
        quoteItem?.precioUnitario === null ||
        quoteItem?.cantidad === null ||
        quoteItem?.precioUnitario === undefined ||
        quoteItem?.cantidad === undefined ||
        quoteItem?.disponible === false
          ? null
          : quoteItem.precioUnitario * quoteItem.cantidad,
      faltante: true,
    };
  }

  return {
    subtotal: quoteItem.precioUnitario * quoteItem.cantidad,
    faltante: false,
  };
}

class FakeComparativoRepo implements ComparativoRepo {
  constructor(private readonly store: FakeToolStore) {}

  async porPedido(pedidoId: string): Promise<readonly ComparativoCotizacionFila[]> {
    const items = this.store.itemsPorPedido.get(pedidoId) ?? [];
    const quoteRequests = this.store.quoteRequests.filter((qr) => qr.pedidoId === pedidoId);
    const filas: ComparativoCotizacionFila[] = [];

    for (const item of items) {
      for (const quoteRequest of quoteRequests) {
        const proveedor = this.store.proveedores.get(quoteRequest.supplierId);
        const quoteResponse = [...this.store.quoteResponses].reverse().find((response) => (
          response.quoteRequestId === quoteRequest.id && response.estado === 'completa'
        ));
        const quoteItem = quoteResponse === undefined
          ? undefined
          : this.store.quoteItems.find((itemCotizado) => (
            itemCotizado.quoteResponseId === quoteResponse.id &&
            itemCotizado.pedidoItemId === item.id
          ));
        const subtotal = subtotalComparativo(item, quoteItem);

        filas.push({
          pedidoItemId: item.id,
          descripcion: item.descripcion,
          cantidadSolicitada: item.cantidad,
          unidad: item.unidad,
          supplierId: quoteRequest.supplierId,
          proveedor: proveedor?.nombre ?? quoteRequest.supplierId,
          quoteRequestId: quoteRequest.id,
          quoteRequestEstado: quoteRequest.estado,
          quoteResponseId: quoteResponse?.id ?? null,
          precioUnitario: quoteItem?.precioUnitario ?? null,
          cantidadCotizada: quoteItem?.cantidad ?? null,
          disponible: quoteItem?.disponible ?? null,
          condiciones: quoteResponse?.condiciones ?? null,
          plazoEntrega: quoteResponse?.plazoEntrega ?? null,
          subtotal: subtotal.subtotal,
          faltante: subtotal.faltante,
          notas: quoteItem?.notas ?? null,
        });
      }
    }

    return filas;
  }
}

class FakeReviewQueueRepo implements ReviewQueueRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevoReviewQueueEntry): Promise<ReviewQueueEntry> {
    const entry: ReviewQueueEntry = {
      id: this.store.nextId('review'),
      tipo: input.tipo,
      entidad: input.entidad,
      entidadId: input.entidadId,
      pedidoId: input.pedidoId,
    };
    this.store.reviewQueue.push(cloneReviewQueue(entry));
    return cloneReviewQueue(entry);
  }
}

class FakeConfigRepo implements ConfigRepo {
  constructor(private readonly store: FakeToolStore) {}

  async umbrales(): Promise<UmbralesConfig> {
    return { ...this.store.umbrales };
  }
}

export function crearFakeRepos(store: FakeToolStore): Repos {
  return {
    proyectos: new FakeProyectoRepo(store),
    pedidos: new FakePedidoRepo(store),
    pedidoItems: new FakePedidoItemRepo(store),
    usuarios: new FakeUsuarioRepo(store),
    proveedores: new FakeProveedorRepo(store),
    quoteRequests: new FakeQuoteRequestRepo(store),
    quoteResponses: new FakeQuoteResponseRepo(store),
    comparativos: new FakeComparativoRepo(store),
    reviewQueue: new FakeReviewQueueRepo(store),
    config: new FakeConfigRepo(store),
  };
}

export function crearFakeCtx(
  store: FakeToolStore,
  actor: Actor,
  ahora: Date,
): Ctx {
  return {
    ...crearCtx({
      tx: store.tx,
      actor,
      ahora,
      repos: crearFakeRepos(store),
    }),
    audit: async (event) => {
      if (store.failAudit) throw new Error('Fallo de auditoria fake.');
      store.auditEvents.push({ ...event });
    },
    outbox: async (message) => {
      if (store.failOutbox) throw new Error('Fallo de outbox fake.');
      store.outboxMessages.push({ ...message });
    },
    approval: async (event) => {
      if (store.failApproval) throw new Error('Fallo de aprobacion fake.');
      store.approvalEvents.push({ ...event });
    },
  };
}

export async function withFakeCtx<T>(
  store: FakeToolStore,
  actor: Actor,
  ahora: Date,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  const snapshot = store.snapshot();
  try {
    return await fn(crearFakeCtx(store, actor, ahora));
  } catch (error) {
    store.restore(snapshot);
    throw error;
  }
}
