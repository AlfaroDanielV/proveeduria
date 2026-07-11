import { formatNumero, puedeTransicionarOc, UMBRALES_DEFAULT } from '@proveeduria/core';
import type { ItemCobertura, OcParaCobertura, Rol, UmbralesConfig } from '@proveeduria/core';
import { parseAsignacionesGanador } from './approval-ganador.js';
import { crearCtx } from './context.js';
import type {
  Actor,
  ApprovalEvent,
  ApprovalGanador,
  ApprovalRepo,
  Attachment,
  AttachmentRepo,
  AuditEvent,
  ComparativoCotizacionFila,
  ComparativoRepo,
  ConfigRepo,
  CoberturaRepo,
  CreditNote,
  CreditNoteRepo,
  Ctx,
  DashboardLink,
  DashboardLinkRepo,
  EquipmentMovement,
  EquipmentMovementInput,
  EquipmentMovementResultado,
  EquipmentRental,
  EquipmentRepo,
  Feedback,
  FeedbackRepo,
  Invoice,
  InvoiceConItems,
  InvoiceItem,
  InvoicePoLink,
  InvoicePoLinkInput,
  InvoicePoLinkRepo,
  InvoiceRepo,
  ItemPedidoInput,
  NuevaCreditNote,
  NuevaInvoice,
  NuevaOc,
  NuevoAttachment,
  NuevoDashboardLink,
  NuevoEquipmentRental,
  NuevoFeedback,
  NuevoPedido,
  NuevoQuoteRequest,
  NuevoQuoteResponse,
  NuevoReviewQueueEntry,
  Oc,
  OcConItems,
  OcItem,
  OcRepo,
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
  ReceiptConfirmation,
  ReceiptConfirmationInput,
  ReceiptConfirmationRepo,
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
  readonly ocs: Map<string, Oc>;
  readonly ocItemsPorOc: Map<string, OcItem[]>;
  readonly invoices: Map<string, Invoice>;
  readonly invoiceItemsPorInvoice: Map<string, InvoiceItem[]>;
  readonly invoicePoLinks: InvoicePoLink[];
  readonly receiptConfirmations: ReceiptConfirmation[];
  readonly creditNotes: Map<string, CreditNote>;
  readonly equipmentRentals: Map<string, EquipmentRental>;
  readonly equipmentMovements: EquipmentMovement[];
  readonly dashboardLinks: DashboardLink[];
  readonly feedback: Feedback[];
  readonly ocSeq: number;
  readonly attachments: Map<string, Attachment>;
  readonly attachmentBlobs: Map<string, Buffer>;
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

function cloneOc(oc: Oc): Oc {
  return {
    ...oc,
    confirmadaPorProveedorAt:
      oc.confirmadaPorProveedorAt === null ? null : new Date(oc.confirmadaPorProveedorAt.getTime()),
  };
}

function cloneOcItem(item: OcItem): OcItem {
  return { ...item };
}

function cloneInvoice(invoice: Invoice): Invoice {
  return { ...invoice };
}

function cloneInvoiceItem(item: InvoiceItem): InvoiceItem {
  return { ...item };
}

function cloneInvoicePoLink(link: InvoicePoLink): InvoicePoLink {
  return { ...link };
}

function cloneReceiptConfirmation(rc: ReceiptConfirmation): ReceiptConfirmation {
  return {
    ...rc,
    cantidades: { ...rc.cantidades },
    diferenciasDetectadas: rc.diferenciasDetectadas === null ? null : { ...rc.diferenciasDetectadas },
    confirmadoAt: new Date(rc.confirmadoAt.getTime()),
  };
}

function cloneCreditNote(nc: CreditNote): CreditNote {
  return {
    ...nc,
    aplicadaAt: nc.aplicadaAt === null ? null : new Date(nc.aplicadaAt.getTime()),
  };
}

function cloneEquipmentRental(rental: EquipmentRental): EquipmentRental {
  return {
    ...rental,
    abiertoAt: new Date(rental.abiertoAt.getTime()),
    cerradoAt: rental.cerradoAt === null ? null : new Date(rental.cerradoAt.getTime()),
  };
}

function cloneEquipmentMovement(movement: EquipmentMovement): EquipmentMovement {
  return { ...movement, at: new Date(movement.at.getTime()) };
}

function cloneDashboardLink(link: DashboardLink): DashboardLink {
  return { ...link, expiresAt: new Date(link.expiresAt.getTime()) };
}

function cloneFeedback(feedback: Feedback): Feedback {
  return { ...feedback };
}

function cloneAttachment(attachment: Attachment): Attachment {
  return { ...attachment };
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

  ocs = new Map<string, Oc>();
  ocItemsPorOc = new Map<string, OcItem[]>();
  invoices = new Map<string, Invoice>();
  invoiceItemsPorInvoice = new Map<string, InvoiceItem[]>();
  invoicePoLinks: InvoicePoLink[] = [];
  receiptConfirmations: ReceiptConfirmation[] = [];
  creditNotes = new Map<string, CreditNote>();
  equipmentRentals = new Map<string, EquipmentRental>();
  equipmentMovements: EquipmentMovement[] = [];
  dashboardLinks: DashboardLink[] = [];
  feedback: Feedback[] = [];
  ocSeq = 1;
  attachments = new Map<string, Attachment>();
  attachmentBlobs = new Map<string, Buffer>();

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
      ocs: new Map([...this.ocs.entries()].map(([id, oc]) => [id, cloneOc(oc)])),
      ocItemsPorOc: new Map(
        [...this.ocItemsPorOc.entries()].map(([id, items]) => [id, items.map(cloneOcItem)]),
      ),
      invoices: new Map(
        [...this.invoices.entries()].map(([id, invoice]) => [id, cloneInvoice(invoice)]),
      ),
      invoiceItemsPorInvoice: new Map(
        [...this.invoiceItemsPorInvoice.entries()].map(([id, items]) => [
          id,
          items.map(cloneInvoiceItem),
        ]),
      ),
      invoicePoLinks: this.invoicePoLinks.map(cloneInvoicePoLink),
      receiptConfirmations: this.receiptConfirmations.map(cloneReceiptConfirmation),
      creditNotes: new Map(
        [...this.creditNotes.entries()].map(([id, nc]) => [id, cloneCreditNote(nc)]),
      ),
      equipmentRentals: new Map(
        [...this.equipmentRentals.entries()].map(([id, rental]) => [id, cloneEquipmentRental(rental)]),
      ),
      equipmentMovements: this.equipmentMovements.map(cloneEquipmentMovement),
      dashboardLinks: this.dashboardLinks.map(cloneDashboardLink),
      feedback: this.feedback.map(cloneFeedback),
      ocSeq: this.ocSeq,
      attachments: new Map(
        [...this.attachments.entries()].map(([id, attachment]) => [id, cloneAttachment(attachment)]),
      ),
      attachmentBlobs: new Map(
        [...this.attachmentBlobs.entries()].map(([id, bytes]) => [id, Buffer.from(bytes)]),
      ),
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
    this.ocs = snapshot.ocs;
    this.ocItemsPorOc = snapshot.ocItemsPorOc;
    this.invoices = snapshot.invoices;
    this.invoiceItemsPorInvoice = snapshot.invoiceItemsPorInvoice;
    this.invoicePoLinks = snapshot.invoicePoLinks;
    this.receiptConfirmations = snapshot.receiptConfirmations;
    this.creditNotes = snapshot.creditNotes;
    this.equipmentRentals = snapshot.equipmentRentals;
    this.equipmentMovements = snapshot.equipmentMovements;
    this.dashboardLinks = snapshot.dashboardLinks;
    this.feedback = snapshot.feedback;
    this.ocSeq = snapshot.ocSeq;
    this.attachments = snapshot.attachments;
    this.attachmentBlobs = snapshot.attachmentBlobs;
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

  async listarActivos(): Promise<readonly Proyecto[]> {
    return [...this.store.proyectos.values()]
      .filter((proyecto) => proyecto.activo)
      .map(cloneProyecto);
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

  async marcarAprobado(pedidoId: string): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      estado: 'aprobado',
    };
    this.store.pedidos.set(pedidoId, clonePedido(actualizado));
    return clonePedido(actualizado);
  }

  async marcarOrdenado(pedidoId: string): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      estado: 'ordenado',
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

  async marcarVencidas(ahora: Date): Promise<readonly QuoteRequest[]> {
    const afectadas: QuoteRequest[] = [];
    this.store.quoteRequests = this.store.quoteRequests.map((qr) => {
      if (qr.estado !== 'enviada' || qr.plazoAt.getTime() > ahora.getTime()) return qr;
      const actualizada: QuoteRequest = { ...qr, estado: 'vencida' };
      afectadas.push(cloneQuoteRequest(actualizada));
      return actualizada;
    });
    return afectadas;
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

  async porId(quoteResponseId: string): Promise<QuoteResponse | null> {
    const quoteResponse = this.store.quoteResponses.find((qr) => qr.id === quoteResponseId);
    return quoteResponse === undefined ? null : cloneQuoteResponse(quoteResponse);
  }

  async itemsPorQuoteResponse(quoteResponseId: string): Promise<readonly QuoteItem[]> {
    return this.store.quoteItems
      .filter((item) => item.quoteResponseId === quoteResponseId)
      .map(cloneQuoteItem);
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
      estado: 'pendiente',
    };
    this.store.reviewQueue.push(cloneReviewQueue(entry));
    return cloneReviewQueue(entry);
  }

  async abiertasPorPedido(pedidoId: string): Promise<readonly ReviewQueueEntry[]> {
    return this.store.reviewQueue
      .filter((entry) => entry.pedidoId === pedidoId && entry.estado === 'pendiente')
      .map(cloneReviewQueue);
  }
}

class FakeConfigRepo implements ConfigRepo {
  constructor(private readonly store: FakeToolStore) {}

  async umbrales(): Promise<UmbralesConfig> {
    return { ...this.store.umbrales };
  }
}

// ---------------------------------------------------------------------------
// Compra y recepcion (Fase 2b, B2). Espejo de los repos PG en repos.ts.
// ---------------------------------------------------------------------------

class FakeOcRepo implements OcRepo {
  constructor(private readonly store: FakeToolStore) {}

  async siguienteNumeroOc(ahora: Date): Promise<string> {
    const numero = formatNumero('OC', ahora.getFullYear(), this.store.ocSeq);
    this.store.ocSeq += 1;
    return numero;
  }

  async crear(input: NuevaOc): Promise<OcConItems> {
    const oc: Oc = {
      id: this.store.nextId('oc'),
      numero: input.numero,
      pedidoId: input.pedidoId,
      supplierId: input.supplierId,
      estado: 'emitida',
      montoTotal: input.montoTotal,
      confirmadaPorProveedorAt: null,
      pdfAttachmentId: null,
    };
    this.store.ocs.set(oc.id, cloneOc(oc));

    const items: OcItem[] = input.items.map((item) => ({
      id: this.store.nextId('oc-item'),
      ocId: oc.id,
      pedidoItemId: item.pedidoItemId,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
    }));
    this.store.ocItemsPorOc.set(oc.id, items.map(cloneOcItem));

    return { oc: cloneOc(oc), items: items.map(cloneOcItem) };
  }

  async porId(ocId: string): Promise<Oc | null> {
    const oc = this.store.ocs.get(ocId);
    return oc === undefined ? null : cloneOc(oc);
  }

  async porPedido(pedidoId: string): Promise<readonly Oc[]> {
    return [...this.store.ocs.values()].filter((oc) => oc.pedidoId === pedidoId).map(cloneOc);
  }

  async itemsPorOc(ocId: string): Promise<readonly OcItem[]> {
    return (this.store.ocItemsPorOc.get(ocId) ?? []).map(cloneOcItem);
  }

  async actualizarEstado(ocId: string, estado: Oc['estado']): Promise<Oc> {
    const oc = this.store.ocs.get(ocId);
    if (oc === undefined) throw new Error(`OC no encontrada: ${ocId}.`);

    // Misma primera barrera que PgOcRepo.actualizarEstado (state-machine.md §Ciclo de la OC).
    const transicion = puedeTransicionarOc(oc.estado, estado);
    if (!transicion.ok) throw new Error(transicion.error.mensaje);

    const actualizada: Oc = { ...oc, estado };
    this.store.ocs.set(ocId, cloneOc(actualizada));
    return cloneOc(actualizada);
  }

  async fijarPdfAttachment(ocId: string, attachmentId: string): Promise<Oc> {
    const oc = this.store.ocs.get(ocId);
    if (oc === undefined) throw new Error(`OC no encontrada al fijar PDF: ${ocId}.`);
    const actualizada: Oc = { ...oc, pdfAttachmentId: attachmentId };
    this.store.ocs.set(ocId, cloneOc(actualizada));
    return cloneOc(actualizada);
  }

  async fijarConfirmadaProveedor(ocId: string, at: Date): Promise<Oc> {
    const oc = this.store.ocs.get(ocId);
    if (oc === undefined) throw new Error(`OC no encontrada al fijar confirmacion: ${ocId}.`);
    const actualizada: Oc = { ...oc, confirmadaPorProveedorAt: new Date(at.getTime()) };
    this.store.ocs.set(ocId, cloneOc(actualizada));
    return cloneOc(actualizada);
  }
}

class FakeInvoiceRepo implements InvoiceRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevaInvoice): Promise<InvoiceConItems> {
    const invoice: Invoice = {
      id: this.store.nextId('invoice'),
      numeroFactura: input.numeroFactura,
      supplierId: input.supplierId,
      projectId: input.projectId,
      fecha: input.fecha,
      montoTotal: input.montoTotal,
      moneda: input.moneda ?? 'CRC',
      fuenteAttachmentId: input.fuenteAttachmentId,
      confianzaExtraccion: input.confianzaExtraccion,
      estado: 'pendiente_revision',
      registradaPor: input.registradaPor,
    };
    this.store.invoices.set(invoice.id, cloneInvoice(invoice));

    const items: InvoiceItem[] = input.items.map((item) => ({
      id: this.store.nextId('invoice-item'),
      invoiceId: invoice.id,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
    }));
    this.store.invoiceItemsPorInvoice.set(invoice.id, items.map(cloneInvoiceItem));

    return { invoice: cloneInvoice(invoice), items: items.map(cloneInvoiceItem) };
  }

  async porId(invoiceId: string): Promise<Invoice | null> {
    const invoice = this.store.invoices.get(invoiceId);
    return invoice === undefined ? null : cloneInvoice(invoice);
  }

  async abiertasPorProveedorYProyecto(
    supplierId: string,
    projectId: string,
  ): Promise<readonly Invoice[]> {
    return [...this.store.invoices.values()]
      .filter((invoice) => (
        invoice.supplierId === supplierId &&
        invoice.projectId === projectId &&
        invoice.estado === 'pendiente_revision'
      ))
      .map(cloneInvoice);
  }

  async actualizarEstado(invoiceId: string, estado: Invoice['estado']): Promise<Invoice> {
    const invoice = this.store.invoices.get(invoiceId);
    if (invoice === undefined) throw new Error(`Factura no encontrada: ${invoiceId}.`);
    const actualizada: Invoice = { ...invoice, estado };
    this.store.invoices.set(invoiceId, cloneInvoice(actualizada));
    return cloneInvoice(actualizada);
  }

  async itemsPorInvoice(invoiceId: string): Promise<readonly InvoiceItem[]> {
    return (this.store.invoiceItemsPorInvoice.get(invoiceId) ?? []).map(cloneInvoiceItem);
  }
}

class FakeInvoicePoLinkRepo implements InvoicePoLinkRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(
    invoiceId: string,
    links: readonly InvoicePoLinkInput[],
  ): Promise<readonly InvoicePoLink[]> {
    const insertados: InvoicePoLink[] = links.map((link) => ({
      id: this.store.nextId('invoice-po-link'),
      invoiceId,
      ocId: link.ocId,
      montoAsignado: link.montoAsignado,
    }));
    this.store.invoicePoLinks.push(...insertados.map(cloneInvoicePoLink));
    return insertados.map(cloneInvoicePoLink);
  }

  async porInvoice(invoiceId: string): Promise<readonly InvoicePoLink[]> {
    return this.store.invoicePoLinks.filter((link) => link.invoiceId === invoiceId).map(cloneInvoicePoLink);
  }

  async porOc(ocId: string): Promise<readonly InvoicePoLink[]> {
    return this.store.invoicePoLinks.filter((link) => link.ocId === ocId).map(cloneInvoicePoLink);
  }
}

class FakeReceiptConfirmationRepo implements ReceiptConfirmationRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: ReceiptConfirmationInput): Promise<ReceiptConfirmation> {
    const rc: ReceiptConfirmation = {
      id: this.store.nextId('receipt-confirmation'),
      invoiceId: input.invoiceId,
      bodegueroUserId: input.bodegueroUserId,
      cantidades: { ...input.cantidades },
      diferenciasDetectadas:
        input.diferenciasDetectadas === null ? null : { ...input.diferenciasDetectadas },
      confirmadoAt: new Date(input.confirmadoAt.getTime()),
    };
    this.store.receiptConfirmations.push(cloneReceiptConfirmation(rc));
    return cloneReceiptConfirmation(rc);
  }

  async porInvoice(invoiceId: string): Promise<readonly ReceiptConfirmation[]> {
    return this.store.receiptConfirmations
      .filter((rc) => rc.invoiceId === invoiceId)
      .map(cloneReceiptConfirmation);
  }
}

class FakeCreditNoteRepo implements CreditNoteRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevaCreditNote): Promise<CreditNote> {
    const nc: CreditNote = {
      id: this.store.nextId('credit-note'),
      numero: input.numero,
      invoiceId: input.invoiceId,
      monto: input.monto,
      motivo: input.motivo,
      attachmentId: input.attachmentId,
      estado: 'pendiente_asociacion',
      aplicadaPor: null,
      aplicadaAt: null,
    };
    this.store.creditNotes.set(nc.id, cloneCreditNote(nc));
    return cloneCreditNote(nc);
  }

  async porId(creditNoteId: string): Promise<CreditNote | null> {
    const nc = this.store.creditNotes.get(creditNoteId);
    return nc === undefined ? null : cloneCreditNote(nc);
  }

  async pendientesPorPedido(pedidoId: string): Promise<readonly CreditNote[]> {
    // Espejo del join invoice -> invoice_po_links -> purchase_orders(pedido_id) de
    // PgCreditNoteRepo.pendientesPorPedido.
    const ocIdsDelPedido = new Set(
      [...this.store.ocs.values()].filter((oc) => oc.pedidoId === pedidoId).map((oc) => oc.id),
    );
    const invoiceIdsLinkeados = new Set(
      this.store.invoicePoLinks
        .filter((link) => ocIdsDelPedido.has(link.ocId))
        .map((link) => link.invoiceId),
    );
    return [...this.store.creditNotes.values()]
      .filter((nc) => (
        nc.estado === 'pendiente_asociacion' &&
        nc.invoiceId !== null &&
        invoiceIdsLinkeados.has(nc.invoiceId)
      ))
      .map(cloneCreditNote);
  }

  async aplicar(creditNoteId: string, aplicadaPor: string, aplicadaAt: Date): Promise<CreditNote> {
    const nc = this.store.creditNotes.get(creditNoteId);
    if (nc === undefined) throw new Error(`Nota de credito no encontrada: ${creditNoteId}.`);
    const actualizada: CreditNote = {
      ...nc,
      estado: 'aplicada',
      aplicadaPor,
      aplicadaAt: new Date(aplicadaAt.getTime()),
    };
    this.store.creditNotes.set(creditNoteId, cloneCreditNote(actualizada));
    return cloneCreditNote(actualizada);
  }
}

// ---------------------------------------------------------------------------
// Equipos de alquiler (Fase 2b, B2).
// ---------------------------------------------------------------------------

class FakeEquipmentRepo implements EquipmentRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crearRental(input: NuevoEquipmentRental): Promise<EquipmentRental> {
    // cantidad_activa arranca en 0, igual que PgEquipmentRepo.crearRental: la fuente de
    // verdad son los movimientos (emulados abajo en crearMovimiento).
    const rental: EquipmentRental = {
      id: this.store.nextId('equipment-rental'),
      projectId: input.projectId,
      supplierId: input.supplierId,
      descripcionEquipo: input.descripcionEquipo,
      cantidadInicial: input.cantidadInicial,
      cantidadActiva: 0,
      boletaAttachmentId: input.boletaAttachmentId,
      estado: 'activo',
      abiertoAt: new Date(),
      cerradoAt: null,
    };
    this.store.equipmentRentals.set(rental.id, cloneEquipmentRental(rental));
    return cloneEquipmentRental(rental);
  }

  async rentalPorId(rentalId: string): Promise<EquipmentRental | null> {
    const rental = this.store.equipmentRentals.get(rentalId);
    return rental === undefined ? null : cloneEquipmentRental(rental);
  }

  async rentalsActivosPorProyecto(projectId: string): Promise<readonly EquipmentRental[]> {
    return [...this.store.equipmentRentals.values()]
      .filter((rental) => rental.projectId === projectId && rental.estado === 'activo')
      .map(cloneEquipmentRental);
  }

  async rentalsActivosPorProveedor(supplierId: string): Promise<readonly EquipmentRental[]> {
    return [...this.store.equipmentRentals.values()]
      .filter((rental) => rental.supplierId === supplierId && rental.estado === 'activo')
      .map(cloneEquipmentRental);
  }

  async crearMovimiento(input: EquipmentMovementInput): Promise<EquipmentMovementResultado> {
    const rental = this.store.equipmentRentals.get(input.rentalId);
    if (rental === undefined) throw new Error(`Alquiler no encontrado: ${input.rentalId}.`);

    const movimiento: EquipmentMovement = {
      id: this.store.nextId('equipment-movement'),
      rentalId: input.rentalId,
      tipo: input.tipo,
      cantidad: input.cantidad,
      boletaAttachmentId: input.boletaAttachmentId,
      registradoPor: input.registradoPor,
      at: new Date(input.at.getTime()),
    };
    this.store.equipmentMovements.push(cloneEquipmentMovement(movimiento));

    // Emula equipment_movements_recalcula_activo (migracion 009): cantidad_activa = Σ
    // entradas − Σ devoluciones de TODOS los movimientos del alquiler, nunca escrita a mano.
    const cantidadActiva = this.store.equipmentMovements
      .filter((m) => m.rentalId === input.rentalId)
      .reduce((acc, m) => acc + (m.tipo === 'entrada' ? m.cantidad : -m.cantidad), 0);
    const actualizado: EquipmentRental = { ...rental, cantidadActiva };
    this.store.equipmentRentals.set(input.rentalId, cloneEquipmentRental(actualizado));

    return {
      movimiento: cloneEquipmentMovement(movimiento),
      rental: cloneEquipmentRental(actualizado),
    };
  }

  async movimientosPorRental(rentalId: string): Promise<readonly EquipmentMovement[]> {
    return this.store.equipmentMovements
      .filter((m) => m.rentalId === rentalId)
      .map(cloneEquipmentMovement);
  }

  async cerrarRental(rentalId: string, cerradoAt: Date): Promise<EquipmentRental> {
    const rental = this.store.equipmentRentals.get(rentalId);
    if (rental === undefined) throw new Error(`Alquiler no encontrado al cerrar: ${rentalId}.`);
    const actualizado: EquipmentRental = {
      ...rental,
      estado: 'cerrado',
      cerradoAt: new Date(cerradoAt.getTime()),
    };
    this.store.equipmentRentals.set(rentalId, cloneEquipmentRental(actualizado));
    return cloneEquipmentRental(actualizado);
  }
}

// ---------------------------------------------------------------------------
// dashboard_links y feedback (Fase 2b, B2).
// ---------------------------------------------------------------------------

class FakeDashboardLinkRepo implements DashboardLinkRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevoDashboardLink): Promise<DashboardLink> {
    const link: DashboardLink = {
      id: this.store.nextId('dashboard-link'),
      tokenHash: input.tokenHash,
      projectId: input.projectId,
      expiresAt: new Date(input.expiresAt.getTime()),
      createdBy: input.createdBy,
    };
    this.store.dashboardLinks.push(cloneDashboardLink(link));
    return cloneDashboardLink(link);
  }

  async porTokenHashVigente(tokenHash: string, ahora: Date): Promise<DashboardLink | null> {
    const link = this.store.dashboardLinks.find((l) => (
      l.tokenHash === tokenHash && l.expiresAt.getTime() > ahora.getTime()
    ));
    return link === undefined ? null : cloneDashboardLink(link);
  }
}

class FakeFeedbackRepo implements FeedbackRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevoFeedback): Promise<Feedback> {
    const feedback: Feedback = {
      id: this.store.nextId('feedback'),
      userId: input.userId,
      tipo: input.tipo,
      texto: input.texto,
      contexto: input.contexto ?? null,
    };
    this.store.feedback.push(cloneFeedback(feedback));
    return cloneFeedback(feedback);
  }
}

// ---------------------------------------------------------------------------
// Cobertura de recepcion: espejo en memoria del agregado SQL de PgCoberturaRepo (state-
// machine.md §Computo de cobertura). Debe producir el mismo resultado que la version SQL
// para los mismos datos — verificado por el test de integracion cruzado.
// ---------------------------------------------------------------------------

class FakeCoberturaRepo implements CoberturaRepo {
  constructor(private readonly store: FakeToolStore) {}

  async coberturaDeOc(ocId: string): Promise<readonly ItemCobertura[]> {
    const items = this.store.ocItemsPorOc.get(ocId) ?? [];
    const invoiceIdsLinkeados = new Set(
      this.store.invoicePoLinks.filter((link) => link.ocId === ocId).map((link) => link.invoiceId),
    );
    const confirmacionesConciliadas = this.store.receiptConfirmations.filter((rc) => (
      invoiceIdsLinkeados.has(rc.invoiceId) &&
      this.store.invoices.get(rc.invoiceId)?.estado === 'conciliada'
    ));

    return items.map((item) => ({
      cantidad: item.cantidad,
      cantidadRecibida: confirmacionesConciliadas.reduce(
        (acc, rc) => acc + (rc.cantidades[item.id] ?? 0),
        0,
      ),
    }));
  }

  async estadosOcDePedido(pedidoId: string): Promise<readonly OcParaCobertura[]> {
    return [...this.store.ocs.values()]
      .filter((oc) => oc.pedidoId === pedidoId)
      .map((oc) => ({ estado: oc.estado }));
  }
}

// ---------------------------------------------------------------------------
// attachments / attachment_blobs y approval_events (lectura). Espejo de PgAttachmentRepo /
// PgApprovalRepo en repos.ts.
// ---------------------------------------------------------------------------

class FakeAttachmentRepo implements AttachmentRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crearConBytes(input: NuevoAttachment): Promise<Attachment> {
    const id = this.store.nextId('attachment');
    const attachment: Attachment = {
      id,
      blobPath: `pg://attachment_blobs/${id}`,
      contentType: input.contentType,
      sha256: input.sha256,
      origen: input.origen,
      tamanoBytes: input.bytes.length,
    };
    this.store.attachments.set(id, cloneAttachment(attachment));
    this.store.attachmentBlobs.set(id, Buffer.from(input.bytes));
    return cloneAttachment(attachment);
  }

  async porId(attachmentId: string): Promise<Attachment | null> {
    const attachment = this.store.attachments.get(attachmentId);
    return attachment === undefined ? null : cloneAttachment(attachment);
  }
}

class FakeApprovalRepo implements ApprovalRepo {
  constructor(private readonly store: FakeToolStore) {}

  async ultimoGanadorPorPedido(pedidoId: string): Promise<ApprovalGanador | null> {
    // store.approvalEvents esta en orden de insercion (push): el ultimo que matchea es el mas
    // reciente, igual que "ORDER BY at DESC, created_at DESC LIMIT 1" en PgApprovalRepo.
    const eventos = this.store.approvalEvents.filter((evento) => (
      evento.tipo === 'ganador' && evento.pedidoId === pedidoId
    ));
    const ultimo = eventos[eventos.length - 1];
    if (ultimo === undefined) return null;

    const asignaciones = parseAsignacionesGanador(ultimo.detalle);
    if (asignaciones === null) return null;

    return { pedidoId, asignaciones };
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
    ocs: new FakeOcRepo(store),
    invoices: new FakeInvoiceRepo(store),
    invoicePoLinks: new FakeInvoicePoLinkRepo(store),
    receiptConfirmations: new FakeReceiptConfirmationRepo(store),
    creditNotes: new FakeCreditNoteRepo(store),
    equipment: new FakeEquipmentRepo(store),
    dashboardLinks: new FakeDashboardLinkRepo(store),
    feedback: new FakeFeedbackRepo(store),
    cobertura: new FakeCoberturaRepo(store),
    attachments: new FakeAttachmentRepo(store),
    approvals: new FakeApprovalRepo(store),
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
