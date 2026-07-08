import { UMBRALES_DEFAULT } from '@proveeduria/core';
import type { Rol, UmbralesConfig } from '@proveeduria/core';
import type {
  Actor,
  ComparativoCotizacionFila,
  ComparativoRepo,
  ConfigRepo,
  ItemPedidoInput,
  NuevoPedido,
  NuevoQuoteRequest,
  NuevoQuoteResponse,
  NuevoReviewQueueEntry,
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

interface ProyectoRow {
  readonly id: string;
  readonly nombre: string;
  readonly codigo: string;
  readonly activo: boolean;
}

interface PedidoRow {
  readonly id: string;
  readonly numero: string;
  readonly projectId: string;
  readonly solicitanteUserId: string;
  readonly estado: Pedido['estado'];
  readonly fechaRequerida: string | null;
  readonly urgencia: string | null;
  readonly confirmadoAt: Date | string | null;
  readonly confirmadoPor: string | null;
  readonly plazoCotizacionAt: Date | string | null;
}

interface PedidoItemRow {
  readonly id: string;
  readonly pedidoId: string;
  readonly descripcion: string;
  readonly cantidad: number | string;
  readonly unidad: string;
}

interface UsuarioRow {
  readonly userId: string;
  readonly nombre: string;
  readonly telefonoWhatsapp: string | null;
  readonly roles: readonly Rol[] | string;
}

interface ProveedorRow {
  readonly id: string;
  readonly nombre: string;
  readonly categorias: readonly string[] | string;
  readonly activo: boolean;
  readonly contactoId: string | null;
  readonly contactoNombre: string | null;
  readonly contactoTelefono: string | null;
  readonly contactoOptinAt: Date | string | null;
  readonly contactoEsPrincipal: boolean | null;
}

interface QuoteRequestRow {
  readonly id: string;
  readonly pedidoId: string;
  readonly supplierId: string;
  readonly plazoAt: Date | string;
  readonly estado: QuoteRequest['estado'];
}

interface QuoteResponseRow {
  readonly id: string;
  readonly quoteRequestId: string;
  readonly recibidoAt: Date | string;
  readonly fuente: QuoteResponse['fuente'];
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly confianzaExtraccion: number | string;
  readonly estado: QuoteResponse['estado'];
  readonly intentosRepregunta: number;
}

interface QuoteItemRow {
  readonly id: string;
  readonly quoteResponseId: string;
  readonly pedidoItemId: string | null;
  readonly precioUnitario: number | string | null;
  readonly cantidad: number | string | null;
  readonly disponible: boolean | null;
  readonly notas: string | null;
}

interface ComparativoCotizacionRow {
  readonly pedidoItemId: string;
  readonly descripcion: string;
  readonly cantidadSolicitada: number | string;
  readonly unidad: string;
  readonly supplierId: string;
  readonly proveedor: string;
  readonly quoteRequestId: string;
  readonly quoteRequestEstado: QuoteRequest['estado'];
  readonly quoteResponseId: string | null;
  readonly precioUnitario: number | string | null;
  readonly cantidadCotizada: number | string | null;
  readonly disponible: boolean | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly subtotal: number | string | null;
  readonly faltante: boolean;
  readonly notas: string | null;
}

interface ReviewQueueRow {
  readonly id: string;
  readonly tipo: ReviewQueueEntry['tipo'];
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedidoId: string | null;
}

interface ConfigRow {
  readonly clave: string;
  readonly valor: unknown;
}

function rolesFromRow(value: readonly Rol[] | string): readonly Rol[] {
  if (typeof value !== 'string') return value;
  return value.replace(/[{}]/g, '').split(',').filter(Boolean) as Rol[];
}

function textArrayFromRow(value: readonly string[] | string): readonly string[] {
  if (typeof value !== 'string') return value;
  return value.replace(/[{}]/g, '').split(',').filter(Boolean);
}

function dateFromRow(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapPedido(row: PedidoRow): Pedido {
  return {
    id: row.id,
    numero: row.numero,
    projectId: row.projectId,
    solicitanteUserId: row.solicitanteUserId,
    estado: row.estado,
    fechaRequerida: row.fechaRequerida,
    urgencia: row.urgencia,
    confirmadoAt:
      row.confirmadoAt === null
        ? null
        : dateFromRow(row.confirmadoAt),
    confirmadoPor: row.confirmadoPor,
    plazoCotizacionAt:
      row.plazoCotizacionAt === null
        ? null
        : dateFromRow(row.plazoCotizacionAt),
  };
}

function mapItem(row: PedidoItemRow): PedidoItem {
  return {
    id: row.id,
    pedidoId: row.pedidoId,
    descripcion: row.descripcion,
    cantidad: Number(row.cantidad),
    unidad: row.unidad,
  };
}

function mapActor(row: UsuarioRow): Actor {
  return {
    userId: row.userId,
    nombre: row.nombre,
    roles: rolesFromRow(row.roles),
  };
}

function mapUsuarioInterno(row: UsuarioRow): UsuarioInterno | null {
  if (row.telefonoWhatsapp === null) return null;
  return {
    ...mapActor(row),
    telefonoWhatsapp: row.telefonoWhatsapp,
  };
}

function mapProveedor(row: ProveedorRow): Proveedor {
  let contactoPrincipal: ProveedorContacto | null = null;
  if (
    row.contactoId !== null &&
    row.contactoTelefono !== null &&
    row.contactoEsPrincipal !== null
  ) {
    contactoPrincipal = {
      id: row.contactoId,
      supplierId: row.id,
      nombre: row.contactoNombre,
      telefonoWhatsapp: row.contactoTelefono,
      optinAt:
        row.contactoOptinAt === null
          ? null
          : dateFromRow(row.contactoOptinAt),
      esPrincipal: row.contactoEsPrincipal,
    };
  }
  return {
    id: row.id,
    nombre: row.nombre,
    categorias: textArrayFromRow(row.categorias),
    activo: row.activo,
    contactoPrincipal,
  };
}

function mapQuoteRequest(row: QuoteRequestRow): QuoteRequest {
  return {
    id: row.id,
    pedidoId: row.pedidoId,
    supplierId: row.supplierId,
    plazoAt: dateFromRow(row.plazoAt),
    estado: row.estado,
  };
}

function mapQuoteResponse(row: QuoteResponseRow): QuoteResponse {
  return {
    id: row.id,
    quoteRequestId: row.quoteRequestId,
    recibidoAt: dateFromRow(row.recibidoAt),
    fuente: row.fuente,
    condiciones: row.condiciones,
    plazoEntrega: row.plazoEntrega,
    confianzaExtraccion: Number(row.confianzaExtraccion),
    estado: row.estado,
    intentosRepregunta: row.intentosRepregunta,
  };
}

function mapQuoteItem(row: QuoteItemRow): QuoteItem {
  return {
    id: row.id,
    quoteResponseId: row.quoteResponseId,
    pedidoItemId: row.pedidoItemId,
    precioUnitario: row.precioUnitario === null ? null : Number(row.precioUnitario),
    cantidad: row.cantidad === null ? null : Number(row.cantidad),
    disponible: row.disponible,
    notas: row.notas,
  };
}

function mapComparativoCotizacion(row: ComparativoCotizacionRow): ComparativoCotizacionFila {
  return {
    pedidoItemId: row.pedidoItemId,
    descripcion: row.descripcion,
    cantidadSolicitada: Number(row.cantidadSolicitada),
    unidad: row.unidad,
    supplierId: row.supplierId,
    proveedor: row.proveedor,
    quoteRequestId: row.quoteRequestId,
    quoteRequestEstado: row.quoteRequestEstado,
    quoteResponseId: row.quoteResponseId,
    precioUnitario: row.precioUnitario === null ? null : Number(row.precioUnitario),
    cantidadCotizada: row.cantidadCotizada === null ? null : Number(row.cantidadCotizada),
    disponible: row.disponible,
    condiciones: row.condiciones,
    plazoEntrega: row.plazoEntrega,
    subtotal: row.subtotal === null ? null : Number(row.subtotal),
    faltante: row.faltante,
    notas: row.notas,
  };
}

function mapReviewQueue(row: ReviewQueueRow): ReviewQueueEntry {
  return {
    id: row.id,
    tipo: row.tipo,
    entidad: row.entidad,
    entidadId: row.entidadId,
    pedidoId: row.pedidoId,
  };
}

function numberConfig(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class PgProyectoRepo implements ProyectoRepo {
  constructor(private readonly tx: Tx) {}

  async activoPorId(projectId: string): Promise<Proyecto | null> {
    const result = await this.tx.query<ProyectoRow>(
      'SELECT id, nombre, codigo, activo FROM projects WHERE id = $1 AND activo IS TRUE',
      [projectId],
    );
    return result.rows[0] ?? null;
  }

  async porId(projectId: string): Promise<Proyecto | null> {
    const result = await this.tx.query<ProyectoRow>(
      'SELECT id, nombre, codigo, activo FROM projects WHERE id = $1',
      [projectId],
    );
    return result.rows[0] ?? null;
  }
}

export class PgPedidoRepo implements PedidoRepo {
  constructor(private readonly tx: Tx) {}

  async siguienteNumeroPedido(ahora: Date): Promise<string> {
    const anio = ahora.getFullYear();
    const result = await this.tx.query<{ numero: string }>(
      "SELECT siguiente_numero('PED', $1) AS numero",
      [anio],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('siguiente_numero no devolvio numero de pedido.');
    }
    return row.numero;
  }

  async crear(input: NuevoPedido): Promise<Pedido> {
    const result = await this.tx.query<PedidoRow>(
      'INSERT INTO pedidos ' +
        '(numero, project_id, solicitante_user_id, estado, fecha_requerida, urgencia) ' +
        "VALUES ($1, $2, $3, 'borrador', $4::date, $5) " +
        'RETURNING id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt"',
      [
        input.numero,
        input.projectId,
        input.solicitanteUserId,
        input.fechaRequerida,
        input.urgencia,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear el pedido.');
    return mapPedido(row);
  }

  async porId(pedidoId: string): Promise<Pedido | null> {
    const result = await this.tx.query<PedidoRow>(
      'SELECT id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt" ' +
        'FROM pedidos WHERE id = $1',
      [pedidoId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPedido(row);
  }

  async bloquearPorId(pedidoId: string): Promise<Pedido | null> {
    const result = await this.tx.query<PedidoRow>(
      'SELECT id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt" ' +
        'FROM pedidos WHERE id = $1 FOR UPDATE',
      [pedidoId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPedido(row);
  }

  async confirmar(
    pedidoId: string,
    confirmadoAt: Date,
    confirmadoPor: string,
  ): Promise<Pedido> {
    const result = await this.tx.query<PedidoRow>(
      'UPDATE pedidos SET confirmado_at = $2, confirmado_por = $3 ' +
        'WHERE id = $1 ' +
        'RETURNING id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt"',
      [pedidoId, confirmadoAt, confirmadoPor],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Pedido no encontrado al confirmar: ${pedidoId}.`);
    return mapPedido(row);
  }

  async marcarCotizando(pedidoId: string, plazoCotizacionAt: Date): Promise<Pedido> {
    const result = await this.tx.query<PedidoRow>(
      "UPDATE pedidos SET estado = 'cotizando', plazo_cotizacion_at = $2 " +
        'WHERE id = $1 ' +
        'RETURNING id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt"',
      [pedidoId, plazoCotizacionAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Pedido no encontrado al marcar cotizando: ${pedidoId}.`);
    return mapPedido(row);
  }

  async marcarEnRevision(pedidoId: string): Promise<Pedido> {
    const result = await this.tx.query<PedidoRow>(
      "UPDATE pedidos SET estado = 'en_revision' " +
        'WHERE id = $1 ' +
        'RETURNING id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt"',
      [pedidoId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Pedido no encontrado al marcar en_revision: ${pedidoId}.`);
    return mapPedido(row);
  }
}

export class PgPedidoItemRepo implements PedidoItemRepo {
  constructor(private readonly tx: Tx) {}

  async insertarMuchos(
    pedidoId: string,
    items: readonly ItemPedidoInput[],
  ): Promise<readonly PedidoItem[]> {
    const insertados: PedidoItem[] = [];
    for (const item of items) {
      const result = await this.tx.query<PedidoItemRow>(
        'INSERT INTO pedido_items (pedido_id, descripcion, cantidad, unidad) ' +
          'VALUES ($1, $2, $3, $4) ' +
          'RETURNING id, pedido_id AS "pedidoId", descripcion, cantidad::float8 AS cantidad, unidad',
        [pedidoId, item.descripcion, item.cantidad, item.unidad],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('No se pudo insertar item de pedido.');
      insertados.push(mapItem(row));
    }
    return insertados;
  }

  async porPedido(pedidoId: string): Promise<readonly PedidoItem[]> {
    const result = await this.tx.query<PedidoItemRow>(
      'SELECT id, pedido_id AS "pedidoId", descripcion, cantidad::float8 AS cantidad, unidad ' +
        'FROM pedido_items WHERE pedido_id = $1 ORDER BY created_at, id',
      [pedidoId],
    );
    return result.rows.map(mapItem);
  }
}

export class PgUsuarioRepo implements UsuarioRepo {
  constructor(private readonly tx: Tx) {}

  async porTelefono(phone: string): Promise<Actor | null> {
    const result = await this.tx.query<UsuarioRow>(
      'SELECT u.id AS "userId", u.nombre, u.telefono_whatsapp AS "telefonoWhatsapp", ' +
        "COALESCE(array_agg(DISTINCT r.clave) FILTER (WHERE r.clave IS NOT NULL), '{}') AS roles " +
        'FROM users u ' +
        'LEFT JOIN user_roles ur ON ur.user_id = u.id ' +
        'LEFT JOIN roles r ON r.id = ur.role_id ' +
        'WHERE u.telefono_whatsapp = $1 AND u.activo IS TRUE ' +
        'GROUP BY u.id',
      [phone],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapActor(row);
  }

  async activosPorRol(role: Rol): Promise<readonly UsuarioInterno[]> {
    const result = await this.tx.query<UsuarioRow>(
      'SELECT u.id AS "userId", u.nombre, u.telefono_whatsapp AS "telefonoWhatsapp", ' +
        "COALESCE(array_agg(DISTINCT r_all.clave) FILTER (WHERE r_all.clave IS NOT NULL), '{}') AS roles " +
        'FROM users u ' +
        'JOIN user_roles ur_req ON ur_req.user_id = u.id ' +
        'JOIN roles r_req ON r_req.id = ur_req.role_id AND r_req.clave = $1 ' +
        'LEFT JOIN user_roles ur_all ON ur_all.user_id = u.id ' +
        'LEFT JOIN roles r_all ON r_all.id = ur_all.role_id ' +
        'WHERE u.activo IS TRUE AND u.telefono_whatsapp IS NOT NULL ' +
        'GROUP BY u.id ' +
        'ORDER BY u.nombre',
      [role],
    );
    return result.rows
      .map(mapUsuarioInterno)
      .filter((usuario): usuario is UsuarioInterno => usuario !== null);
  }
}

export class PgProveedorRepo implements ProveedorRepo {
  constructor(private readonly tx: Tx) {}

  async activosConContactoOptIn(): Promise<readonly Proveedor[]> {
    const result = await this.tx.query<ProveedorRow>(
      'SELECT s.id, s.nombre, s.categorias, s.activo, ' +
        'sc.id AS "contactoId", sc.nombre AS "contactoNombre", ' +
        'sc.telefono_whatsapp AS "contactoTelefono", sc.optin_at AS "contactoOptinAt", ' +
        'sc.es_principal AS "contactoEsPrincipal" ' +
        'FROM suppliers s ' +
        'JOIN LATERAL ( ' +
        'SELECT id, nombre, telefono_whatsapp, optin_at, es_principal ' +
        'FROM supplier_contacts ' +
        'WHERE supplier_id = s.id AND optin_at IS NOT NULL ' +
        'ORDER BY es_principal DESC, created_at ASC, id ASC LIMIT 1 ' +
        ') sc ON true ' +
        'WHERE s.activo IS TRUE ' +
        'ORDER BY s.nombre',
    );
    return result.rows.map(mapProveedor);
  }

  async porIdsConContactoOptIn(supplierIds: readonly string[]): Promise<readonly Proveedor[]> {
    if (supplierIds.length === 0) return [];
    const result = await this.tx.query<ProveedorRow>(
      'SELECT s.id, s.nombre, s.categorias, s.activo, ' +
        'sc.id AS "contactoId", sc.nombre AS "contactoNombre", ' +
        'sc.telefono_whatsapp AS "contactoTelefono", sc.optin_at AS "contactoOptinAt", ' +
        'sc.es_principal AS "contactoEsPrincipal" ' +
        'FROM suppliers s ' +
        'JOIN LATERAL ( ' +
        'SELECT id, nombre, telefono_whatsapp, optin_at, es_principal ' +
        'FROM supplier_contacts ' +
        'WHERE supplier_id = s.id AND optin_at IS NOT NULL ' +
        'ORDER BY es_principal DESC, created_at ASC, id ASC LIMIT 1 ' +
        ') sc ON true ' +
        'WHERE s.activo IS TRUE AND s.id = ANY($1::uuid[]) ' +
        'ORDER BY array_position($1::uuid[], s.id)',
      [supplierIds],
    );
    return result.rows.map(mapProveedor);
  }
}

export class PgQuoteRequestRepo implements QuoteRequestRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevoQuoteRequest): Promise<QuoteRequest> {
    const result = await this.tx.query<QuoteRequestRow>(
      'INSERT INTO quote_requests (pedido_id, supplier_id, plazo_at) ' +
        'VALUES ($1, $2, $3) ' +
        'RETURNING id, pedido_id AS "pedidoId", supplier_id AS "supplierId", ' +
        'plazo_at AS "plazoAt", estado',
      [input.pedidoId, input.supplierId, input.plazoAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear quote_request.');
    return mapQuoteRequest(row);
  }

  async bloquearPorId(quoteRequestId: string): Promise<QuoteRequest | null> {
    const result = await this.tx.query<QuoteRequestRow>(
      'SELECT id, pedido_id AS "pedidoId", supplier_id AS "supplierId", ' +
        'plazo_at AS "plazoAt", estado ' +
        'FROM quote_requests WHERE id = $1 FOR UPDATE',
      [quoteRequestId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapQuoteRequest(row);
  }

  async marcarRespondida(quoteRequestId: string): Promise<QuoteRequest> {
    const result = await this.tx.query<QuoteRequestRow>(
      "UPDATE quote_requests SET estado = 'respondida', enviado_at = COALESCE(enviado_at, now()) " +
        'WHERE id = $1 ' +
        'RETURNING id, pedido_id AS "pedidoId", supplier_id AS "supplierId", ' +
        'plazo_at AS "plazoAt", estado',
      [quoteRequestId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Quote request no encontrado: ${quoteRequestId}.`);
    return mapQuoteRequest(row);
  }

  async contarPendientesPorPedido(pedidoId: string): Promise<number> {
    const result = await this.tx.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM quote_requests WHERE pedido_id = $1 AND estado = 'enviada'",
      [pedidoId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}

export class PgQuoteResponseRepo implements QuoteResponseRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevoQuoteResponse): Promise<QuoteResponse> {
    const result = await this.tx.query<QuoteResponseRow>(
      'INSERT INTO quote_responses ' +
        '(quote_request_id, recibido_at, fuente, condiciones, plazo_entrega, ' +
        'confianza_extraccion, estado, intentos_repregunta) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ' +
        'RETURNING id, quote_request_id AS "quoteRequestId", recibido_at AS "recibidoAt", ' +
        'fuente, condiciones, plazo_entrega AS "plazoEntrega", ' +
        'confianza_extraccion AS "confianzaExtraccion", estado, ' +
        'intentos_repregunta AS "intentosRepregunta"',
      [
        input.quoteRequestId,
        input.recibidoAt,
        input.fuente,
        input.condiciones,
        input.plazoEntrega,
        input.confianzaExtraccion,
        input.estado,
        input.intentosRepregunta,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear quote_response.');
    return mapQuoteResponse(row);
  }

  async insertarItems(
    quoteResponseId: string,
    items: readonly QuoteItemInput[],
  ): Promise<readonly QuoteItem[]> {
    const insertados: QuoteItem[] = [];
    for (const item of items) {
      const result = await this.tx.query<QuoteItemRow>(
        'INSERT INTO quote_items ' +
          '(quote_response_id, pedido_item_id, precio_unitario, cantidad, disponible, notas) ' +
          'VALUES ($1, $2, $3, $4, $5, $6) ' +
          'RETURNING id, quote_response_id AS "quoteResponseId", ' +
          'pedido_item_id AS "pedidoItemId", precio_unitario AS "precioUnitario", ' +
          'cantidad, disponible, notas',
        [
          quoteResponseId,
          item.pedidoItemId,
          item.precioUnitario,
          item.cantidad,
          item.disponible,
          item.notas,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('No se pudo insertar quote_item.');
      insertados.push(mapQuoteItem(row));
    }
    return insertados;
  }

  async contarIncompletas(quoteRequestId: string): Promise<number> {
    const result = await this.tx.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM quote_responses WHERE quote_request_id = $1 AND estado = 'incompleta'",
      [quoteRequestId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}

export class PgComparativoRepo implements ComparativoRepo {
  constructor(private readonly tx: Tx) {}

  async porPedido(pedidoId: string): Promise<readonly ComparativoCotizacionFila[]> {
    const result = await this.tx.query<ComparativoCotizacionRow>(
      'WITH rfqs AS ( ' +
        'SELECT qr.id, qr.pedido_id, qr.supplier_id, qr.estado, s.nombre AS proveedor, ' +
        'qres.id AS quote_response_id, qres.condiciones, qres.plazo_entrega ' +
        'FROM quote_requests qr ' +
        'JOIN suppliers s ON s.id = qr.supplier_id ' +
        'LEFT JOIN LATERAL ( ' +
        'SELECT id, condiciones, plazo_entrega ' +
        'FROM quote_responses ' +
        "WHERE quote_request_id = qr.id AND estado = 'completa' " +
        'ORDER BY recibido_at DESC NULLS LAST, created_at DESC, id DESC ' +
        'LIMIT 1 ' +
        ') qres ON true ' +
        'WHERE qr.pedido_id = $1 ' +
        ') ' +
        'SELECT pi.id AS "pedidoItemId", pi.descripcion, ' +
        'pi.cantidad::float8 AS "cantidadSolicitada", COALESCE(pi.unidad, \'\') AS unidad, ' +
        'rfqs.supplier_id AS "supplierId", rfqs.proveedor, ' +
        'rfqs.id AS "quoteRequestId", rfqs.estado AS "quoteRequestEstado", ' +
        'rfqs.quote_response_id AS "quoteResponseId", ' +
        'qi.precio_unitario::float8 AS "precioUnitario", ' +
        'qi.cantidad::float8 AS "cantidadCotizada", qi.disponible, ' +
        'rfqs.condiciones, rfqs.plazo_entrega AS "plazoEntrega", ' +
        'CASE WHEN qi.precio_unitario IS NULL OR qi.cantidad IS NULL OR qi.disponible IS FALSE ' +
        'THEN NULL ELSE (qi.precio_unitario * qi.cantidad)::float8 END AS subtotal, ' +
        '(rfqs.quote_response_id IS NULL OR qi.id IS NULL OR qi.precio_unitario IS NULL ' +
        'OR qi.cantidad IS NULL OR qi.cantidad < pi.cantidad OR qi.disponible IS FALSE) AS faltante, ' +
        'qi.notas ' +
        'FROM pedido_items pi ' +
        'JOIN rfqs ON rfqs.pedido_id = pi.pedido_id ' +
        'LEFT JOIN LATERAL ( ' +
        'SELECT id, precio_unitario, cantidad, disponible, notas ' +
        'FROM quote_items ' +
        'WHERE quote_response_id = rfqs.quote_response_id AND pedido_item_id = pi.id ' +
        'ORDER BY created_at ASC, id ASC ' +
        'LIMIT 1 ' +
        ') qi ON true ' +
        'WHERE pi.pedido_id = $1 ' +
        'ORDER BY pi.created_at ASC, pi.id ASC, rfqs.proveedor ASC, rfqs.id ASC',
      [pedidoId],
    );
    return result.rows.map(mapComparativoCotizacion);
  }
}

export class PgReviewQueueRepo implements ReviewQueueRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevoReviewQueueEntry): Promise<ReviewQueueEntry> {
    const result = await this.tx.query<ReviewQueueRow>(
      'INSERT INTO review_queue (tipo, entidad, entidad_id, pedido_id, detalle) ' +
        'VALUES ($1, $2, $3, $4, $5::jsonb) ' +
        'RETURNING id, tipo, entidad, entidad_id AS "entidadId", pedido_id AS "pedidoId"',
      [
        input.tipo,
        input.entidad,
        input.entidadId,
        input.pedidoId,
        JSON.stringify(input.detalle ?? null),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear review_queue.');
    return mapReviewQueue(row);
  }
}

export class PgConfigRepo implements ConfigRepo {
  constructor(private readonly tx: Tx) {}

  async umbrales(): Promise<UmbralesConfig> {
    const result = await this.tx.query<ConfigRow>(
      'SELECT clave, valor FROM config WHERE clave = ANY($1::text[])',
      [[
        'confianza_min_cotizacion',
        'max_repreguntas_proveedor',
        'confianza_min_factura',
        'dif_monto_rel_max',
        'dif_monto_abs_min_crc',
        'dif_cantidad_menor',
        'plazo_cotizacion_horas_default',
        'horas_atasco_en_revision',
        'horas_atasco_aprobado',
      ]],
    );
    const byKey = new Map(result.rows.map((row) => [row.clave, row.valor]));
    return {
      confianzaMinCotizacion: numberConfig(
        byKey.get('confianza_min_cotizacion'),
        UMBRALES_DEFAULT.confianzaMinCotizacion,
      ),
      maxRepreguntasProveedor: numberConfig(
        byKey.get('max_repreguntas_proveedor'),
        UMBRALES_DEFAULT.maxRepreguntasProveedor,
      ),
      confianzaMinFactura: numberConfig(
        byKey.get('confianza_min_factura'),
        UMBRALES_DEFAULT.confianzaMinFactura,
      ),
      difMontoRelMax: numberConfig(
        byKey.get('dif_monto_rel_max'),
        UMBRALES_DEFAULT.difMontoRelMax,
      ),
      difMontoAbsMinCRC: numberConfig(
        byKey.get('dif_monto_abs_min_crc'),
        UMBRALES_DEFAULT.difMontoAbsMinCRC,
      ),
      difCantidadMenor: numberConfig(
        byKey.get('dif_cantidad_menor'),
        UMBRALES_DEFAULT.difCantidadMenor,
      ),
      plazoCotizacionHorasDefault: numberConfig(
        byKey.get('plazo_cotizacion_horas_default'),
        UMBRALES_DEFAULT.plazoCotizacionHorasDefault,
      ),
      horasAtascoEnRevision: numberConfig(
        byKey.get('horas_atasco_en_revision'),
        UMBRALES_DEFAULT.horasAtascoEnRevision,
      ),
      horasAtascoAprobado: numberConfig(
        byKey.get('horas_atasco_aprobado'),
        UMBRALES_DEFAULT.horasAtascoAprobado,
      ),
    };
  }
}

export function crearReposPg(tx: Tx): Repos {
  return {
    proyectos: new PgProyectoRepo(tx),
    pedidos: new PgPedidoRepo(tx),
    pedidoItems: new PgPedidoItemRepo(tx),
    usuarios: new PgUsuarioRepo(tx),
    proveedores: new PgProveedorRepo(tx),
    quoteRequests: new PgQuoteRequestRepo(tx),
    quoteResponses: new PgQuoteResponseRepo(tx),
    comparativos: new PgComparativoRepo(tx),
    reviewQueue: new PgReviewQueueRepo(tx),
    config: new PgConfigRepo(tx),
  };
}
