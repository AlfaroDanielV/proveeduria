import type {
  CanalAprobacion,
  EstadoPedido,
  EstadoQuoteRequest,
  EstadoQuoteResponse,
  FuenteExtraccion,
  Result,
  Rol,
  TipoAprobacion,
} from '@proveeduria/core';
import type { ComparativoCotizacionFila } from '@proveeduria/agent';

export interface PortalActor {
  readonly userId: string;
  readonly nombre: string;
  readonly email: string | null;
  readonly roles: readonly Rol[];
  readonly projectIds: readonly string[];
}

export interface ProyectoPortal {
  readonly id: string;
  readonly nombre: string;
  readonly codigo: string;
}

export interface SolicitantePortal {
  readonly userId: string | null;
  readonly nombre: string | null;
}

export interface PedidoResumenPortal {
  readonly id: string;
  readonly numero: string;
  readonly estado: EstadoPedido;
  readonly proyecto: ProyectoPortal;
  readonly solicitante: SolicitantePortal;
  readonly fechaRequerida: string | null;
  readonly urgencia: string | null;
  readonly plazoCotizacionAt: string | null;
  readonly itemsCount: number;
  readonly rfqsTotal: number;
  readonly rfqsRespondidas: number;
  readonly revisionesPendientes: number;
}

export interface PedidoItemPortal {
  readonly id: string;
  readonly descripcion: string;
  readonly cantidad: number;
  readonly unidad: string;
}

export interface QuoteResponsePortal {
  readonly id: string;
  readonly recibidoAt: string | null;
  readonly fuente: FuenteExtraccion | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly confianzaExtraccion: number | null;
  readonly estado: EstadoQuoteResponse;
  readonly intentosRepregunta: number;
}

export interface QuoteRequestPortal {
  readonly id: string;
  readonly supplierId: string;
  readonly proveedor: string;
  readonly estado: EstadoQuoteRequest;
  readonly plazoAt: string | null;
  readonly ultimaRespuesta: QuoteResponsePortal | null;
}

export interface ReviewQueuePortal {
  readonly id: string;
  readonly tipo: string;
  readonly entidad: string;
  readonly entidadId: string;
  readonly detalle: unknown;
  readonly estado: string;
  readonly createdAt: string;
}

export interface PedidoDetallePortal {
  readonly pedido: PedidoResumenPortal;
  readonly items: readonly PedidoItemPortal[];
  readonly quoteRequests: readonly QuoteRequestPortal[];
  readonly revisionesPendientes: readonly ReviewQueuePortal[];
}

export interface ComparativoProveedorPortal {
  readonly supplierId: string;
  readonly nombre: string;
  readonly quoteRequestId: string;
  readonly quoteRequestEstado: EstadoQuoteRequest;
  readonly quoteResponseId: string | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly total: number;
  readonly itemsCotizados: number;
  readonly itemsFaltantes: number;
}

export interface ComparativoPortal {
  readonly pedido: Pick<PedidoResumenPortal, 'id' | 'numero' | 'estado' | 'proyecto'>;
  readonly resumenProveedores: readonly ComparativoProveedorPortal[];
  readonly filas: readonly ComparativoCotizacionFila[];
}

export interface ListarPedidosFiltro {
  readonly estado?: EstadoPedido;
  readonly projectId?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ListaPedidosPortal {
  readonly items: readonly PedidoResumenPortal[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface PortalStore {
  usuarioPorId(userId: string): Promise<PortalActor | null>;
  listarPedidos(actor: PortalActor, filtro: ListarPedidosFiltro): Promise<ListaPedidosPortal>;
  detallePedido(actor: PortalActor, pedidoId: string): Promise<PedidoDetallePortal | null>;
  comparativoPedido(actor: PortalActor, pedidoId: string): Promise<ComparativoPortal | null>;
}

// ---------------------------------------------------------------------------
// Proveedores (ola 1, docs/specs/portal-api.md §Proveedores;
// docs/specs/control-center.md §CRUD proveedores).
// ---------------------------------------------------------------------------

export interface ProveedorContactoPortal {
  readonly id: string;
  readonly nombre: string | null;
  readonly telefonoWhatsapp: string;
  readonly esPrincipal: boolean;
  readonly optinAt: string | null;
}

export interface ProveedorPortal {
  readonly id: string;
  readonly nombre: string;
  readonly cedulaJuridica: string | null;
  readonly categorias: readonly string[];
  readonly activo: boolean;
  readonly notas: string | null;
  readonly contactos: readonly ProveedorContactoPortal[];
}

export interface ListarProveedoresFiltro {
  readonly activo?: boolean;
  readonly q?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ListaProveedoresPortal {
  readonly items: readonly ProveedorPortal[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface NuevoProveedorInput {
  readonly nombre: string;
  readonly cedulaJuridica: string | null;
  readonly categorias: readonly string[];
  readonly notas: string | null;
}

export interface ActualizarProveedorInput {
  readonly nombre?: string;
  readonly cedulaJuridica?: string | null;
  readonly categorias?: readonly string[];
  readonly notas?: string | null;
  readonly activo?: boolean;
}

export interface NuevoContactoInput {
  readonly nombre: string | null;
  readonly telefonoWhatsapp: string;
  readonly esPrincipal: boolean;
}

export interface ActualizarContactoInput {
  readonly nombre?: string | null;
  readonly esPrincipal?: boolean;
}

/** `no_encontrado` => el `supplierId` no existe; `telefono_duplicado` => constraint unique. */
export type ErrorCrearContacto = 'no_encontrado' | 'telefono_duplicado';

export interface ProveedoresStore {
  listar(filtro: ListarProveedoresFiltro): Promise<ListaProveedoresPortal>;
  porId(supplierId: string): Promise<ProveedorPortal | null>;
  crear(actor: PortalActor, input: NuevoProveedorInput, ahora: Date): Promise<ProveedorPortal>;
  actualizar(
    actor: PortalActor,
    supplierId: string,
    input: ActualizarProveedorInput,
    ahora: Date,
  ): Promise<ProveedorPortal | null>;
  crearContacto(
    actor: PortalActor,
    supplierId: string,
    input: NuevoContactoInput,
    ahora: Date,
  ): Promise<Result<ProveedorContactoPortal, ErrorCrearContacto>>;
  actualizarContacto(
    actor: PortalActor,
    contactoId: string,
    input: ActualizarContactoInput,
    ahora: Date,
  ): Promise<ProveedorContactoPortal | null>;
  optinContacto(actor: PortalActor, contactoId: string, ahora: Date): Promise<ProveedorContactoPortal | null>;
  bajaContacto(actor: PortalActor, contactoId: string, ahora: Date): Promise<ProveedorContactoPortal | null>;
}

// ---------------------------------------------------------------------------
// Cola de revision (ola 1, docs/specs/portal-api.md §Cola de revision;
// docs/specs/control-center.md §Resolver cola de revision).
// ---------------------------------------------------------------------------

export interface RevisionPedidoRefPortal {
  readonly id: string;
  readonly numero: string;
}

export interface RevisionResueltaPorPortal {
  readonly userId: string;
  readonly nombre: string;
}

export interface RevisionColaPortal {
  readonly id: string;
  readonly tipo: string;
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedido: RevisionPedidoRefPortal | null;
  readonly detalle: unknown;
  readonly estado: 'pendiente' | 'resuelta';
  readonly createdAt: string;
  readonly resueltaPor: RevisionResueltaPorPortal | null;
  readonly resolucion: string | null;
}

export interface ListarRevisionesFiltro {
  readonly estado: 'pendiente' | 'resuelta';
  readonly tipo?: string;
  readonly projectId?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ListaRevisionesPortal {
  readonly items: readonly RevisionColaPortal[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** `no_encontrada` => el id no existe; `ya_resuelta` => estado ya era `resuelta` (409). */
export type ErrorResolverRevision = 'no_encontrada' | 'ya_resuelta';

export interface RevisionesStore {
  listar(filtro: ListarRevisionesFiltro): Promise<ListaRevisionesPortal>;
  resolver(
    actor: PortalActor,
    revisionId: string,
    resolucion: string,
    ahora: Date,
  ): Promise<Result<RevisionColaPortal, ErrorResolverRevision>>;
}

// ---------------------------------------------------------------------------
// Aprobaciones y acciones de pedido (C2, docs/specs/portal-api.md §Aprobaciones y acciones
// de pedido; docs/specs/control-center.md §Principios). SOLO lectura del historial vive aca
// (`AprobacionesStore`): las 4 mutaciones EJECUTAN tools de `@proveeduria/agent` via
// `ejecutarToolPedido` (acciones-pedido.ts), no un store portal-only.
// ---------------------------------------------------------------------------

export interface AprobadoPorPortal {
  readonly userId: string;
  readonly nombre: string;
}

export interface AprobacionEventoPortal {
  readonly id: string;
  readonly tipo: TipoAprobacion;
  readonly aprobadoPor: AprobadoPorPortal;
  readonly canal: CanalAprobacion;
  readonly detalle: unknown;
  readonly at: string;
}

export interface ListaAprobacionesPortal {
  readonly items: readonly AprobacionEventoPortal[];
}

export interface AprobacionesStore {
  /** Historial de `approval_events` del pedido, mas reciente primero. `null` si el pedido no existe (404). */
  historial(pedidoId: string): Promise<ListaAprobacionesPortal | null>;
}
