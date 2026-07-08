import type { Actor, Tx } from '@proveeduria/agent';
import type { Rol } from '@proveeduria/core';
import type {
  ContextoRemitenteDominio,
  RemitenteResolver,
  SupplierContactContext,
} from './types.js';

interface UserRow {
  readonly userId: string;
  readonly nombre: string;
  readonly telefonoWhatsapp: string;
  readonly roles: readonly Rol[] | string;
}

interface SupplierContactRow {
  readonly id: string;
  readonly supplierId: string;
  readonly nombre: string | null;
  readonly telefonoWhatsapp: string;
  readonly optinAt: Date | string | null;
}

function phoneCandidates(phone: string): readonly string[] {
  const trimmed = phone.trim();
  if (trimmed === '') return [''];
  if (trimmed.startsWith('+')) return [trimmed, trimmed.slice(1)];
  return [trimmed, `+${trimmed}`];
}

function rolesFromRow(value: readonly Rol[] | string): readonly Rol[] {
  if (typeof value !== 'string') return value;
  return value.replace(/[{}]/g, '').split(',').filter(Boolean) as Rol[];
}

function dateFromRow(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapActor(row: UserRow): Actor {
  return {
    userId: row.userId,
    nombre: row.nombre,
    roles: rolesFromRow(row.roles),
  };
}

function mapSupplierContact(row: SupplierContactRow): SupplierContactContext {
  return {
    id: row.id,
    supplierId: row.supplierId,
    nombre: row.nombre,
    telefonoWhatsapp: row.telefonoWhatsapp,
    optinAt: row.optinAt === null ? null : dateFromRow(row.optinAt),
  };
}

export class PgRemitenteResolver implements RemitenteResolver {
  constructor(private readonly tx: Tx) {}

  async resolverPorTelefono(phone: string): Promise<ContextoRemitenteDominio> {
    const candidates = phoneCandidates(phone);
    const usuario = await this.tx.query<UserRow>(
      'SELECT u.id AS "userId", u.nombre, u.telefono_whatsapp AS "telefonoWhatsapp", ' +
        "COALESCE(array_agg(DISTINCT r.clave) FILTER (WHERE r.clave IS NOT NULL), '{}') AS roles " +
        'FROM users u ' +
        'LEFT JOIN user_roles ur ON ur.user_id = u.id ' +
        'LEFT JOIN roles r ON r.id = ur.role_id ' +
        'WHERE u.activo IS TRUE AND u.telefono_whatsapp = ANY($1::text[]) ' +
        'GROUP BY u.id ' +
        'ORDER BY array_position($1::text[], u.telefono_whatsapp) ' +
        'LIMIT 1',
      [candidates],
    );
    const userRow = usuario.rows[0];
    if (userRow !== undefined) {
      return {
        tipo: 'interno',
        actor: mapActor(userRow),
        telefonoWhatsapp: userRow.telefonoWhatsapp,
      };
    }

    const proveedor = await this.tx.query<SupplierContactRow>(
      'SELECT id, supplier_id AS "supplierId", nombre, ' +
        'telefono_whatsapp AS "telefonoWhatsapp", optin_at AS "optinAt" ' +
        'FROM supplier_contacts ' +
        'WHERE telefono_whatsapp = ANY($1::text[]) ' +
        'ORDER BY array_position($1::text[], telefono_whatsapp) ' +
        'LIMIT 1',
      [candidates],
    );
    const supplierRow = proveedor.rows[0];
    if (supplierRow !== undefined) {
      return {
        tipo: 'proveedor',
        supplierContact: mapSupplierContact(supplierRow),
      };
    }

    return {
      tipo: 'desconocido',
      telefonoWhatsapp: phone.trim(),
    };
  }
}
