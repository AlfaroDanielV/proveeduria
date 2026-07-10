import { PgComparativoRepo } from '@proveeduria/agent';
import type { Tx, ComparativoCotizacionFila } from '@proveeduria/agent';
import type { EstadoPedido, EstadoQuoteRequest, EstadoQuoteResponse, FuenteExtraccion, Rol } from '@proveeduria/core';

import { tieneAccesoGlobal } from './auth.js';
import type {
  ComparativoPortal,
  ComparativoProveedorPortal,
  ListaPedidosPortal,
  ListarPedidosFiltro,
  PedidoDetallePortal,
  PedidoItemPortal,
  PedidoResumenPortal,
  PortalActor,
  PortalStore,
  QuoteRequestPortal,
  ReviewQueuePortal,
} from './types.js';

interface ActorRow {
  readonly userId: string;
  readonly nombre: string;
  readonly email: string | null;
  readonly roles: readonly Rol[] | string;
  readonly projectIds: readonly string[] | string;
}

interface PedidoResumenRow {
  readonly id: string;
  readonly numero: string;
  readonly estado: EstadoPedido;
  readonly projectId: string;
  readonly proyectoNombre: string;
  readonly proyectoCodigo: string;
  readonly solicitanteUserId: string | null;
  readonly solicitanteNombre: string | null;
  readonly fechaRequerida: string | null;
  readonly urgencia: string | null;
  readonly plazoCotizacionAt: Date | string | null;
  readonly itemsCount: number | string;
  readonly rfqsTotal: number | string;
  readonly rfqsRespondidas: number | string;
  readonly revisionesPendientes: number | string;
}

interface PedidoItemRow {
  readonly id: string;
  readonly descripcion: string;
  readonly cantidad: number | string;
  readonly unidad: string | null;
}

interface QuoteRequestRow {
  readonly id: string;
  readonly supplierId: string;
  readonly proveedor: string;
  readonly estado: EstadoQuoteRequest;
  readonly plazoAt: Date | string | null;
  readonly quoteResponseId: string | null;
  readonly recibidoAt: Date | string | null;
  readonly fuente: FuenteExtraccion | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly confianzaExtraccion: number | string | null;
  readonly quoteResponseEstado: EstadoQuoteResponse | null;
  readonly intentosRepregunta: number | string | null;
}

interface ReviewQueueRow {
  readonly id: string;
  readonly tipo: string;
  readonly entidad: string;
  readonly entidadId: string;
  readonly detalle: unknown;
  readonly estado: string;
  readonly createdAt: Date | string;
}

function arrayFromRow<T extends string>(value: readonly T[] | string): readonly T[] {
  if (typeof value !== 'string') return value;
  return value.replace(/[{}]/g, '').split(',').filter(Boolean) as T[];
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function mapPedido(row: PedidoResumenRow): PedidoResumenPortal {
  return {
    id: row.id,
    numero: row.numero,
    estado: row.estado,
    proyecto: {
      id: row.projectId,
      nombre: row.proyectoNombre,
      codigo: row.proyectoCodigo,
    },
    solicitante: {
      userId: row.solicitanteUserId,
      nombre: row.solicitanteNombre,
    },
    fechaRequerida: row.fechaRequerida,
    urgencia: row.urgencia,
    plazoCotizacionAt: iso(row.plazoCotizacionAt),
    itemsCount: Number(row.itemsCount),
    rfqsTotal: Number(row.rfqsTotal),
    rfqsRespondidas: Number(row.rfqsRespondidas),
    revisionesPendientes: Number(row.revisionesPendientes),
  };
}

function mapItem(row: PedidoItemRow): PedidoItemPortal {
  return {
    id: row.id,
    descripcion: row.descripcion,
    cantidad: Number(row.cantidad),
    unidad: row.unidad ?? '',
  };
}

function mapQuoteRequest(row: QuoteRequestRow): QuoteRequestPortal {
  return {
    id: row.id,
    supplierId: row.supplierId,
    proveedor: row.proveedor,
    estado: row.estado,
    plazoAt: iso(row.plazoAt),
    ultimaRespuesta: row.quoteResponseId === null
      ? null
      : {
          id: row.quoteResponseId,
          recibidoAt: iso(row.recibidoAt),
          fuente: row.fuente,
          condiciones: row.condiciones,
          plazoEntrega: row.plazoEntrega,
          confianzaExtraccion: row.confianzaExtraccion === null
            ? null
            : Number(row.confianzaExtraccion),
          estado: row.quoteResponseEstado ?? 'completa',
          intentosRepregunta: Number(row.intentosRepregunta ?? 0),
        },
  };
}

function mapReview(row: ReviewQueueRow): ReviewQueuePortal {
  return {
    id: row.id,
    tipo: row.tipo,
    entidad: row.entidad,
    entidadId: row.entidadId,
    detalle: row.detalle,
    estado: row.estado,
    createdAt: iso(row.createdAt) ?? '',
  };
}

function agregarAlcance(
  actor: PortalActor,
  alias: string,
  params: unknown[],
): string | null {
  if (tieneAccesoGlobal(actor)) return null;
  if (actor.projectIds.length === 0) return '__sin_alcance__';
  params.push(actor.projectIds);
  return `${alias}.project_id = ANY($${params.length}::uuid[])`;
}

function resumenProveedores(filas: readonly ComparativoCotizacionFila[]): readonly ComparativoProveedorPortal[] {
  const porProveedor = new Map<string, ComparativoProveedorPortal>();

  for (const fila of filas) {
    const actual = porProveedor.get(fila.supplierId) ?? {
      supplierId: fila.supplierId,
      nombre: fila.proveedor,
      quoteRequestId: fila.quoteRequestId,
      quoteRequestEstado: fila.quoteRequestEstado,
      quoteResponseId: fila.quoteResponseId,
      condiciones: fila.condiciones,
      plazoEntrega: fila.plazoEntrega,
      total: 0,
      itemsCotizados: 0,
      itemsFaltantes: 0,
    };

    const total = fila.faltante || fila.subtotal === null ? actual.total : actual.total + fila.subtotal;
    const itemsCotizados = fila.faltante ? actual.itemsCotizados : actual.itemsCotizados + 1;
    const itemsFaltantes = fila.faltante ? actual.itemsFaltantes + 1 : actual.itemsFaltantes;

    porProveedor.set(fila.supplierId, {
      ...actual,
      total,
      itemsCotizados,
      itemsFaltantes,
    });
  }

  return [...porProveedor.values()].sort((a, b) => {
    if (a.itemsFaltantes !== b.itemsFaltantes) return a.itemsFaltantes - b.itemsFaltantes;
    return a.total - b.total;
  });
}

export class PgPortalStore implements PortalStore {
  constructor(private readonly db: Tx) {}

  async usuarioPorId(userId: string): Promise<PortalActor | null> {
    const result = await this.db.query<ActorRow>(
      'SELECT u.id AS "userId", u.nombre, u.email, ' +
        "COALESCE(array_agg(DISTINCT r.clave) FILTER (WHERE r.clave IS NOT NULL), '{}') AS roles, " +
        "COALESCE(array_agg(DISTINCT ur.project_id::text) FILTER (WHERE ur.project_id IS NOT NULL), '{}') AS \"projectIds\" " +
        'FROM users u ' +
        'LEFT JOIN user_roles ur ON ur.user_id = u.id ' +
        'LEFT JOIN roles r ON r.id = ur.role_id ' +
        'WHERE u.id = $1 AND u.activo IS TRUE ' +
        'GROUP BY u.id',
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      userId: row.userId,
      nombre: row.nombre,
      email: row.email,
      roles: arrayFromRow(row.roles),
      projectIds: arrayFromRow(row.projectIds),
    };
  }

  async listarPedidos(actor: PortalActor, filtro: ListarPedidosFiltro): Promise<ListaPedidosPortal> {
    const params: unknown[] = [];
    const where: string[] = [];
    const alcance = agregarAlcance(actor, 'p', params);
    if (alcance === '__sin_alcance__') {
      return { items: [], total: 0, limit: filtro.limit, offset: filtro.offset };
    }
    if (alcance !== null) where.push(alcance);

    if (filtro.estado !== undefined) {
      params.push(filtro.estado);
      where.push(`p.estado = $${params.length}`);
    }
    if (filtro.projectId !== undefined) {
      params.push(filtro.projectId);
      where.push(`p.project_id = $${params.length}`);
    }

    const whereSql = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    const countResult = await this.db.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM pedidos p ${whereSql}`,
      params,
    );

    const listParams = [...params, filtro.limit, filtro.offset];
    const result = await this.db.query<PedidoResumenRow>(
      'SELECT p.id, p.numero, p.estado, p.project_id AS "projectId", ' +
        'pr.nombre AS "proyectoNombre", pr.codigo AS "proyectoCodigo", ' +
        'u.id AS "solicitanteUserId", u.nombre AS "solicitanteNombre", ' +
        'p.fecha_requerida::text AS "fechaRequerida", p.urgencia, ' +
        'p.plazo_cotizacion_at AS "plazoCotizacionAt", ' +
        'count(DISTINCT pi.id)::int AS "itemsCount", ' +
        'count(DISTINCT qr.id)::int AS "rfqsTotal", ' +
        "count(DISTINCT qr.id) FILTER (WHERE qr.estado = 'respondida')::int AS \"rfqsRespondidas\", " +
        "count(DISTINCT rq.id) FILTER (WHERE rq.estado = 'pendiente')::int AS \"revisionesPendientes\" " +
        'FROM pedidos p ' +
        'JOIN projects pr ON pr.id = p.project_id ' +
        'LEFT JOIN users u ON u.id = p.solicitante_user_id ' +
        'LEFT JOIN pedido_items pi ON pi.pedido_id = p.id ' +
        'LEFT JOIN quote_requests qr ON qr.pedido_id = p.id ' +
        'LEFT JOIN review_queue rq ON rq.pedido_id = p.id ' +
        `${whereSql} ` +
        'GROUP BY p.id, pr.id, u.id ' +
        'ORDER BY p.created_at DESC, p.id DESC ' +
        `LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    return {
      items: result.rows.map(mapPedido),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit: filtro.limit,
      offset: filtro.offset,
    };
  }

  async detallePedido(actor: PortalActor, pedidoId: string): Promise<PedidoDetallePortal | null> {
    const params: unknown[] = [pedidoId];
    const where = ['p.id = $1'];
    const alcance = agregarAlcance(actor, 'p', params);
    if (alcance === '__sin_alcance__') return null;
    if (alcance !== null) where.push(alcance);

    const pedidoResult = await this.db.query<PedidoResumenRow>(
      'SELECT p.id, p.numero, p.estado, p.project_id AS "projectId", ' +
        'pr.nombre AS "proyectoNombre", pr.codigo AS "proyectoCodigo", ' +
        'u.id AS "solicitanteUserId", u.nombre AS "solicitanteNombre", ' +
        'p.fecha_requerida::text AS "fechaRequerida", p.urgencia, ' +
        'p.plazo_cotizacion_at AS "plazoCotizacionAt", ' +
        'count(DISTINCT pi_count.id)::int AS "itemsCount", ' +
        'count(DISTINCT qr_count.id)::int AS "rfqsTotal", ' +
        "count(DISTINCT qr_count.id) FILTER (WHERE qr_count.estado = 'respondida')::int AS \"rfqsRespondidas\", " +
        "count(DISTINCT rq_count.id) FILTER (WHERE rq_count.estado = 'pendiente')::int AS \"revisionesPendientes\" " +
        'FROM pedidos p ' +
        'JOIN projects pr ON pr.id = p.project_id ' +
        'LEFT JOIN users u ON u.id = p.solicitante_user_id ' +
        'LEFT JOIN pedido_items pi_count ON pi_count.pedido_id = p.id ' +
        'LEFT JOIN quote_requests qr_count ON qr_count.pedido_id = p.id ' +
        'LEFT JOIN review_queue rq_count ON rq_count.pedido_id = p.id ' +
        `WHERE ${where.join(' AND ')} ` +
        'GROUP BY p.id, pr.id, u.id',
      params,
    );
    const pedidoRow = pedidoResult.rows[0];
    if (pedidoRow === undefined) return null;

    const itemsResult = await this.db.query<PedidoItemRow>(
      'SELECT id, descripcion, cantidad::float8 AS cantidad, unidad ' +
        'FROM pedido_items WHERE pedido_id = $1 ORDER BY created_at ASC, id ASC',
      [pedidoId],
    );
    const quoteRequestsResult = await this.db.query<QuoteRequestRow>(
      'SELECT qr.id, qr.supplier_id AS "supplierId", s.nombre AS proveedor, ' +
        'qr.estado, qr.plazo_at AS "plazoAt", ' +
        'qres.id AS "quoteResponseId", qres.recibido_at AS "recibidoAt", ' +
        'qres.fuente, qres.condiciones, qres.plazo_entrega AS "plazoEntrega", ' +
        'qres.confianza_extraccion AS "confianzaExtraccion", ' +
        'qres.estado AS "quoteResponseEstado", qres.intentos_repregunta AS "intentosRepregunta" ' +
        'FROM quote_requests qr ' +
        'JOIN suppliers s ON s.id = qr.supplier_id ' +
        'LEFT JOIN LATERAL ( ' +
        'SELECT id, recibido_at, fuente, condiciones, plazo_entrega, confianza_extraccion, estado, intentos_repregunta ' +
        'FROM quote_responses WHERE quote_request_id = qr.id ' +
        'ORDER BY recibido_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1 ' +
        ') qres ON true ' +
        'WHERE qr.pedido_id = $1 ORDER BY s.nombre ASC, qr.id ASC',
      [pedidoId],
    );
    const reviewResult = await this.db.query<ReviewQueueRow>(
      "SELECT id, tipo, entidad, entidad_id AS \"entidadId\", detalle, estado, created_at AS \"createdAt\" " +
        "FROM review_queue WHERE pedido_id = $1 AND estado = 'pendiente' " +
        'ORDER BY created_at ASC, id ASC',
      [pedidoId],
    );

    return {
      pedido: mapPedido(pedidoRow),
      items: itemsResult.rows.map(mapItem),
      quoteRequests: quoteRequestsResult.rows.map(mapQuoteRequest),
      revisionesPendientes: reviewResult.rows.map(mapReview),
    };
  }

  async comparativoPedido(actor: PortalActor, pedidoId: string): Promise<ComparativoPortal | null> {
    const detalle = await this.detallePedido(actor, pedidoId);
    if (detalle === null) return null;

    const comparativos = new PgComparativoRepo(this.db);
    const filas = await comparativos.porPedido(pedidoId);

    return {
      pedido: {
        id: detalle.pedido.id,
        numero: detalle.pedido.numero,
        estado: detalle.pedido.estado,
        proyecto: detalle.pedido.proyecto,
      },
      resumenProveedores: resumenProveedores(filas),
      filas,
    };
  }
}
