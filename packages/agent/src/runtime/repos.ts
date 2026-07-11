import { randomUUID } from 'node:crypto';

import { puedeTransicionarOc, UMBRALES_DEFAULT } from '@proveeduria/core';
import type {
  EstadoFactura,
  EstadoOC,
  ItemCobertura,
  OcParaCobertura,
  Rol,
  UmbralesConfig,
} from '@proveeduria/core';
import { parseAsignacionesGanador } from './approval-ganador.js';
import type {
  Actor,
  Attachment,
  AttachmentRepo,
  ApprovalGanador,
  ApprovalRepo,
  CantidadesConfirmadas,
  ComparativoCotizacionFila,
  ComparativoRepo,
  ConfigRepo,
  CoberturaRepo,
  CreditNote,
  CreditNoteRepo,
  DashboardLink,
  DashboardLinkRepo,
  DiferenciasDetectadas,
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
  readonly cedulaJuridica: string | null;
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
  readonly estado: ReviewQueueEntry['estado'];
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
    cedulaJuridica: row.cedulaJuridica,
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
    estado: row.estado,
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

  async listarActivos(): Promise<readonly Proyecto[]> {
    const result = await this.tx.query<ProyectoRow>(
      'SELECT id, nombre, codigo, activo FROM projects WHERE activo IS TRUE ORDER BY nombre',
    );
    return result.rows;
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

  async marcarAprobado(pedidoId: string): Promise<Pedido> {
    const result = await this.tx.query<PedidoRow>(
      "UPDATE pedidos SET estado = 'aprobado' " +
        'WHERE id = $1 ' +
        'RETURNING id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt"',
      [pedidoId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Pedido no encontrado al marcar aprobado: ${pedidoId}.`);
    return mapPedido(row);
  }

  async marcarOrdenado(pedidoId: string): Promise<Pedido> {
    const result = await this.tx.query<PedidoRow>(
      "UPDATE pedidos SET estado = 'ordenado' " +
        'WHERE id = $1 ' +
        'RETURNING id, numero, project_id AS "projectId", ' +
        'solicitante_user_id AS "solicitanteUserId", estado, ' +
        'fecha_requerida::text AS "fechaRequerida", urgencia, ' +
        'confirmado_at AS "confirmadoAt", confirmado_por AS "confirmadoPor", ' +
        'plazo_cotizacion_at AS "plazoCotizacionAt"',
      [pedidoId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Pedido no encontrado al marcar ordenado: ${pedidoId}.`);
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
      'SELECT s.id, s.nombre, s.cedula_juridica AS "cedulaJuridica", s.categorias, s.activo, ' +
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
      'SELECT s.id, s.nombre, s.cedula_juridica AS "cedulaJuridica", s.categorias, s.activo, ' +
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

  async marcarVencidas(ahora: Date): Promise<readonly QuoteRequest[]> {
    const result = await this.tx.query<QuoteRequestRow>(
      "UPDATE quote_requests SET estado = 'vencida' " +
        "WHERE estado = 'enviada' AND plazo_at <= $1 " +
        'RETURNING id, pedido_id AS "pedidoId", supplier_id AS "supplierId", ' +
        'plazo_at AS "plazoAt", estado',
      [ahora],
    );
    return result.rows.map(mapQuoteRequest);
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

  async porId(quoteResponseId: string): Promise<QuoteResponse | null> {
    const result = await this.tx.query<QuoteResponseRow>(
      'SELECT id, quote_request_id AS "quoteRequestId", recibido_at AS "recibidoAt", ' +
        'fuente, condiciones, plazo_entrega AS "plazoEntrega", ' +
        'confianza_extraccion AS "confianzaExtraccion", estado, ' +
        'intentos_repregunta AS "intentosRepregunta" ' +
        'FROM quote_responses WHERE id = $1',
      [quoteResponseId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapQuoteResponse(row);
  }

  async itemsPorQuoteResponse(quoteResponseId: string): Promise<readonly QuoteItem[]> {
    const result = await this.tx.query<QuoteItemRow>(
      'SELECT id, quote_response_id AS "quoteResponseId", ' +
        'pedido_item_id AS "pedidoItemId", precio_unitario AS "precioUnitario", ' +
        'cantidad, disponible, notas ' +
        'FROM quote_items WHERE quote_response_id = $1 ORDER BY created_at, id',
      [quoteResponseId],
    );
    return result.rows.map(mapQuoteItem);
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
        'RETURNING id, tipo, entidad, entidad_id AS "entidadId", pedido_id AS "pedidoId", estado',
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

  async abiertasPorPedido(pedidoId: string): Promise<readonly ReviewQueueEntry[]> {
    const result = await this.tx.query<ReviewQueueRow>(
      'SELECT id, tipo, entidad, entidad_id AS "entidadId", pedido_id AS "pedidoId", estado ' +
        "FROM review_queue WHERE pedido_id = $1 AND estado = 'pendiente' " +
        'ORDER BY created_at, id',
      [pedidoId],
    );
    return result.rows.map(mapReviewQueue);
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
        'umbral_similitud_factura_oc',
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
      // E3 (exceptions.md): clave sembrada en la migracion 008.
      similitudMinFacturaOc: numberConfig(
        byKey.get('umbral_similitud_factura_oc'),
        UMBRALES_DEFAULT.similitudMinFacturaOc,
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Compra y recepcion (Fase 2b, B2). Ver docstrings de contrato en types.ts.
// ---------------------------------------------------------------------------

interface OcRow {
  readonly id: string;
  readonly numero: string;
  readonly pedidoId: string;
  readonly supplierId: string;
  readonly estado: EstadoOC;
  readonly montoTotal: number | string;
  readonly confirmadaPorProveedorAt: Date | string | null;
  readonly pdfAttachmentId: string | null;
}

interface OcItemRow {
  readonly id: string;
  readonly ocId: string;
  readonly pedidoItemId: string | null;
  readonly cantidad: number | string;
  readonly precioUnitario: number | string;
}

const OC_SELECT_COLUMNAS =
  'id, numero, pedido_id AS "pedidoId", supplier_id AS "supplierId", estado, ' +
  'monto_total::float8 AS "montoTotal", ' +
  'confirmada_por_proveedor_at AS "confirmadaPorProveedorAt", ' +
  'pdf_attachment_id AS "pdfAttachmentId"';

const OC_ITEM_SELECT_COLUMNAS =
  'id, po_id AS "ocId", pedido_item_id AS "pedidoItemId", ' +
  'cantidad::float8 AS cantidad, precio_unitario::float8 AS "precioUnitario"';

function mapOc(row: OcRow): Oc {
  return {
    id: row.id,
    numero: row.numero,
    pedidoId: row.pedidoId,
    supplierId: row.supplierId,
    estado: row.estado,
    montoTotal: Number(row.montoTotal),
    confirmadaPorProveedorAt:
      row.confirmadaPorProveedorAt === null ? null : dateFromRow(row.confirmadaPorProveedorAt),
    pdfAttachmentId: row.pdfAttachmentId,
  };
}

function mapOcItem(row: OcItemRow): OcItem {
  return {
    id: row.id,
    ocId: row.ocId,
    pedidoItemId: row.pedidoItemId,
    cantidad: Number(row.cantidad),
    precioUnitario: Number(row.precioUnitario),
  };
}

export class PgOcRepo implements OcRepo {
  constructor(private readonly tx: Tx) {}

  async siguienteNumeroOc(ahora: Date): Promise<string> {
    const anio = ahora.getFullYear();
    const result = await this.tx.query<{ numero: string }>(
      "SELECT siguiente_numero('OC', $1) AS numero",
      [anio],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('siguiente_numero no devolvio numero de OC.');
    }
    return row.numero;
  }

  async crear(input: NuevaOc): Promise<OcConItems> {
    const result = await this.tx.query<OcRow>(
      'INSERT INTO purchase_orders (numero, pedido_id, supplier_id, monto_total) ' +
        'VALUES ($1, $2, $3, $4) ' +
        `RETURNING ${OC_SELECT_COLUMNAS}`,
      [input.numero, input.pedidoId, input.supplierId, input.montoTotal],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear la OC.');
    const oc = mapOc(row);

    const items: OcItem[] = [];
    for (const item of input.items) {
      const itemResult = await this.tx.query<OcItemRow>(
        'INSERT INTO po_items (po_id, pedido_item_id, cantidad, precio_unitario) ' +
          'VALUES ($1, $2, $3, $4) ' +
          `RETURNING ${OC_ITEM_SELECT_COLUMNAS}`,
        [oc.id, item.pedidoItemId, item.cantidad, item.precioUnitario],
      );
      const itemRow = itemResult.rows[0];
      if (itemRow === undefined) throw new Error('No se pudo insertar item de OC.');
      items.push(mapOcItem(itemRow));
    }

    return { oc, items };
  }

  async porId(ocId: string): Promise<Oc | null> {
    const result = await this.tx.query<OcRow>(
      `SELECT ${OC_SELECT_COLUMNAS} FROM purchase_orders WHERE id = $1`,
      [ocId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapOc(row);
  }

  async porPedido(pedidoId: string): Promise<readonly Oc[]> {
    const result = await this.tx.query<OcRow>(
      `SELECT ${OC_SELECT_COLUMNAS} FROM purchase_orders WHERE pedido_id = $1 ` +
        'ORDER BY created_at, id',
      [pedidoId],
    );
    return result.rows.map(mapOc);
  }

  async itemsPorOc(ocId: string): Promise<readonly OcItem[]> {
    const result = await this.tx.query<OcItemRow>(
      `SELECT ${OC_ITEM_SELECT_COLUMNAS} FROM po_items WHERE po_id = $1 ` +
        'ORDER BY created_at, id',
      [ocId],
    );
    return result.rows.map(mapOcItem);
  }

  async actualizarEstado(ocId: string, estado: EstadoOC): Promise<Oc> {
    const actual = await this.tx.query<OcRow>(
      `SELECT ${OC_SELECT_COLUMNAS} FROM purchase_orders WHERE id = $1 FOR UPDATE`,
      [ocId],
    );
    const actualRow = actual.rows[0];
    if (actualRow === undefined) throw new Error(`OC no encontrada: ${ocId}.`);
    const ocActual = mapOc(actualRow);

    // Primera barrera (state-machine.md §Ciclo de la OC); el trigger de la migracion 009 es
    // la segunda barrera sobre el UPDATE en si.
    const transicion = puedeTransicionarOc(ocActual.estado, estado);
    if (!transicion.ok) throw new Error(transicion.error.mensaje);

    const result = await this.tx.query<OcRow>(
      `UPDATE purchase_orders SET estado = $2 WHERE id = $1 RETURNING ${OC_SELECT_COLUMNAS}`,
      [ocId, estado],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`No se pudo actualizar el estado de la OC: ${ocId}.`);
    return mapOc(row);
  }

  async fijarPdfAttachment(ocId: string, attachmentId: string): Promise<Oc> {
    const result = await this.tx.query<OcRow>(
      'UPDATE purchase_orders SET pdf_attachment_id = $2 WHERE id = $1 ' +
        `RETURNING ${OC_SELECT_COLUMNAS}`,
      [ocId, attachmentId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`OC no encontrada al fijar PDF: ${ocId}.`);
    return mapOc(row);
  }

  async fijarConfirmadaProveedor(ocId: string, at: Date): Promise<Oc> {
    const result = await this.tx.query<OcRow>(
      'UPDATE purchase_orders SET confirmada_por_proveedor_at = $2 WHERE id = $1 ' +
        `RETURNING ${OC_SELECT_COLUMNAS}`,
      [ocId, at],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`OC no encontrada al fijar confirmacion: ${ocId}.`);
    return mapOc(row);
  }
}

interface InvoiceRow {
  readonly id: string;
  readonly numeroFactura: string | null;
  readonly supplierId: string;
  readonly projectId: string | null;
  readonly fecha: string | null;
  readonly montoTotal: number | string;
  readonly moneda: string;
  readonly fuenteAttachmentId: string | null;
  readonly confianzaExtraccion: number | string | null;
  readonly estado: Invoice['estado'];
  readonly registradaPor: string | null;
}

interface InvoiceItemRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly descripcion: string;
  readonly cantidad: number | string | null;
  readonly precioUnitario: number | string | null;
}

const INVOICE_SELECT_COLUMNAS =
  'id, numero_factura AS "numeroFactura", supplier_id AS "supplierId", ' +
  'project_id AS "projectId", fecha::text AS fecha, monto_total::float8 AS "montoTotal", ' +
  'moneda, fuente_attachment_id AS "fuenteAttachmentId", ' +
  'confianza_extraccion::float8 AS "confianzaExtraccion", estado, ' +
  'registrada_por AS "registradaPor"';

const INVOICE_ITEM_SELECT_COLUMNAS =
  'id, invoice_id AS "invoiceId", descripcion, cantidad::float8 AS cantidad, ' +
  'precio_unitario::float8 AS "precioUnitario"';

function mapInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    numeroFactura: row.numeroFactura,
    supplierId: row.supplierId,
    projectId: row.projectId,
    fecha: row.fecha,
    montoTotal: Number(row.montoTotal),
    moneda: row.moneda,
    fuenteAttachmentId: row.fuenteAttachmentId,
    confianzaExtraccion:
      row.confianzaExtraccion === null ? null : Number(row.confianzaExtraccion),
    estado: row.estado,
    registradaPor: row.registradaPor,
  };
}

function mapInvoiceItem(row: InvoiceItemRow): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    descripcion: row.descripcion,
    cantidad: row.cantidad === null ? null : Number(row.cantidad),
    precioUnitario: row.precioUnitario === null ? null : Number(row.precioUnitario),
  };
}

export class PgInvoiceRepo implements InvoiceRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevaInvoice): Promise<InvoiceConItems> {
    const result = await this.tx.query<InvoiceRow>(
      'INSERT INTO invoices ' +
        '(numero_factura, supplier_id, project_id, fecha, monto_total, moneda, ' +
        'fuente_attachment_id, confianza_extraccion, registrada_por) ' +
        'VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9) ' +
        `RETURNING ${INVOICE_SELECT_COLUMNAS}`,
      [
        input.numeroFactura,
        input.supplierId,
        input.projectId,
        input.fecha,
        input.montoTotal,
        input.moneda ?? 'CRC',
        input.fuenteAttachmentId,
        input.confianzaExtraccion,
        input.registradaPor,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear la factura.');
    const invoice = mapInvoice(row);

    const items: InvoiceItem[] = [];
    for (const item of input.items) {
      const itemResult = await this.tx.query<InvoiceItemRow>(
        'INSERT INTO invoice_items (invoice_id, descripcion, cantidad, precio_unitario) ' +
          'VALUES ($1, $2, $3, $4) ' +
          `RETURNING ${INVOICE_ITEM_SELECT_COLUMNAS}`,
        [invoice.id, item.descripcion, item.cantidad, item.precioUnitario],
      );
      const itemRow = itemResult.rows[0];
      if (itemRow === undefined) throw new Error('No se pudo insertar item de factura.');
      items.push(mapInvoiceItem(itemRow));
    }

    return { invoice, items };
  }

  async porId(invoiceId: string): Promise<Invoice | null> {
    const result = await this.tx.query<InvoiceRow>(
      `SELECT ${INVOICE_SELECT_COLUMNAS} FROM invoices WHERE id = $1`,
      [invoiceId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapInvoice(row);
  }

  async abiertasPorProveedorYProyecto(
    supplierId: string,
    projectId: string,
  ): Promise<readonly Invoice[]> {
    const result = await this.tx.query<InvoiceRow>(
      `SELECT ${INVOICE_SELECT_COLUMNAS} FROM invoices ` +
        "WHERE supplier_id = $1 AND project_id = $2 AND estado = 'pendiente_revision' " +
        'ORDER BY created_at, id',
      [supplierId, projectId],
    );
    return result.rows.map(mapInvoice);
  }

  async actualizarEstado(invoiceId: string, estado: EstadoFactura): Promise<Invoice> {
    const result = await this.tx.query<InvoiceRow>(
      `UPDATE invoices SET estado = $2 WHERE id = $1 RETURNING ${INVOICE_SELECT_COLUMNAS}`,
      [invoiceId, estado],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Factura no encontrada: ${invoiceId}.`);
    return mapInvoice(row);
  }

  async itemsPorInvoice(invoiceId: string): Promise<readonly InvoiceItem[]> {
    const result = await this.tx.query<InvoiceItemRow>(
      `SELECT ${INVOICE_ITEM_SELECT_COLUMNAS} FROM invoice_items WHERE invoice_id = $1 ` +
        'ORDER BY created_at, id',
      [invoiceId],
    );
    return result.rows.map(mapInvoiceItem);
  }
}

interface InvoicePoLinkRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly ocId: string;
  readonly montoAsignado: number | string;
}

function mapInvoicePoLink(row: InvoicePoLinkRow): InvoicePoLink {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    ocId: row.ocId,
    montoAsignado: Number(row.montoAsignado),
  };
}

export class PgInvoicePoLinkRepo implements InvoicePoLinkRepo {
  constructor(private readonly tx: Tx) {}

  async crear(
    invoiceId: string,
    links: readonly InvoicePoLinkInput[],
  ): Promise<readonly InvoicePoLink[]> {
    const insertados: InvoicePoLink[] = [];
    for (const link of links) {
      const result = await this.tx.query<InvoicePoLinkRow>(
        'INSERT INTO invoice_po_links (invoice_id, po_id, monto_asignado) ' +
          'VALUES ($1, $2, $3) ' +
          'RETURNING id, invoice_id AS "invoiceId", po_id AS "ocId", ' +
          'monto_asignado::float8 AS "montoAsignado"',
        [invoiceId, link.ocId, link.montoAsignado],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('No se pudo crear invoice_po_link.');
      insertados.push(mapInvoicePoLink(row));
    }
    return insertados;
  }

  async porInvoice(invoiceId: string): Promise<readonly InvoicePoLink[]> {
    const result = await this.tx.query<InvoicePoLinkRow>(
      'SELECT id, invoice_id AS "invoiceId", po_id AS "ocId", ' +
        'monto_asignado::float8 AS "montoAsignado" FROM invoice_po_links ' +
        'WHERE invoice_id = $1 ORDER BY created_at, id',
      [invoiceId],
    );
    return result.rows.map(mapInvoicePoLink);
  }

  async porOc(ocId: string): Promise<readonly InvoicePoLink[]> {
    const result = await this.tx.query<InvoicePoLinkRow>(
      'SELECT id, invoice_id AS "invoiceId", po_id AS "ocId", ' +
        'monto_asignado::float8 AS "montoAsignado" FROM invoice_po_links ' +
        'WHERE po_id = $1 ORDER BY created_at, id',
      [ocId],
    );
    return result.rows.map(mapInvoicePoLink);
  }
}

interface ReceiptConfirmationRow {
  readonly id: string;
  readonly invoiceId: string;
  readonly bodegueroUserId: string | null;
  readonly cantidades: CantidadesConfirmadas | null;
  readonly diferenciasDetectadas: DiferenciasDetectadas | null;
  readonly confirmadoAt: Date | string;
}

function mapReceiptConfirmation(row: ReceiptConfirmationRow): ReceiptConfirmation {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    bodegueroUserId: row.bodegueroUserId,
    cantidades: row.cantidades ?? {},
    diferenciasDetectadas: row.diferenciasDetectadas,
    confirmadoAt: dateFromRow(row.confirmadoAt),
  };
}

export class PgReceiptConfirmationRepo implements ReceiptConfirmationRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: ReceiptConfirmationInput): Promise<ReceiptConfirmation> {
    const result = await this.tx.query<ReceiptConfirmationRow>(
      'INSERT INTO receipt_confirmations ' +
        '(invoice_id, bodeguero_user_id, cantidades, diferencias_detectadas, confirmado_at) ' +
        'VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) ' +
        'RETURNING id, invoice_id AS "invoiceId", bodeguero_user_id AS "bodegueroUserId", ' +
        'cantidades, diferencias_detectadas AS "diferenciasDetectadas", ' +
        'confirmado_at AS "confirmadoAt"',
      [
        input.invoiceId,
        input.bodegueroUserId,
        JSON.stringify(input.cantidades),
        JSON.stringify(input.diferenciasDetectadas ?? null),
        input.confirmadoAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear receipt_confirmation.');
    return mapReceiptConfirmation(row);
  }

  async porInvoice(invoiceId: string): Promise<readonly ReceiptConfirmation[]> {
    const result = await this.tx.query<ReceiptConfirmationRow>(
      'SELECT id, invoice_id AS "invoiceId", bodeguero_user_id AS "bodegueroUserId", ' +
        'cantidades, diferencias_detectadas AS "diferenciasDetectadas", ' +
        'confirmado_at AS "confirmadoAt" FROM receipt_confirmations ' +
        'WHERE invoice_id = $1 ORDER BY created_at, id',
      [invoiceId],
    );
    return result.rows.map(mapReceiptConfirmation);
  }
}

interface CreditNoteRow {
  readonly id: string;
  readonly numero: string | null;
  readonly invoiceId: string | null;
  readonly monto: number | string;
  readonly motivo: string | null;
  readonly attachmentId: string | null;
  readonly estado: CreditNote['estado'];
  readonly aplicadaPor: string | null;
  readonly aplicadaAt: Date | string | null;
}

const CREDIT_NOTE_SELECT_COLUMNAS =
  'id, numero, invoice_id AS "invoiceId", monto::float8 AS monto, motivo, ' +
  'attachment_id AS "attachmentId", estado, aplicada_por AS "aplicadaPor", ' +
  'aplicada_at AS "aplicadaAt"';

function mapCreditNote(row: CreditNoteRow): CreditNote {
  return {
    id: row.id,
    numero: row.numero,
    invoiceId: row.invoiceId,
    monto: Number(row.monto),
    motivo: row.motivo,
    attachmentId: row.attachmentId,
    estado: row.estado,
    aplicadaPor: row.aplicadaPor,
    aplicadaAt: row.aplicadaAt === null ? null : dateFromRow(row.aplicadaAt),
  };
}

export class PgCreditNoteRepo implements CreditNoteRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevaCreditNote): Promise<CreditNote> {
    const result = await this.tx.query<CreditNoteRow>(
      'INSERT INTO credit_notes (numero, invoice_id, monto, motivo, attachment_id) ' +
        'VALUES ($1, $2, $3, $4, $5) ' +
        `RETURNING ${CREDIT_NOTE_SELECT_COLUMNAS}`,
      [input.numero, input.invoiceId, input.monto, input.motivo, input.attachmentId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear la nota de credito.');
    return mapCreditNote(row);
  }

  async porId(creditNoteId: string): Promise<CreditNote | null> {
    const result = await this.tx.query<CreditNoteRow>(
      `SELECT ${CREDIT_NOTE_SELECT_COLUMNAS} FROM credit_notes WHERE id = $1`,
      [creditNoteId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapCreditNote(row);
  }

  async pendientesPorPedido(pedidoId: string): Promise<readonly CreditNote[]> {
    const result = await this.tx.query<CreditNoteRow>(
      'SELECT DISTINCT cn.id, cn.numero, cn.invoice_id AS "invoiceId", ' +
        'cn.monto::float8 AS monto, cn.motivo, cn.attachment_id AS "attachmentId", ' +
        'cn.estado, cn.aplicada_por AS "aplicadaPor", cn.aplicada_at AS "aplicadaAt" ' +
        'FROM credit_notes cn ' +
        'JOIN invoice_po_links ipl ON ipl.invoice_id = cn.invoice_id ' +
        'JOIN purchase_orders po ON po.id = ipl.po_id ' +
        "WHERE po.pedido_id = $1 AND cn.estado = 'pendiente_asociacion' " +
        'ORDER BY cn.id',
      [pedidoId],
    );
    return result.rows.map(mapCreditNote);
  }

  async aplicar(creditNoteId: string, aplicadaPor: string, aplicadaAt: Date): Promise<CreditNote> {
    const result = await this.tx.query<CreditNoteRow>(
      "UPDATE credit_notes SET estado = 'aplicada', aplicada_por = $2, aplicada_at = $3 " +
        `WHERE id = $1 RETURNING ${CREDIT_NOTE_SELECT_COLUMNAS}`,
      [creditNoteId, aplicadaPor, aplicadaAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Nota de credito no encontrada: ${creditNoteId}.`);
    return mapCreditNote(row);
  }
}

// ---------------------------------------------------------------------------
// Equipos de alquiler (Fase 2b, B2).
// ---------------------------------------------------------------------------

interface EquipmentRentalRow {
  readonly id: string;
  readonly projectId: string;
  readonly supplierId: string;
  readonly descripcionEquipo: string;
  readonly cantidadInicial: number | string;
  readonly cantidadActiva: number | string;
  readonly boletaAttachmentId: string | null;
  readonly estado: EquipmentRental['estado'];
  readonly abiertoAt: Date | string;
  readonly cerradoAt: Date | string | null;
}

interface EquipmentMovementRow {
  readonly id: string;
  readonly rentalId: string;
  readonly tipo: EquipmentMovement['tipo'];
  readonly cantidad: number | string;
  readonly boletaAttachmentId: string | null;
  readonly registradoPor: string | null;
  readonly at: Date | string;
}

const EQUIPMENT_RENTAL_SELECT_COLUMNAS =
  'id, project_id AS "projectId", supplier_id AS "supplierId", ' +
  'descripcion_equipo AS "descripcionEquipo", cantidad_inicial::float8 AS "cantidadInicial", ' +
  'cantidad_activa::float8 AS "cantidadActiva", boleta_attachment_id AS "boletaAttachmentId", ' +
  'estado, abierto_at AS "abiertoAt", cerrado_at AS "cerradoAt"';

const EQUIPMENT_MOVEMENT_SELECT_COLUMNAS =
  'id, rental_id AS "rentalId", tipo, cantidad::float8 AS cantidad, ' +
  'boleta_attachment_id AS "boletaAttachmentId", registrado_por AS "registradoPor", at';

function mapEquipmentRental(row: EquipmentRentalRow): EquipmentRental {
  return {
    id: row.id,
    projectId: row.projectId,
    supplierId: row.supplierId,
    descripcionEquipo: row.descripcionEquipo,
    cantidadInicial: Number(row.cantidadInicial),
    cantidadActiva: Number(row.cantidadActiva),
    boletaAttachmentId: row.boletaAttachmentId,
    estado: row.estado,
    abiertoAt: dateFromRow(row.abiertoAt),
    cerradoAt: row.cerradoAt === null ? null : dateFromRow(row.cerradoAt),
  };
}

function mapEquipmentMovement(row: EquipmentMovementRow): EquipmentMovement {
  return {
    id: row.id,
    rentalId: row.rentalId,
    tipo: row.tipo,
    cantidad: Number(row.cantidad),
    boletaAttachmentId: row.boletaAttachmentId,
    registradoPor: row.registradoPor,
    at: dateFromRow(row.at),
  };
}

export class PgEquipmentRepo implements EquipmentRepo {
  constructor(private readonly tx: Tx) {}

  async crearRental(input: NuevoEquipmentRental): Promise<EquipmentRental> {
    // cantidad_activa arranca en 0: es el trigger 009 (sobre el INSERT de
    // equipment_movements) el que la recalcula, nunca esta insercion. El llamador (tool
    // B9) registra a continuacion el movimiento `entrada` inicial en la misma transaccion.
    const result = await this.tx.query<EquipmentRentalRow>(
      'INSERT INTO equipment_rentals ' +
        '(project_id, supplier_id, descripcion_equipo, cantidad_inicial, cantidad_activa, ' +
        'boleta_attachment_id) ' +
        'VALUES ($1, $2, $3, $4, 0, $5) ' +
        `RETURNING ${EQUIPMENT_RENTAL_SELECT_COLUMNAS}`,
      [
        input.projectId,
        input.supplierId,
        input.descripcionEquipo,
        input.cantidadInicial,
        input.boletaAttachmentId,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear el alquiler de equipo.');
    return mapEquipmentRental(row);
  }

  async rentalPorId(rentalId: string): Promise<EquipmentRental | null> {
    const result = await this.tx.query<EquipmentRentalRow>(
      `SELECT ${EQUIPMENT_RENTAL_SELECT_COLUMNAS} FROM equipment_rentals WHERE id = $1`,
      [rentalId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapEquipmentRental(row);
  }

  async rentalsActivosPorProyecto(projectId: string): Promise<readonly EquipmentRental[]> {
    const result = await this.tx.query<EquipmentRentalRow>(
      `SELECT ${EQUIPMENT_RENTAL_SELECT_COLUMNAS} FROM equipment_rentals ` +
        "WHERE project_id = $1 AND estado = 'activo' ORDER BY abierto_at, id",
      [projectId],
    );
    return result.rows.map(mapEquipmentRental);
  }

  async rentalsActivosPorProveedor(supplierId: string): Promise<readonly EquipmentRental[]> {
    const result = await this.tx.query<EquipmentRentalRow>(
      `SELECT ${EQUIPMENT_RENTAL_SELECT_COLUMNAS} FROM equipment_rentals ` +
        "WHERE supplier_id = $1 AND estado = 'activo' ORDER BY abierto_at, id",
      [supplierId],
    );
    return result.rows.map(mapEquipmentRental);
  }

  async crearMovimiento(input: EquipmentMovementInput): Promise<EquipmentMovementResultado> {
    const result = await this.tx.query<EquipmentMovementRow>(
      'INSERT INTO equipment_movements ' +
        '(rental_id, tipo, cantidad, boleta_attachment_id, registrado_por, at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) ' +
        `RETURNING ${EQUIPMENT_MOVEMENT_SELECT_COLUMNAS}`,
      [
        input.rentalId,
        input.tipo,
        input.cantidad,
        input.boletaAttachmentId,
        input.registradoPor,
        input.at,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear el movimiento de equipo.');
    const movimiento = mapEquipmentMovement(row);

    // El trigger equipment_movements_recalcula_activo (migracion 009) ya corrio sobre el
    // INSERT anterior; relee equipment_rentals para devolver el saldo ya actualizado.
    const rentalResult = await this.tx.query<EquipmentRentalRow>(
      `SELECT ${EQUIPMENT_RENTAL_SELECT_COLUMNAS} FROM equipment_rentals WHERE id = $1`,
      [input.rentalId],
    );
    const rentalRow = rentalResult.rows[0];
    if (rentalRow === undefined) {
      throw new Error(`Alquiler no encontrado tras registrar movimiento: ${input.rentalId}.`);
    }

    return { movimiento, rental: mapEquipmentRental(rentalRow) };
  }

  async movimientosPorRental(rentalId: string): Promise<readonly EquipmentMovement[]> {
    const result = await this.tx.query<EquipmentMovementRow>(
      `SELECT ${EQUIPMENT_MOVEMENT_SELECT_COLUMNAS} FROM equipment_movements ` +
        'WHERE rental_id = $1 ORDER BY at, id',
      [rentalId],
    );
    return result.rows.map(mapEquipmentMovement);
  }

  async cerrarRental(rentalId: string, cerradoAt: Date): Promise<EquipmentRental> {
    const result = await this.tx.query<EquipmentRentalRow>(
      "UPDATE equipment_rentals SET estado = 'cerrado', cerrado_at = $2 WHERE id = $1 " +
        `RETURNING ${EQUIPMENT_RENTAL_SELECT_COLUMNAS}`,
      [rentalId, cerradoAt],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Alquiler no encontrado al cerrar: ${rentalId}.`);
    return mapEquipmentRental(row);
  }
}

// ---------------------------------------------------------------------------
// dashboard_links y feedback (Fase 2b, B2).
// ---------------------------------------------------------------------------

interface DashboardLinkRow {
  readonly id: string;
  readonly tokenHash: string;
  readonly projectId: string;
  readonly expiresAt: Date | string;
  readonly createdBy: string | null;
}

function mapDashboardLink(row: DashboardLinkRow): DashboardLink {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    projectId: row.projectId,
    expiresAt: dateFromRow(row.expiresAt),
    createdBy: row.createdBy,
  };
}

export class PgDashboardLinkRepo implements DashboardLinkRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevoDashboardLink): Promise<DashboardLink> {
    const result = await this.tx.query<DashboardLinkRow>(
      'INSERT INTO dashboard_links (token_hash, project_id, expires_at, created_by) ' +
        'VALUES ($1, $2, $3, $4) ' +
        'RETURNING id, token_hash AS "tokenHash", project_id AS "projectId", ' +
        'expires_at AS "expiresAt", created_by AS "createdBy"',
      [input.tokenHash, input.projectId, input.expiresAt, input.createdBy],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear el dashboard_link.');
    return mapDashboardLink(row);
  }

  async porTokenHashVigente(tokenHash: string, ahora: Date): Promise<DashboardLink | null> {
    const result = await this.tx.query<DashboardLinkRow>(
      'SELECT id, token_hash AS "tokenHash", project_id AS "projectId", ' +
        'expires_at AS "expiresAt", created_by AS "createdBy" FROM dashboard_links ' +
        'WHERE token_hash = $1 AND expires_at > $2',
      [tokenHash, ahora],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapDashboardLink(row);
  }
}

interface FeedbackRow {
  readonly id: string;
  readonly userId: string | null;
  readonly tipo: Feedback['tipo'];
  readonly texto: string;
  readonly contexto: unknown;
}

function mapFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    userId: row.userId,
    tipo: row.tipo,
    texto: row.texto,
    contexto: row.contexto,
  };
}

export class PgFeedbackRepo implements FeedbackRepo {
  constructor(private readonly tx: Tx) {}

  async crear(input: NuevoFeedback): Promise<Feedback> {
    const result = await this.tx.query<FeedbackRow>(
      'INSERT INTO feedback (user_id, tipo, texto, contexto) ' +
        'VALUES ($1, $2, $3, $4::jsonb) ' +
        'RETURNING id, user_id AS "userId", tipo, texto, contexto',
      [input.userId, input.tipo, input.texto, JSON.stringify(input.contexto ?? null)],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear el feedback.');
    return mapFeedback(row);
  }
}

// ---------------------------------------------------------------------------
// Cobertura de recepcion (state-machine.md §Computo de cobertura). Agregado SQL puro;
// alimenta directamente estadoObjetivoOc/estadoObjetivoPedido de @proveeduria/core (tests
// cruzados core<->SQL obligatorios, ver repos-2b.integration.test.ts).
// ---------------------------------------------------------------------------

interface CoberturaItemRow {
  readonly cantidad: number | string;
  readonly cantidadRecibida: number | string;
}

interface EstadoOcRow {
  readonly estado: EstadoOC;
}

export class PgCoberturaRepo implements CoberturaRepo {
  constructor(private readonly tx: Tx) {}

  async coberturaDeOc(ocId: string): Promise<readonly ItemCobertura[]> {
    const result = await this.tx.query<CoberturaItemRow>(
      'SELECT pi.cantidad::float8 AS cantidad, ' +
        'COALESCE(cov.cantidad_recibida, 0)::float8 AS "cantidadRecibida" ' +
        'FROM po_items pi ' +
        'LEFT JOIN LATERAL ( ' +
        'SELECT SUM((rc.cantidades ->> pi.id::text)::numeric) AS cantidad_recibida ' +
        'FROM receipt_confirmations rc ' +
        'JOIN invoices i ON i.id = rc.invoice_id ' +
        'JOIN invoice_po_links ipl ON ipl.invoice_id = rc.invoice_id AND ipl.po_id = pi.po_id ' +
        "WHERE i.estado = 'conciliada' " +
        ') cov ON true ' +
        'WHERE pi.po_id = $1 ' +
        'ORDER BY pi.created_at, pi.id',
      [ocId],
    );
    return result.rows.map((row) => ({
      cantidad: Number(row.cantidad),
      cantidadRecibida: Number(row.cantidadRecibida),
    }));
  }

  async estadosOcDePedido(pedidoId: string): Promise<readonly OcParaCobertura[]> {
    const result = await this.tx.query<EstadoOcRow>(
      'SELECT estado FROM purchase_orders WHERE pedido_id = $1 ORDER BY created_at, id',
      [pedidoId],
    );
    return result.rows.map((row) => ({ estado: row.estado }));
  }
}

// ---------------------------------------------------------------------------
// attachments / attachment_blobs (outbox-whatsapp.md §Documentos adjuntos). Primer
// consumidor: `emitir_oc` (PDF de OC).
// ---------------------------------------------------------------------------

interface AttachmentRow {
  readonly id: string;
  readonly blobPath: string;
  readonly contentType: string | null;
  readonly sha256: string | null;
  readonly origen: string | null;
  readonly tamanoBytes: number | string | null;
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    blobPath: row.blobPath,
    contentType: row.contentType,
    sha256: row.sha256,
    origen: row.origen,
    tamanoBytes: row.tamanoBytes === null ? null : Number(row.tamanoBytes),
  };
}

export class PgAttachmentRepo implements AttachmentRepo {
  constructor(private readonly tx: Tx) {}

  async crearConBytes(input: NuevoAttachment): Promise<Attachment> {
    // El id se genera aqui (en vez de dejar el default de la columna) porque `blob_path`
    // necesita conocerlo de antemano: convencion 'pg://attachment_blobs/<id>'
    // (outbox-whatsapp.md §Documentos adjuntos).
    const id = randomUUID();
    const blobPath = `pg://attachment_blobs/${id}`;
    const result = await this.tx.query<AttachmentRow>(
      'INSERT INTO attachments (id, blob_path, content_type, sha256, origen, bytes) ' +
        'VALUES ($1, $2, $3, $4, $5, $6) ' +
        'RETURNING id, blob_path AS "blobPath", content_type AS "contentType", sha256, ' +
        'origen, bytes AS "tamanoBytes"',
      [id, blobPath, input.contentType, input.sha256, input.origen, input.bytes.length],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear el attachment.');

    // Misma Tx: si esto falla, el INSERT de attachments anterior tambien revierte.
    await this.tx.query(
      'INSERT INTO attachment_blobs (attachment_id, bytes) VALUES ($1, $2)',
      [id, input.bytes],
    );

    return mapAttachment(row);
  }

  async porId(attachmentId: string): Promise<Attachment | null> {
    const result = await this.tx.query<AttachmentRow>(
      'SELECT id, blob_path AS "blobPath", content_type AS "contentType", sha256, origen, ' +
        'bytes AS "tamanoBytes" FROM attachments WHERE id = $1',
      [attachmentId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapAttachment(row);
  }
}

// ---------------------------------------------------------------------------
// approval_events (lectura de la ultima adjudicacion). Ver docstring de contrato en types.ts.
// ---------------------------------------------------------------------------

interface ApprovalGanadorRow {
  readonly detalle: unknown;
}

export class PgApprovalRepo implements ApprovalRepo {
  constructor(private readonly tx: Tx) {}

  async ultimoGanadorPorPedido(pedidoId: string): Promise<ApprovalGanador | null> {
    const result = await this.tx.query<ApprovalGanadorRow>(
      "SELECT detalle FROM approval_events " +
        "WHERE pedido_id = $1 AND tipo = 'ganador' " +
        'ORDER BY at DESC, created_at DESC LIMIT 1',
      [pedidoId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;

    const asignaciones = parseAsignacionesGanador(row.detalle);
    if (asignaciones === null) return null;

    return { pedidoId, asignaciones };
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
    ocs: new PgOcRepo(tx),
    invoices: new PgInvoiceRepo(tx),
    invoicePoLinks: new PgInvoicePoLinkRepo(tx),
    receiptConfirmations: new PgReceiptConfirmationRepo(tx),
    creditNotes: new PgCreditNoteRepo(tx),
    equipment: new PgEquipmentRepo(tx),
    dashboardLinks: new PgDashboardLinkRepo(tx),
    feedback: new PgFeedbackRepo(tx),
    cobertura: new PgCoberturaRepo(tx),
    attachments: new PgAttachmentRepo(tx),
    approvals: new PgApprovalRepo(tx),
  };
}
