import type {
  CanalAprobacion,
  CodigoExcepcion,
  EstadoFactura,
  EstadoNotaCredito,
  EstadoOC,
  EstadoPedido,
  EstadoQuoteResponse,
  EstadoRental,
  EstadoReviewQueue,
  FuenteExtraccion,
  ItemCobertura,
  OcParaCobertura,
  OrigenAudit,
  Result,
  Rol,
  TipoAprobacion,
  TipoFeedback,
  TipoMovimientoEquipo,
  TipoReviewQueue,
  UmbralesConfig,
} from '@proveeduria/core';

export interface Actor {
  readonly userId: string;
  readonly roles: readonly Rol[];
  readonly nombre: string;
}

export interface UsuarioInterno extends Actor {
  readonly telefonoWhatsapp: string;
}

export interface TxResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface Tx {
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<TxResult<T>>;
}

export type CodigoErrorTool =
  | CodigoExcepcion
  | 'rol_insuficiente'
  | 'validacion'
  | 'no_encontrado';

export interface ErrorTool {
  readonly codigo: CodigoErrorTool;
  readonly mensaje: string;
}

export type ResultadoTool<T> = Result<T, ErrorTool>;

export interface Proyecto {
  readonly id: string;
  readonly nombre: string;
  readonly codigo: string;
  readonly activo: boolean;
}

export interface ItemPedidoInput {
  readonly descripcion: string;
  readonly cantidad: number;
  readonly unidad: string;
}

export interface PedidoItem extends ItemPedidoInput {
  readonly id: string;
  readonly pedidoId: string;
}

export interface Pedido {
  readonly id: string;
  readonly numero: string;
  readonly projectId: string;
  readonly solicitanteUserId: string;
  readonly estado: EstadoPedido;
  readonly fechaRequerida: string | null;
  readonly urgencia: string | null;
  readonly confirmadoAt: Date | null;
  readonly confirmadoPor: string | null;
  readonly plazoCotizacionAt: Date | null;
}

export interface NuevoPedido {
  readonly numero: string;
  readonly projectId: string;
  readonly solicitanteUserId: string;
  readonly fechaRequerida: string | null;
  readonly urgencia: string | null;
}

export interface ProyectoRepo {
  activoPorId(projectId: string): Promise<Proyecto | null>;
  porId(projectId: string): Promise<Proyecto | null>;
  /** Proyectos activos (para crons/consultas que iteran todo el portafolio). */
  listarActivos(): Promise<readonly Proyecto[]>;
}

export interface PedidoRepo {
  siguienteNumeroPedido(ahora: Date): Promise<string>;
  crear(input: NuevoPedido): Promise<Pedido>;
  porId(pedidoId: string): Promise<Pedido | null>;
  bloquearPorId(pedidoId: string): Promise<Pedido | null>;
  confirmar(
    pedidoId: string,
    confirmadoAt: Date,
    confirmadoPor: string,
  ): Promise<Pedido>;
  marcarCotizando(pedidoId: string, plazoCotizacionAt: Date): Promise<Pedido>;
  marcarEnRevision(pedidoId: string): Promise<Pedido>;
  /** `en_revision -> aprobado` (state-machine.md; tools.md `aprobar_ganador`). */
  marcarAprobado(pedidoId: string): Promise<Pedido>;
  /** `aprobado -> ordenado` (state-machine.md; tools.md `emitir_oc`, "Sistema" en la misma tx). */
  marcarOrdenado(pedidoId: string): Promise<Pedido>;
}

export interface PedidoItemRepo {
  insertarMuchos(
    pedidoId: string,
    items: readonly ItemPedidoInput[],
  ): Promise<readonly PedidoItem[]>;
  porPedido(pedidoId: string): Promise<readonly PedidoItem[]>;
}

export interface UsuarioRepo {
  porTelefono(phone: string): Promise<Actor | null>;
  activosPorRol(role: Rol): Promise<readonly UsuarioInterno[]>;
}

export interface ProveedorContacto {
  readonly id: string;
  readonly supplierId: string;
  readonly nombre: string | null;
  readonly telefonoWhatsapp: string;
  readonly optinAt: Date | null;
  readonly esPrincipal: boolean;
}

export interface Proveedor {
  readonly id: string;
  readonly nombre: string;
  readonly categorias: readonly string[];
  readonly activo: boolean;
  readonly contactoPrincipal: ProveedorContacto | null;
  /**
   * Cedula juridica (`suppliers.cedula_juridica`, puede ser null). Opcional en el tipo
   * (en vez de requerido) para no romper los fixtures de tests existentes que construyen
   * `Proveedor` sin este campo (crear_pedido/enviar_rfq no lo necesitan); `emitir_oc` si lo
   * necesita para el PDF de la OC (tools.md "proveedor (nombre y cedula)").
   */
  readonly cedulaJuridica?: string | null;
}

export interface ProveedorRepo {
  activosConContactoOptIn(): Promise<readonly Proveedor[]>;
  porIdsConContactoOptIn(supplierIds: readonly string[]): Promise<readonly Proveedor[]>;
}

export interface QuoteRequest {
  readonly id: string;
  readonly pedidoId: string;
  readonly supplierId: string;
  readonly plazoAt: Date;
  readonly estado: 'enviada' | 'respondida' | 'vencida' | 'declinada';
}

export interface NuevoQuoteRequest {
  readonly pedidoId: string;
  readonly supplierId: string;
  readonly plazoAt: Date;
}

export interface QuoteRequestRepo {
  crear(input: NuevoQuoteRequest): Promise<QuoteRequest>;
  bloquearPorId(quoteRequestId: string): Promise<QuoteRequest | null>;
  marcarRespondida(quoteRequestId: string): Promise<QuoteRequest>;
  contarPendientesPorPedido(pedidoId: string): Promise<number>;
  /**
   * E1 (exceptions.md): marca `vencida` toda `quote_request` en estado `enviada` cuyo
   * `plazoAt <= ahora`, y devuelve las afectadas (con `pedidoId`) para que el cron A7
   * notifique/escale. No filtra por pedido: corre sobre todo el portafolio.
   */
  marcarVencidas(ahora: Date): Promise<readonly QuoteRequest[]>;
}

export interface QuoteResponse {
  readonly id: string;
  readonly quoteRequestId: string;
  readonly recibidoAt: Date;
  readonly fuente: FuenteExtraccion;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly confianzaExtraccion: number;
  readonly estado: EstadoQuoteResponse;
  readonly intentosRepregunta: number;
}

export interface NuevoQuoteResponse {
  readonly quoteRequestId: string;
  readonly recibidoAt: Date;
  readonly fuente: FuenteExtraccion;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly confianzaExtraccion: number;
  readonly estado: EstadoQuoteResponse;
  readonly intentosRepregunta: number;
}

export interface QuoteItemInput {
  readonly pedidoItemId: string | null;
  readonly precioUnitario: number | null;
  readonly cantidad: number | null;
  readonly disponible: boolean | null;
  readonly notas: string | null;
}

export interface QuoteItem extends QuoteItemInput {
  readonly id: string;
  readonly quoteResponseId: string;
}

export interface ComparativoCotizacionFila {
  readonly pedidoItemId: string;
  readonly descripcion: string;
  readonly cantidadSolicitada: number;
  readonly unidad: string;
  readonly supplierId: string;
  readonly proveedor: string;
  readonly quoteRequestId: string;
  readonly quoteRequestEstado: QuoteRequest['estado'];
  readonly quoteResponseId: string | null;
  readonly precioUnitario: number | null;
  readonly cantidadCotizada: number | null;
  readonly disponible: boolean | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly subtotal: number | null;
  readonly faltante: boolean;
  readonly notas: string | null;
}

export interface ComparativoRepo {
  porPedido(pedidoId: string): Promise<readonly ComparativoCotizacionFila[]>;
}

export interface QuoteResponseRepo {
  crear(input: NuevoQuoteResponse): Promise<QuoteResponse>;
  insertarItems(
    quoteResponseId: string,
    items: readonly QuoteItemInput[],
  ): Promise<readonly QuoteItem[]>;
  contarIncompletas(quoteRequestId: string): Promise<number>;
  /** Lee una `quote_response` por id (`emitir_oc`: condiciones/plazo de la cotizacion ganadora). */
  porId(quoteResponseId: string): Promise<QuoteResponse | null>;
  /**
   * Items cotizados de una `quote_response` especifica. `emitir_oc` los usa para copiar
   * precio/cantidad a `po_items` (tools.md "los precios unitarios de po_items se copian de
   * los quote_items de esa respuesta" — el `quoteResponseId` viene fijado por
   * `aprobar_ganador` en `approval_events.detalle`, nunca recalculado "de memoria").
   */
  itemsPorQuoteResponse(quoteResponseId: string): Promise<readonly QuoteItem[]>;
}

export interface ReviewQueueEntry {
  readonly id: string;
  readonly tipo: TipoReviewQueue;
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedidoId: string | null;
  readonly estado: EstadoReviewQueue;
}

export interface NuevoReviewQueueEntry {
  readonly tipo: TipoReviewQueue;
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedidoId: string | null;
  readonly detalle: unknown;
}

export interface ReviewQueueRepo {
  crear(input: NuevoReviewQueueEntry): Promise<ReviewQueueEntry>;
  /** Entradas `pendiente` del pedido (guard de `cerrar_pedido`, tools.md). */
  abiertasPorPedido(pedidoId: string): Promise<readonly ReviewQueueEntry[]>;
}

export interface ConfigRepo {
  umbrales(): Promise<UmbralesConfig>;
}

// ---------------------------------------------------------------------------
// Compra y recepcion (data-model.md §Compra y recepcion; tools.md §Adjudicacion
// y OC / §Recepcion; state-machine.md §Ciclo de la OC). Fase 2b (B2).
// ---------------------------------------------------------------------------

export interface OcItemInput {
  readonly pedidoItemId: string | null;
  readonly cantidad: number;
  /** Precio unitario de la cotizacion aprobada (data-model.md `po_items`). */
  readonly precioUnitario: number;
}

export interface OcItem extends OcItemInput {
  readonly id: string;
  readonly ocId: string;
}

export interface Oc {
  readonly id: string;
  readonly numero: string;
  readonly pedidoId: string;
  readonly supplierId: string;
  readonly estado: EstadoOC;
  readonly montoTotal: number;
  readonly confirmadaPorProveedorAt: Date | null;
  readonly pdfAttachmentId: string | null;
}

export interface NuevaOc {
  readonly numero: string;
  readonly pedidoId: string;
  readonly supplierId: string;
  readonly montoTotal: number;
  readonly items: readonly OcItemInput[];
}

export interface OcConItems {
  readonly oc: Oc;
  readonly items: readonly OcItem[];
}

export interface OcRepo {
  /** Numeracion `OC-YYYY-NNN` (mismo mecanismo transaccional que `PED`, data-model.md regla dura 4). */
  siguienteNumeroOc(ahora: Date): Promise<string>;
  /** Crea la OC y sus `po_items` en la misma llamada (transaccional: misma `Tx`). */
  crear(input: NuevaOc): Promise<OcConItems>;
  porId(ocId: string): Promise<Oc | null>;
  porPedido(pedidoId: string): Promise<readonly Oc[]>;
  itemsPorOc(ocId: string): Promise<readonly OcItem[]>;
  /**
   * Cambia `estado`. Valida la transicion con `puedeTransicionarOc` de `@proveeduria/core`
   * ANTES del UPDATE (bloqueando la fila primero) y deja el trigger de la migracion 009 como
   * segunda barrera (defensa en profundidad, state-machine.md §Ciclo de la OC). Lanza si la
   * OC no existe o si la transicion es invalida — el llamador (tool) decide como traducir eso
   * a un `ResultadoTool` (p.ej. codigo `E12`).
   */
  actualizarEstado(ocId: string, estado: EstadoOC): Promise<Oc>;
  fijarPdfAttachment(ocId: string, attachmentId: string): Promise<Oc>;
  fijarConfirmadaProveedor(ocId: string, at: Date): Promise<Oc>;
}

export interface InvoiceItemInput {
  readonly descripcion: string;
  readonly cantidad: number | null;
  readonly precioUnitario: number | null;
}

export interface InvoiceItem extends InvoiceItemInput {
  readonly id: string;
  readonly invoiceId: string;
}

export interface Invoice {
  readonly id: string;
  readonly numeroFactura: string | null;
  readonly supplierId: string;
  readonly projectId: string | null;
  /** Fecha de la factura (`date` en DB); ISO `YYYY-MM-DD` o `null`. */
  readonly fecha: string | null;
  readonly montoTotal: number;
  readonly moneda: string;
  readonly fuenteAttachmentId: string | null;
  readonly confianzaExtraccion: number | null;
  readonly estado: EstadoFactura;
  readonly registradaPor: string | null;
}

export interface NuevaInvoice {
  readonly numeroFactura: string | null;
  readonly supplierId: string;
  readonly projectId: string | null;
  readonly fecha: string | null;
  readonly montoTotal: number;
  readonly moneda?: string;
  readonly fuenteAttachmentId: string | null;
  readonly confianzaExtraccion: number | null;
  readonly registradaPor: string | null;
  readonly items: readonly InvoiceItemInput[];
}

export interface InvoiceConItems {
  readonly invoice: Invoice;
  readonly items: readonly InvoiceItem[];
}

export interface InvoiceRepo {
  /** Crea la factura y sus `invoice_items` en la misma llamada. */
  crear(input: NuevaInvoice): Promise<InvoiceConItems>;
  porId(invoiceId: string): Promise<Invoice | null>;
  /**
   * Facturas "abiertas" (candidatas a matching E3, exceptions.md) de un proveedor+proyecto:
   * `estado = 'pendiente_revision'`. Las `conciliada`/`disputada` ya se resolvieron.
   */
  abiertasPorProveedorYProyecto(
    supplierId: string,
    projectId: string,
  ): Promise<readonly Invoice[]>;
  actualizarEstado(invoiceId: string, estado: EstadoFactura): Promise<Invoice>;
  itemsPorInvoice(invoiceId: string): Promise<readonly InvoiceItem[]>;
}

export interface InvoicePoLinkInput {
  readonly ocId: string;
  readonly montoAsignado: number;
}

export interface InvoicePoLink extends InvoicePoLinkInput {
  readonly id: string;
  readonly invoiceId: string;
}

export interface InvoicePoLinkRepo {
  /** Crea uno o varios links de una factura hacia OC(s) con su monto asignado. */
  crear(invoiceId: string, links: readonly InvoicePoLinkInput[]): Promise<readonly InvoicePoLink[]>;
  porInvoice(invoiceId: string): Promise<readonly InvoicePoLink[]>;
  porOc(ocId: string): Promise<readonly InvoicePoLink[]>;
}

/**
 * Forma canonica de `receipt_confirmations.cantidades` (jsonb): mapa `po_item_id -> cantidad
 * confirmada` por el bodeguero para esa factura (data-model.md `receipt_confirmations`).
 * Documentado tambien en `docs/specs/data-model.md` §Compra y recepcion.
 */
export type CantidadesConfirmadas = Readonly<Record<string, number>>;

/**
 * Forma canonica de `receipt_confirmations.diferencias_detectadas` (jsonb): mapa
 * `po_item_id -> diferencia` (cantidad confirmada − cantidad ordenada del `po_item`) SOLO
 * para los items donde `diferenciaRecepcion`/E5 (`@proveeduria/core`) detecto discrepancia.
 * Items sin diferencia no aparecen como llave.
 */
export type DiferenciasDetectadas = Readonly<Record<string, number>>;

export interface ReceiptConfirmationInput {
  readonly invoiceId: string;
  readonly bodegueroUserId: string | null;
  readonly cantidades: CantidadesConfirmadas;
  readonly diferenciasDetectadas: DiferenciasDetectadas | null;
  readonly confirmadoAt: Date;
}

export interface ReceiptConfirmation extends ReceiptConfirmationInput {
  readonly id: string;
}

export interface ReceiptConfirmationRepo {
  crear(input: ReceiptConfirmationInput): Promise<ReceiptConfirmation>;
  porInvoice(invoiceId: string): Promise<readonly ReceiptConfirmation[]>;
}

export interface CreditNote {
  readonly id: string;
  readonly numero: string | null;
  readonly invoiceId: string | null;
  readonly monto: number;
  readonly motivo: string | null;
  readonly attachmentId: string | null;
  readonly estado: EstadoNotaCredito;
  readonly aplicadaPor: string | null;
  readonly aplicadaAt: Date | null;
}

export interface NuevaCreditNote {
  readonly numero: string | null;
  readonly invoiceId: string | null;
  readonly monto: number;
  readonly motivo: string | null;
  readonly attachmentId: string | null;
}

export interface CreditNoteRepo {
  crear(input: NuevaCreditNote): Promise<CreditNote>;
  porId(creditNoteId: string): Promise<CreditNote | null>;
  /**
   * NC `pendiente_asociacion` alcanzables desde el pedido via
   * `invoice -> invoice_po_links -> purchase_orders(pedido_id)` (guard de `cerrar_pedido`,
   * tools.md). NC sin `invoiceId` (aun sin match, E6) no pertenecen a ningun pedido todavia
   * y por tanto no aparecen aqui.
   */
  pendientesPorPedido(pedidoId: string): Promise<readonly CreditNote[]>;
  aplicar(creditNoteId: string, aplicadaPor: string, aplicadaAt: Date): Promise<CreditNote>;
}

// ---------------------------------------------------------------------------
// Equipos de alquiler (data-model.md §Equipos de alquiler; tools.md §Equipos).
// ---------------------------------------------------------------------------

export interface EquipmentRental {
  readonly id: string;
  readonly projectId: string;
  readonly supplierId: string;
  readonly descripcionEquipo: string;
  readonly cantidadInicial: number;
  readonly cantidadActiva: number;
  readonly boletaAttachmentId: string | null;
  readonly estado: EstadoRental;
  readonly abiertoAt: Date;
  readonly cerradoAt: Date | null;
}

export interface NuevoEquipmentRental {
  readonly projectId: string;
  readonly supplierId: string;
  readonly descripcionEquipo: string;
  readonly cantidadInicial: number;
  readonly boletaAttachmentId: string | null;
}

export interface EquipmentMovementInput {
  readonly rentalId: string;
  readonly tipo: TipoMovimientoEquipo;
  readonly cantidad: number;
  readonly boletaAttachmentId: string | null;
  readonly registradoPor: string | null;
  readonly at: Date;
}

export interface EquipmentMovement extends EquipmentMovementInput {
  readonly id: string;
}

export interface EquipmentMovementResultado {
  readonly movimiento: EquipmentMovement;
  /** `equipment_rentals` releido DESPUES del INSERT: el trigger 009 ya recalculo `cantidadActiva`. */
  readonly rental: EquipmentRental;
}

export interface EquipmentRepo {
  crearRental(input: NuevoEquipmentRental): Promise<EquipmentRental>;
  rentalPorId(rentalId: string): Promise<EquipmentRental | null>;
  rentalsActivosPorProyecto(projectId: string): Promise<readonly EquipmentRental[]>;
  rentalsActivosPorProveedor(supplierId: string): Promise<readonly EquipmentRental[]>;
  /**
   * Inserta el movimiento; NUNCA escribe `cantidadActiva` a mano — el trigger de la migracion
   * 009 la recalcula sobre el INSERT. Este metodo relee `equipment_rentals` despues de
   * insertar para devolver el saldo ya actualizado (evita un round-trip extra del llamador).
   */
  crearMovimiento(input: EquipmentMovementInput): Promise<EquipmentMovementResultado>;
  movimientosPorRental(rentalId: string): Promise<readonly EquipmentMovement[]>;
  /** Fija `estado='cerrado'` + `cerradoAt`. El guard `alquilerDebeCerrarse` (core) vive en la tool. */
  cerrarRental(rentalId: string, cerradoAt: Date): Promise<EquipmentRental>;
}

// ---------------------------------------------------------------------------
// dashboard_links (data-model.md §Identidad y acceso; tools.md `generar_link_dashboard`).
// ---------------------------------------------------------------------------

export interface DashboardLink {
  readonly id: string;
  readonly tokenHash: string;
  readonly projectId: string;
  readonly expiresAt: Date;
  readonly createdBy: string | null;
}

export interface NuevoDashboardLink {
  readonly tokenHash: string;
  readonly projectId: string;
  readonly expiresAt: Date;
  readonly createdBy: string | null;
}

export interface DashboardLinkRepo {
  crear(input: NuevoDashboardLink): Promise<DashboardLink>;
  /** `null` si no existe o si `expiresAt <= ahora` (vencido). */
  porTokenHashVigente(tokenHash: string, ahora: Date): Promise<DashboardLink | null>;
}

// ---------------------------------------------------------------------------
// feedback (data-model.md §Mensajeria y operacion; tools.md `registrar_retroalimentacion`).
// ---------------------------------------------------------------------------

export interface Feedback {
  readonly id: string;
  readonly userId: string | null;
  readonly tipo: TipoFeedback;
  readonly texto: string;
  readonly contexto: unknown;
}

export interface NuevoFeedback {
  readonly userId: string | null;
  readonly tipo: TipoFeedback;
  readonly texto: string;
  readonly contexto?: unknown;
}

export interface FeedbackRepo {
  crear(input: NuevoFeedback): Promise<Feedback>;
}

// ---------------------------------------------------------------------------
// attachments / attachment_blobs (data-model.md; outbox-whatsapp.md §Documentos adjuntos):
// mientras no exista Azure Blob (D-2), los bytes viven en Postgres y `attachments.blob_path`
// usa la convencion `pg://attachment_blobs/<id>`. Primer consumidor: `emitir_oc` (PDF de OC).
// ---------------------------------------------------------------------------

export interface NuevoAttachment {
  readonly contentType: string;
  /**
   * sha256 en hex. Lo calcula el CALLER (la tool) sobre `bytes` antes de invocar el repo:
   * el repo solo persiste lo que recibe (decision documentada aqui porque no hay otro sitio
   * normativo — no cambia el contrato si mas adelante se mueve el calculo).
   */
  readonly sha256: string;
  /** wamid de origen si el adjunto vino de un mensaje entrante; `null` para documentos generados (ej. PDF de OC). */
  readonly origen: string | null;
  readonly bytes: Buffer;
}

export interface Attachment {
  readonly id: string;
  readonly blobPath: string;
  readonly contentType: string | null;
  readonly sha256: string | null;
  readonly origen: string | null;
  /** Tamano en bytes (columna `attachments.bytes`); NO son los bytes en si (esos viven en `attachment_blobs`). */
  readonly tamanoBytes: number | null;
}

export interface AttachmentRepo {
  /** Inserta `attachments` + `attachment_blobs` en la MISMA llamada (misma `Tx` del `Ctx` del caller). */
  crearConBytes(input: NuevoAttachment): Promise<Attachment>;
  porId(attachmentId: string): Promise<Attachment | null>;
}

// ---------------------------------------------------------------------------
// approval_events (lectura de la ultima adjudicacion): `emitir_oc` necesita la ultima
// `approval_events(tipo='ganador')` del pedido (tools.md `emitir_oc` "Fuente de datos"). La
// forma de `asignaciones` espeja la "forma normativa de detalle" que escribe `aprobar_ganador`
// (`AsignacionGanadorDetalle` en `tools/adjudicacion.ts`) — se define de nuevo aqui (en vez de
// importarla desde `tools/`) para no crear una dependencia runtime -> tools.
// ---------------------------------------------------------------------------

export interface AsignacionGanadorAprobada {
  readonly supplierId: string;
  readonly pedidoItemIds: readonly string[];
  readonly quoteResponseId: string;
}

export interface ApprovalGanador {
  readonly pedidoId: string;
  readonly asignaciones: readonly AsignacionGanadorAprobada[];
}

export interface ApprovalRepo {
  /**
   * Ultima `approval_events(tipo='ganador')` del pedido, o `null` si nunca se aprobo un
   * ganador (o si el `detalle` persistido no calza con la forma normativa: defensivo,
   * `emitir_oc` nunca emite una OC "de memoria").
   */
  ultimoGanadorPorPedido(pedidoId: string): Promise<ApprovalGanador | null>;
}

// ---------------------------------------------------------------------------
// Cobertura de recepcion (state-machine.md §Computo de cobertura de recepcion, regla dura
// 3): agregado SQL de `receipt_confirmations`/`invoice_po_links`; el computo puro (que
// decide el estado objetivo a partir de estos numeros) vive en `@proveeduria/core`
// (`estadoObjetivoOc`/`estadoObjetivoPedido`). "Tests cruzados core<->SQL obligatorios".
// ---------------------------------------------------------------------------

export interface CoberturaRepo {
  /**
   * Por cada `po_item` de la OC: `cantidad` pedida y `cantidadRecibida` = Σ de
   * `receipt_confirmations.cantidades[po_item_id]` de facturas `conciliada` linkeadas a esta
   * OC via `invoice_po_links`. Alimenta directamente `estadoObjetivoOc` de core.
   */
  coberturaDeOc(ocId: string): Promise<readonly ItemCobertura[]>;
  /** Estados de las OCs del pedido (incluye `anulada`; `estadoObjetivoPedido` las filtra). */
  estadosOcDePedido(pedidoId: string): Promise<readonly OcParaCobertura[]>;
}

export interface Repos {
  readonly proyectos: ProyectoRepo;
  readonly pedidos: PedidoRepo;
  readonly pedidoItems: PedidoItemRepo;
  readonly usuarios: UsuarioRepo;
  readonly proveedores: ProveedorRepo;
  readonly quoteRequests: QuoteRequestRepo;
  readonly quoteResponses: QuoteResponseRepo;
  readonly comparativos: ComparativoRepo;
  readonly reviewQueue: ReviewQueueRepo;
  readonly config: ConfigRepo;
  readonly ocs: OcRepo;
  readonly invoices: InvoiceRepo;
  readonly invoicePoLinks: InvoicePoLinkRepo;
  readonly receiptConfirmations: ReceiptConfirmationRepo;
  readonly creditNotes: CreditNoteRepo;
  readonly equipment: EquipmentRepo;
  readonly dashboardLinks: DashboardLinkRepo;
  readonly feedback: FeedbackRepo;
  readonly cobertura: CoberturaRepo;
  readonly attachments: AttachmentRepo;
  readonly approvals: ApprovalRepo;
}

export interface AuditEvent {
  readonly accion: string;
  readonly entidad: string;
  readonly entidadId?: string | null;
  readonly pedidoId?: string | null;
  readonly antes?: unknown;
  readonly despues?: unknown;
  readonly origen?: OrigenAudit;
}

export interface OutboxMessage {
  readonly destino: string;
  readonly template?: string | null;
  readonly texto?: string | null;
  readonly payload?: unknown;
  readonly nextRetryAt?: Date | null;
  /**
   * Documento a adjuntar (header de plantilla, ej. PDF de OC). FK a `attachments.id`
   * (outbox-whatsapp.md §Contenido del mensaje, camino 1: el sender arma el link firmado al
   * momento del envio). `emitir_oc` es la primera tool que lo usa.
   */
  readonly attachmentId?: string | null;
}

export interface ApprovalEvent {
  readonly tipo: TipoAprobacion;
  readonly pedidoId?: string | null;
  readonly canal: CanalAprobacion;
  readonly detalle?: unknown;
  readonly at?: Date;
}

export interface Ctx {
  readonly tx: Tx;
  readonly actor: Actor;
  readonly ahora: Date;
  readonly origen: OrigenAudit;
  readonly audit: (e: AuditEvent) => Promise<void>;
  readonly outbox: (m: OutboxMessage) => Promise<void>;
  readonly approval: (e: ApprovalEvent) => Promise<void>;
  readonly repos: Repos;
}
