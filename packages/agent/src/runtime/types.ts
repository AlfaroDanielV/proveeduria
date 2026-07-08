import type {
  CodigoExcepcion,
  EstadoPedido,
  OrigenAudit,
  Result,
  Rol,
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
}

export interface PedidoRepo {
  siguienteNumeroPedido(ahora: Date): Promise<string>;
  crear(input: NuevoPedido): Promise<Pedido>;
  porId(pedidoId: string): Promise<Pedido | null>;
  confirmar(
    pedidoId: string,
    confirmadoAt: Date,
    confirmadoPor: string,
  ): Promise<Pedido>;
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

export interface Repos {
  readonly proyectos: ProyectoRepo;
  readonly pedidos: PedidoRepo;
  readonly pedidoItems: PedidoItemRepo;
  readonly usuarios: UsuarioRepo;
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

export interface Ctx {
  readonly tx: Tx;
  readonly actor: Actor;
  readonly ahora: Date;
  readonly origen: OrigenAudit;
  readonly audit: (e: AuditEvent) => Promise<void>;
  readonly outbox: (m: OutboxMessage) => Promise<void>;
  readonly repos: Repos;
}
