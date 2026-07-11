/**
 * Contratos del portal API (docs/specs/portal-api.md) tal como los consume el frontend.
 * Espejo del lado cliente — la fuente de verdad sigue siendo la spec / @proveeduria/core.
 */

export const ROLES = [
  'superadmin',
  'admin_materiales',
  'admin_equipos',
  'ingeniero',
  'bodeguero',
] as const;

export type Rol = (typeof ROLES)[number];

export interface Usuario {
  readonly userId: string;
  readonly nombre: string;
  readonly email: string;
  readonly roles: readonly Rol[];
  readonly projectIds: readonly string[];
}

export const ESTADOS_PEDIDO = [
  'borrador',
  'cotizando',
  'en_revision',
  'aprobado',
  'ordenado',
  'recepcion_parcial',
  'recepcion_total',
  'cerrado',
  'cancelado',
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export interface PedidoResumen {
  readonly id: string;
  readonly numero: string;
  readonly estado: EstadoPedido;
  readonly proyecto: { readonly id: string; readonly nombre: string; readonly codigo: string };
  readonly solicitante: { readonly userId: string; readonly nombre: string };
  readonly fechaRequerida: string | null;
  readonly urgencia: string;
  readonly plazoCotizacionAt: string | null;
  readonly itemsCount: number;
  readonly rfqsTotal: number;
  readonly rfqsRespondidas: number;
  readonly revisionesPendientes: number;
}

export interface ListaPaginada<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export type PedidosResponse = ListaPaginada<PedidoResumen>;

export interface PedidoItem {
  readonly descripcion: string;
  readonly cantidad: number;
  readonly unidad: string;
  readonly [clave: string]: unknown;
}

export interface UltimaRespuestaCotizacion {
  readonly fuente?: string | null;
  readonly confianzaExtraccion?: string | null;
}

export interface QuoteRequestResumen {
  readonly proveedor: string;
  readonly estado: string;
  readonly ultimaRespuesta: UltimaRespuestaCotizacion | null;
}

export interface RevisionPendienteResumen {
  readonly id: string;
  readonly tipo: string;
  readonly detalle?: unknown;
}

export interface PedidoDetalle {
  readonly pedido: PedidoResumen;
  readonly items: readonly PedidoItem[];
  readonly quoteRequests: readonly QuoteRequestResumen[];
  readonly revisionesPendientes?: readonly RevisionPendienteResumen[];
}

export interface ComparativoProveedor {
  readonly supplierId: string;
  readonly nombre: string;
  readonly quoteRequestId: string;
  readonly quoteRequestEstado: string;
  readonly quoteResponseId: string | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly total: number | null;
  readonly itemsCotizados: number;
  readonly itemsFaltantes: number;
}

export interface ComparativoFila {
  readonly pedidoItemId: string;
  readonly descripcion: string;
  readonly proveedor: string;
  readonly supplierId: string;
  readonly precioUnitario: number | null;
  readonly cantidadCotizada: number | null;
  readonly cantidadSolicitada: number;
  readonly subtotal: number | null;
  readonly faltante: boolean;
}

export interface Comparativo {
  readonly pedido: { readonly id: string; readonly numero: string; readonly estado: EstadoPedido };
  readonly resumenProveedores: readonly ComparativoProveedor[];
  readonly filas: readonly ComparativoFila[];
}

// --- Aprobaciones y acciones de pedido (docs/specs/portal-api.md §Aprobaciones) --------------

export interface AprobacionAprobadoPor {
  readonly userId: string;
  readonly nombre: string;
}

export interface AprobacionEvento {
  readonly id: string;
  readonly tipo: string;
  readonly aprobadoPor: AprobacionAprobadoPor;
  readonly canal: string;
  /** Para `tipo === 'ganador'` incluye el snapshot del comparativo (evidencia D5). */
  readonly detalle: unknown;
  readonly at: string;
}

export interface AprobacionesResponse {
  readonly items: readonly AprobacionEvento[];
}

export interface EnviarRfqsResultado {
  readonly pedidoId: string;
  readonly estado: EstadoPedido;
  readonly rfqs: number;
}

export interface AdjudicacionAsignacion {
  readonly supplierId: string;
  readonly pedidoItemIds: readonly string[];
}

export interface AdjudicarResultado {
  readonly pedidoId: string;
  readonly estado: EstadoPedido;
}

export interface OcEmitida {
  readonly ocId: string;
  readonly numero: string;
  readonly supplierId: string;
  readonly montoTotal: number;
}

export interface EmitirOcsResultado {
  readonly pedidoId: string;
  readonly estado: EstadoPedido;
  readonly ocs: readonly OcEmitida[];
}

export interface Contacto {
  readonly id: string;
  readonly nombre: string;
  readonly telefonoWhatsapp: string;
  readonly esPrincipal: boolean;
  readonly optinAt: string | null;
}

export interface Proveedor {
  readonly id: string;
  readonly nombre: string;
  readonly cedulaJuridica: string | null;
  readonly categorias: readonly string[];
  readonly activo: boolean;
  readonly notas: string | null;
  readonly contactos: readonly Contacto[];
}

export type ProveedoresResponse = ListaPaginada<Proveedor>;

export interface RevisionPedidoRef {
  readonly id: string;
  readonly numero: string;
}

export type EstadoRevision = 'pendiente' | 'resuelta';

export interface RevisionCola {
  readonly id: string;
  readonly tipo: string;
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedido: RevisionPedidoRef | null;
  readonly detalle: unknown;
  readonly estado: EstadoRevision;
  readonly createdAt: string;
  readonly resueltaPor?: string | null;
  readonly resolucion?: string | null;
}

export type RevisionesResponse = ListaPaginada<RevisionCola>;

export interface LoginResultado {
  readonly user: Usuario;
  readonly mustChangePassword: boolean;
}
