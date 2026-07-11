/**
 * Store de Proveedores del Centro de Control (docs/specs/portal-api.md §Proveedores;
 * docs/specs/control-center.md §CRUD proveedores).
 *
 * Lecturas van directo por `pool` (no necesitan atomicidad). Cada mutacion abre SU PROPIA
 * transaccion con `withTx` (`@proveeduria/agent`: `pool.connect()` + `BEGIN`/`COMMIT`) y
 * escribe el dominio + `audit_events` (origen `web`, `actor_user_id` del actor autenticado)
 * en la MISMA transaccion (control-center.md principio 1). Sin deletes: desactivar un
 * proveedor es un `UPDATE activo=false`, nunca un `DELETE`.
 */

import type { Pool } from 'pg';
import { crearAuditInserter, withTx } from '@proveeduria/agent';
import type { Actor, Tx } from '@proveeduria/agent';
import { err, ok } from '@proveeduria/core';
import type { Result } from '@proveeduria/core';

import type {
  ActualizarContactoInput,
  ActualizarProveedorInput,
  ErrorCrearContacto,
  ListaProveedoresPortal,
  ListarProveedoresFiltro,
  NuevoContactoInput,
  NuevoProveedorInput,
  PortalActor,
  ProveedorContactoPortal,
  ProveedorPortal,
  ProveedoresStore,
} from './types.js';

interface SupplierRow {
  readonly id: string;
  readonly nombre: string;
  readonly cedulaJuridica: string | null;
  readonly categorias: readonly string[] | string;
  readonly activo: boolean;
  readonly notas: string | null;
}

interface ContactoRow {
  readonly id: string;
  readonly supplierId: string;
  readonly nombre: string | null;
  readonly telefonoWhatsapp: string;
  readonly esPrincipal: boolean;
  readonly optinAt: Date | string | null;
}

const SELECT_SUPPLIER =
  'SELECT id, nombre, cedula_juridica AS "cedulaJuridica", categorias, activo, notas FROM suppliers';

const SELECT_CONTACTO =
  'SELECT id, supplier_id AS "supplierId", nombre, telefono_whatsapp AS "telefonoWhatsapp", ' +
  'es_principal AS "esPrincipal", optin_at AS "optinAt" FROM supplier_contacts';

function arrayFromRow(value: readonly string[] | string): readonly string[] {
  if (typeof value !== 'string') return value;
  return value.replace(/[{}]/g, '').split(',').filter(Boolean);
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProveedor(row: SupplierRow, contactos: readonly ProveedorContactoPortal[]): ProveedorPortal {
  return {
    id: row.id,
    nombre: row.nombre,
    cedulaJuridica: row.cedulaJuridica,
    categorias: arrayFromRow(row.categorias),
    activo: row.activo,
    notas: row.notas,
    contactos,
  };
}

function mapContacto(row: ContactoRow): ProveedorContactoPortal {
  return {
    id: row.id,
    nombre: row.nombre,
    telefonoWhatsapp: row.telefonoWhatsapp,
    esPrincipal: row.esPrincipal,
    optinAt: iso(row.optinAt),
  };
}

/** Codigo de Postgres para `unique_violation` (constraint de `telefono_whatsapp`). */
function esViolacionUnicidad(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

function actorAgent(actor: PortalActor): Actor {
  return { userId: actor.userId, roles: actor.roles, nombre: actor.nombre };
}

export class PgProveedoresStore implements ProveedoresStore {
  constructor(private readonly pool: Pool) {}

  private async contactosPorSupplierIds(
    exec: Tx,
    supplierIds: readonly string[],
  ): Promise<Map<string, ProveedorContactoPortal[]>> {
    const mapa = new Map<string, ProveedorContactoPortal[]>();
    if (supplierIds.length === 0) return mapa;
    const result = await exec.query<ContactoRow>(
      `${SELECT_CONTACTO} WHERE supplier_id = ANY($1::uuid[]) ORDER BY es_principal DESC, nombre ASC NULLS LAST, id ASC`,
      [supplierIds],
    );
    for (const row of result.rows) {
      const lista = mapa.get(row.supplierId) ?? [];
      lista.push(mapContacto(row));
      mapa.set(row.supplierId, lista);
    }
    return mapa;
  }

  async listar(filtro: ListarProveedoresFiltro): Promise<ListaProveedoresPortal> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filtro.activo !== undefined) {
      params.push(filtro.activo);
      where.push(`activo = $${params.length}`);
    }
    if (filtro.q !== undefined) {
      params.push(`%${filtro.q}%`);
      where.push(`(nombre ILIKE $${params.length} OR cedula_juridica ILIKE $${params.length})`);
    }
    const whereSql = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM suppliers ${whereSql}`,
      params,
    );

    const listParams = [...params, filtro.limit, filtro.offset];
    const result = await this.pool.query<SupplierRow>(
      `${SELECT_SUPPLIER} ${whereSql} ORDER BY nombre ASC, id ASC ` +
        `LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    const contactosPorId = await this.contactosPorSupplierIds(this.pool, result.rows.map((r) => r.id));

    return {
      items: result.rows.map((row) => mapProveedor(row, contactosPorId.get(row.id) ?? [])),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit: filtro.limit,
      offset: filtro.offset,
    };
  }

  async porId(supplierId: string): Promise<ProveedorPortal | null> {
    const result = await this.pool.query<SupplierRow>(`${SELECT_SUPPLIER} WHERE id = $1`, [supplierId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    const contactosPorId = await this.contactosPorSupplierIds(this.pool, [row.id]);
    return mapProveedor(row, contactosPorId.get(row.id) ?? []);
  }

  async crear(actor: PortalActor, input: NuevoProveedorInput, ahora: Date): Promise<ProveedorPortal> {
    return withTx(this.pool, async (tx) => {
      const result = await tx.query<SupplierRow>(
        'INSERT INTO suppliers (nombre, cedula_juridica, categorias, notas) VALUES ($1, $2, $3, $4) ' +
          'RETURNING id, nombre, cedula_juridica AS "cedulaJuridica", categorias, activo, notas',
        [input.nombre, input.cedulaJuridica, input.categorias, input.notas],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('No se pudo crear el proveedor.');

      await crearAuditInserter(tx, actorAgent(actor), ahora, 'web')({
        accion: 'proveedor_creado',
        entidad: 'suppliers',
        entidadId: row.id,
        despues: row,
      });

      return mapProveedor(row, []);
    });
  }

  async actualizar(
    actor: PortalActor,
    supplierId: string,
    input: ActualizarProveedorInput,
    ahora: Date,
  ): Promise<ProveedorPortal | null> {
    return withTx(this.pool, async (tx) => {
      const before = await tx.query<SupplierRow>(`${SELECT_SUPPLIER} WHERE id = $1 FOR UPDATE`, [supplierId]);
      const beforeRow = before.rows[0];
      if (beforeRow === undefined) return null;

      const sets: string[] = [];
      const params: unknown[] = [supplierId];
      if (input.nombre !== undefined) {
        params.push(input.nombre);
        sets.push(`nombre = $${params.length}`);
      }
      if (input.cedulaJuridica !== undefined) {
        params.push(input.cedulaJuridica);
        sets.push(`cedula_juridica = $${params.length}`);
      }
      if (input.categorias !== undefined) {
        params.push(input.categorias);
        sets.push(`categorias = $${params.length}`);
      }
      if (input.notas !== undefined) {
        params.push(input.notas);
        sets.push(`notas = $${params.length}`);
      }
      if (input.activo !== undefined) {
        params.push(input.activo);
        sets.push(`activo = $${params.length}`);
      }

      const contactosPorId = await this.contactosPorSupplierIds(tx, [supplierId]);

      if (sets.length === 0) {
        return mapProveedor(beforeRow, contactosPorId.get(supplierId) ?? []);
      }

      sets.push('updated_at = now()');
      const result = await tx.query<SupplierRow>(
        `UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1 ` +
          'RETURNING id, nombre, cedula_juridica AS "cedulaJuridica", categorias, activo, notas',
        params,
      );
      const afterRow = result.rows[0];
      if (afterRow === undefined) throw new Error('No se pudo actualizar el proveedor.');

      await crearAuditInserter(tx, actorAgent(actor), ahora, 'web')({
        accion: 'proveedor_actualizado',
        entidad: 'suppliers',
        entidadId: supplierId,
        antes: beforeRow,
        despues: afterRow,
      });

      return mapProveedor(afterRow, contactosPorId.get(supplierId) ?? []);
    });
  }

  async crearContacto(
    actor: PortalActor,
    supplierId: string,
    input: NuevoContactoInput,
    ahora: Date,
  ): Promise<Result<ProveedorContactoPortal, ErrorCrearContacto>> {
    return withTx(this.pool, async (tx) => {
      const supplier = await tx.query<{ id: string }>('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
      if (supplier.rows[0] === undefined) return err('no_encontrado');

      try {
        const result = await tx.query<ContactoRow>(
          'INSERT INTO supplier_contacts (supplier_id, nombre, telefono_whatsapp, es_principal) ' +
            'VALUES ($1, $2, $3, $4) RETURNING ' +
            'id, supplier_id AS "supplierId", nombre, telefono_whatsapp AS "telefonoWhatsapp", ' +
            'es_principal AS "esPrincipal", optin_at AS "optinAt"',
          [supplierId, input.nombre, input.telefonoWhatsapp, input.esPrincipal],
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error('No se pudo crear el contacto.');

        await crearAuditInserter(tx, actorAgent(actor), ahora, 'web')({
          accion: 'contacto_creado',
          entidad: 'supplier_contacts',
          entidadId: row.id,
          despues: row,
        });

        return ok(mapContacto(row));
      } catch (error) {
        if (esViolacionUnicidad(error)) return err('telefono_duplicado');
        throw error;
      }
    });
  }

  async actualizarContacto(
    actor: PortalActor,
    contactoId: string,
    input: ActualizarContactoInput,
    ahora: Date,
  ): Promise<ProveedorContactoPortal | null> {
    return withTx(this.pool, async (tx) => {
      const before = await tx.query<ContactoRow>(`${SELECT_CONTACTO} WHERE id = $1 FOR UPDATE`, [contactoId]);
      const beforeRow = before.rows[0];
      if (beforeRow === undefined) return null;

      const sets: string[] = [];
      const params: unknown[] = [contactoId];
      if (input.nombre !== undefined) {
        params.push(input.nombre);
        sets.push(`nombre = $${params.length}`);
      }
      if (input.esPrincipal !== undefined) {
        params.push(input.esPrincipal);
        sets.push(`es_principal = $${params.length}`);
      }

      if (sets.length === 0) return mapContacto(beforeRow);

      sets.push('updated_at = now()');
      const result = await tx.query<ContactoRow>(
        `UPDATE supplier_contacts SET ${sets.join(', ')} WHERE id = $1 RETURNING ` +
          'id, supplier_id AS "supplierId", nombre, telefono_whatsapp AS "telefonoWhatsapp", ' +
          'es_principal AS "esPrincipal", optin_at AS "optinAt"',
        params,
      );
      const afterRow = result.rows[0];
      if (afterRow === undefined) throw new Error('No se pudo actualizar el contacto.');

      await crearAuditInserter(tx, actorAgent(actor), ahora, 'web')({
        accion: 'contacto_actualizado',
        entidad: 'supplier_contacts',
        entidadId: contactoId,
        antes: beforeRow,
        despues: afterRow,
      });

      return mapContacto(afterRow);
    });
  }

  private async fijarOptin(
    actor: PortalActor,
    contactoId: string,
    ahora: Date,
    optinAt: Date | null,
    accion: 'contacto_optin' | 'contacto_baja',
  ): Promise<ProveedorContactoPortal | null> {
    return withTx(this.pool, async (tx) => {
      const before = await tx.query<ContactoRow>(`${SELECT_CONTACTO} WHERE id = $1 FOR UPDATE`, [contactoId]);
      const beforeRow = before.rows[0];
      if (beforeRow === undefined) return null;

      const result = await tx.query<ContactoRow>(
        'UPDATE supplier_contacts SET optin_at = $2, updated_at = now() WHERE id = $1 RETURNING ' +
          'id, supplier_id AS "supplierId", nombre, telefono_whatsapp AS "telefonoWhatsapp", ' +
          'es_principal AS "esPrincipal", optin_at AS "optinAt"',
        [contactoId, optinAt],
      );
      const afterRow = result.rows[0];
      if (afterRow === undefined) throw new Error('No se pudo actualizar el opt-in del contacto.');

      await crearAuditInserter(tx, actorAgent(actor), ahora, 'web')({
        accion,
        entidad: 'supplier_contacts',
        entidadId: contactoId,
        antes: beforeRow,
        despues: afterRow,
      });

      return mapContacto(afterRow);
    });
  }

  async optinContacto(actor: PortalActor, contactoId: string, ahora: Date): Promise<ProveedorContactoPortal | null> {
    return this.fijarOptin(actor, contactoId, ahora, ahora, 'contacto_optin');
  }

  async bajaContacto(actor: PortalActor, contactoId: string, ahora: Date): Promise<ProveedorContactoPortal | null> {
    return this.fijarOptin(actor, contactoId, ahora, null, 'contacto_baja');
  }
}

interface FakeProveedorRow {
  id: string;
  nombre: string;
  cedulaJuridica: string | null;
  categorias: string[];
  activo: boolean;
  notas: string | null;
}

interface FakeContactoRow {
  id: string;
  supplierId: string;
  nombre: string | null;
  telefonoWhatsapp: string;
  esPrincipal: boolean;
  optinAt: Date | null;
}

export interface FakeAuditoriaProveedores {
  readonly accion: string;
  readonly entidad: string;
  readonly entidadId: string;
  readonly actorUserId: string;
  readonly antes?: unknown;
  readonly despues?: unknown;
}

/** Fake en memoria para tests de rutas (patron `FakeAuthStore`/`FakePortalStore`). */
export class FakeProveedoresStore implements ProveedoresStore {
  private readonly proveedores = new Map<string, FakeProveedorRow>();
  private readonly contactos = new Map<string, FakeContactoRow>();
  private seq = 1;
  readonly auditoria: FakeAuditoriaProveedores[] = [];

  private siguienteId(prefijo: string): string {
    const id = `${prefijo}-${this.seq}`;
    this.seq += 1;
    return id;
  }

  private registrarAudit(accion: string, entidad: string, entidadId: string, actor: PortalActor, extra?: {
    readonly antes?: unknown;
    readonly despues?: unknown;
  }): void {
    this.auditoria.push({ accion, entidad, entidadId, actorUserId: actor.userId, ...extra });
  }

  private contactosDe(supplierId: string): ProveedorContactoPortal[] {
    return [...this.contactos.values()]
      .filter((c) => c.supplierId === supplierId)
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        telefonoWhatsapp: c.telefonoWhatsapp,
        esPrincipal: c.esPrincipal,
        optinAt: c.optinAt === null ? null : c.optinAt.toISOString(),
      }));
  }

  private aPortal(row: FakeProveedorRow): ProveedorPortal {
    return { ...row, contactos: this.contactosDe(row.id) };
  }

  /** Setup directo (evita depender de `crear` en arranques de test). */
  agregarProveedor(input: {
    readonly id?: string;
    readonly nombre: string;
    readonly cedulaJuridica?: string | null;
    readonly categorias?: readonly string[];
    readonly activo?: boolean;
    readonly notas?: string | null;
  }): string {
    const id = input.id ?? this.siguienteId('proveedor');
    this.proveedores.set(id, {
      id,
      nombre: input.nombre,
      cedulaJuridica: input.cedulaJuridica ?? null,
      categorias: [...(input.categorias ?? [])],
      activo: input.activo ?? true,
      notas: input.notas ?? null,
    });
    return id;
  }

  agregarContacto(input: {
    readonly id?: string;
    readonly supplierId: string;
    readonly nombre?: string | null;
    readonly telefonoWhatsapp: string;
    readonly esPrincipal?: boolean;
    readonly optinAt?: Date | null;
  }): string {
    const id = input.id ?? this.siguienteId('contacto');
    this.contactos.set(id, {
      id,
      supplierId: input.supplierId,
      nombre: input.nombre ?? null,
      telefonoWhatsapp: input.telefonoWhatsapp,
      esPrincipal: input.esPrincipal ?? false,
      optinAt: input.optinAt ?? null,
    });
    return id;
  }

  async listar(filtro: ListarProveedoresFiltro): Promise<ListaProveedoresPortal> {
    let items = [...this.proveedores.values()];
    if (filtro.activo !== undefined) items = items.filter((p) => p.activo === filtro.activo);
    if (filtro.q !== undefined) {
      const q = filtro.q.toLowerCase();
      items = items.filter(
        (p) => p.nombre.toLowerCase().includes(q) || (p.cedulaJuridica ?? '').toLowerCase().includes(q),
      );
    }
    items.sort((a, b) => a.nombre.localeCompare(b.nombre));
    const total = items.length;
    const pagina = items.slice(filtro.offset, filtro.offset + filtro.limit);
    return { items: pagina.map((p) => this.aPortal(p)), total, limit: filtro.limit, offset: filtro.offset };
  }

  async porId(supplierId: string): Promise<ProveedorPortal | null> {
    const row = this.proveedores.get(supplierId);
    return row === undefined ? null : this.aPortal(row);
  }

  async crear(actor: PortalActor, input: NuevoProveedorInput): Promise<ProveedorPortal> {
    const id = this.agregarProveedor(input);
    const row = this.proveedores.get(id);
    if (row === undefined) throw new Error('No se pudo crear el proveedor (fake).');
    this.registrarAudit('proveedor_creado', 'suppliers', id, actor, { despues: row });
    return this.aPortal(row);
  }

  async actualizar(
    actor: PortalActor,
    supplierId: string,
    input: ActualizarProveedorInput,
  ): Promise<ProveedorPortal | null> {
    const row = this.proveedores.get(supplierId);
    if (row === undefined) return null;
    const antes = { ...row };
    if (input.nombre !== undefined) row.nombre = input.nombre;
    if (input.cedulaJuridica !== undefined) row.cedulaJuridica = input.cedulaJuridica;
    if (input.categorias !== undefined) row.categorias = [...input.categorias];
    if (input.notas !== undefined) row.notas = input.notas;
    if (input.activo !== undefined) row.activo = input.activo;
    this.registrarAudit('proveedor_actualizado', 'suppliers', supplierId, actor, { antes, despues: { ...row } });
    return this.aPortal(row);
  }

  async crearContacto(
    actor: PortalActor,
    supplierId: string,
    input: NuevoContactoInput,
  ): Promise<Result<ProveedorContactoPortal, ErrorCrearContacto>> {
    if (!this.proveedores.has(supplierId)) return err('no_encontrado');
    const duplicado = [...this.contactos.values()].some((c) => c.telefonoWhatsapp === input.telefonoWhatsapp);
    if (duplicado) return err('telefono_duplicado');

    const id = this.agregarContacto({ supplierId, ...input });
    const row = this.contactos.get(id);
    if (row === undefined) throw new Error('No se pudo crear el contacto (fake).');
    this.registrarAudit('contacto_creado', 'supplier_contacts', id, actor, { despues: row });
    return ok(this.contactosDe(supplierId).find((c) => c.id === id)!);
  }

  async actualizarContacto(
    actor: PortalActor,
    contactoId: string,
    input: ActualizarContactoInput,
  ): Promise<ProveedorContactoPortal | null> {
    const row = this.contactos.get(contactoId);
    if (row === undefined) return null;
    const antes = { ...row };
    if (input.nombre !== undefined) row.nombre = input.nombre;
    if (input.esPrincipal !== undefined) row.esPrincipal = input.esPrincipal;
    this.registrarAudit('contacto_actualizado', 'supplier_contacts', contactoId, actor, { antes, despues: { ...row } });
    return this.contactosDe(row.supplierId).find((c) => c.id === contactoId) ?? null;
  }

  private async fijarOptin(
    actor: PortalActor,
    contactoId: string,
    optinAt: Date | null,
    accion: 'contacto_optin' | 'contacto_baja',
  ): Promise<ProveedorContactoPortal | null> {
    const row = this.contactos.get(contactoId);
    if (row === undefined) return null;
    const antes = { ...row };
    row.optinAt = optinAt;
    this.registrarAudit(accion, 'supplier_contacts', contactoId, actor, { antes, despues: { ...row } });
    return this.contactosDe(row.supplierId).find((c) => c.id === contactoId) ?? null;
  }

  async optinContacto(actor: PortalActor, contactoId: string, ahora: Date): Promise<ProveedorContactoPortal | null> {
    return this.fijarOptin(actor, contactoId, ahora, 'contacto_optin');
  }

  async bajaContacto(actor: PortalActor, contactoId: string): Promise<ProveedorContactoPortal | null> {
    return this.fijarOptin(actor, contactoId, null, 'contacto_baja');
  }
}
