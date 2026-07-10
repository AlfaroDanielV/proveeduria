import type { EstadoPedido, EstadoQuoteRequest, EstadoQuoteResponse, FuenteExtraccion, Rol } from '@proveeduria/core';
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
