import type {
  CanalAprobacion,
  CodigoExcepcion,
  EstadoPedido,
  EstadoQuoteResponse,
  FuenteExtraccion,
  OrigenAudit,
  Result,
  Rol,
  TipoAprobacion,
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

export interface QuoteResponseRepo {
  crear(input: NuevoQuoteResponse): Promise<QuoteResponse>;
  insertarItems(
    quoteResponseId: string,
    items: readonly QuoteItemInput[],
  ): Promise<readonly QuoteItem[]>;
  contarIncompletas(quoteRequestId: string): Promise<number>;
}

export interface ReviewQueueEntry {
  readonly id: string;
  readonly tipo: TipoReviewQueue;
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedidoId: string | null;
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
}

export interface ConfigRepo {
  umbrales(): Promise<UmbralesConfig>;
}

export interface Repos {
  readonly proyectos: ProyectoRepo;
  readonly pedidos: PedidoRepo;
  readonly pedidoItems: PedidoItemRepo;
  readonly usuarios: UsuarioRepo;
  readonly proveedores: ProveedorRepo;
  readonly quoteRequests: QuoteRequestRepo;
  readonly quoteResponses: QuoteResponseRepo;
  readonly reviewQueue: ReviewQueueRepo;
  readonly config: ConfigRepo;
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
