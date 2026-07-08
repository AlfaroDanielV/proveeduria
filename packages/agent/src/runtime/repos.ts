import type { Rol } from '@proveeduria/core';
import type {
  Actor,
  ItemPedidoInput,
  NuevoPedido,
  NuevoQuoteRequest,
  Pedido,
  PedidoItem,
  PedidoItemRepo,
  PedidoRepo,
  Proyecto,
  ProyectoRepo,
  Proveedor,
  ProveedorContacto,
  ProveedorRepo,
  QuoteRequest,
  QuoteRequestRepo,
  Repos,
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
}

export function crearReposPg(tx: Tx): Repos {
  return {
    proyectos: new PgProyectoRepo(tx),
    pedidos: new PgPedidoRepo(tx),
    pedidoItems: new PgPedidoItemRepo(tx),
    usuarios: new PgUsuarioRepo(tx),
    proveedores: new PgProveedorRepo(tx),
    quoteRequests: new PgQuoteRequestRepo(tx),
  };
}
