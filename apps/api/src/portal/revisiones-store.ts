/**
 * Store de la Cola de revision del Centro de Control (docs/specs/portal-api.md
 * §Cola de revision; docs/specs/control-center.md §Resolver cola de revision).
 *
 * v1: `resolver` marca `estado='resuelta'` + `resuelta_por` + `resolucion` (texto
 * obligatorio, validado en la capa de rutas) y NO ejecuta efectos de dominio — eso llega
 * con las tools 2b (control-center.md). El UPDATE solo aplica sobre `estado='pendiente'`;
 * si no afecta filas se distingue "no existe" (404) de "ya estaba resuelta" (409) con un
 * SELECT de verificacion, ambos dentro de la MISMA transaccion via `withTx`.
 */

import type { Pool } from 'pg';
import { crearAuditInserter, withTx } from '@proveeduria/agent';
import type { Actor } from '@proveeduria/agent';
import { err, ok } from '@proveeduria/core';
import type { Result } from '@proveeduria/core';

import type {
  ErrorResolverRevision,
  ListaRevisionesPortal,
  ListarRevisionesFiltro,
  PortalActor,
  RevisionColaPortal,
  RevisionesStore,
} from './types.js';

interface RevisionRow {
  readonly id: string;
  readonly tipo: string;
  readonly entidad: string;
  readonly entidadId: string;
  readonly pedidoId: string | null;
  readonly pedidoNumero: string | null;
  readonly detalle: unknown;
  readonly estado: 'pendiente' | 'resuelta';
  readonly createdAt: Date | string;
  readonly resueltaPorId: string | null;
  readonly resueltaPorNombre: string | null;
  readonly resolucion: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRevision(row: RevisionRow): RevisionColaPortal {
  return {
    id: row.id,
    tipo: row.tipo,
    entidad: row.entidad,
    entidadId: row.entidadId,
    pedido: row.pedidoId === null ? null : { id: row.pedidoId, numero: row.pedidoNumero ?? '' },
    detalle: row.detalle,
    estado: row.estado,
    createdAt: iso(row.createdAt),
    resueltaPor: row.resueltaPorId === null
      ? null
      : { userId: row.resueltaPorId, nombre: row.resueltaPorNombre ?? '' },
    resolucion: row.resolucion,
  };
}

function actorAgent(actor: PortalActor): Actor {
  return { userId: actor.userId, roles: actor.roles, nombre: actor.nombre };
}

const SELECT_REVISION =
  'SELECT rq.id, rq.tipo, rq.entidad, rq.entidad_id AS "entidadId", rq.pedido_id AS "pedidoId", ' +
  'p.numero AS "pedidoNumero", rq.detalle, rq.estado, rq.created_at AS "createdAt", ' +
  'rq.resuelta_por AS "resueltaPorId", u.nombre AS "resueltaPorNombre", rq.resolucion ' +
  'FROM review_queue rq ' +
  'LEFT JOIN pedidos p ON p.id = rq.pedido_id ' +
  'LEFT JOIN users u ON u.id = rq.resuelta_por';

export class PgRevisionesStore implements RevisionesStore {
  constructor(private readonly pool: Pool) {}

  async listar(filtro: ListarRevisionesFiltro): Promise<ListaRevisionesPortal> {
    const params: unknown[] = [filtro.estado];
    const where: string[] = ['rq.estado = $1'];
    if (filtro.tipo !== undefined) {
      params.push(filtro.tipo);
      where.push(`rq.tipo = $${params.length}`);
    }
    if (filtro.projectId !== undefined) {
      params.push(filtro.projectId);
      where.push(`p.project_id = $${params.length}`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM review_queue rq LEFT JOIN pedidos p ON p.id = rq.pedido_id ${whereSql}`,
      params,
    );

    const listParams = [...params, filtro.limit, filtro.offset];
    const result = await this.pool.query<RevisionRow>(
      `${SELECT_REVISION} ${whereSql} ORDER BY rq.created_at ASC, rq.id ASC ` +
        `LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );

    return {
      items: result.rows.map(mapRevision),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit: filtro.limit,
      offset: filtro.offset,
    };
  }

  async resolver(
    actor: PortalActor,
    revisionId: string,
    resolucion: string,
    ahora: Date,
  ): Promise<Result<RevisionColaPortal, ErrorResolverRevision>> {
    return withTx(this.pool, async (tx) => {
      const result = await tx.query<{ id: string }>(
        "UPDATE review_queue SET estado = 'resuelta', resuelta_por = $2, resolucion = $3, updated_at = $4 " +
          "WHERE id = $1 AND estado = 'pendiente' RETURNING id",
        [revisionId, actor.userId, resolucion, ahora],
      );

      if (result.rows[0] === undefined) {
        const existe = await tx.query<{ id: string }>('SELECT id FROM review_queue WHERE id = $1', [revisionId]);
        return existe.rows[0] === undefined ? err('no_encontrada') : err('ya_resuelta');
      }

      await crearAuditInserter(tx, actorAgent(actor), ahora, 'web')({
        accion: 'revision_resuelta',
        entidad: 'review_queue',
        entidadId: revisionId,
        despues: { estado: 'resuelta', resolucion, resueltaPor: actor.userId },
      });

      const actualizada = await tx.query<RevisionRow>(`${SELECT_REVISION} WHERE rq.id = $1`, [revisionId]);
      const row = actualizada.rows[0];
      if (row === undefined) throw new Error('No se pudo releer la revision resuelta.');
      return ok(mapRevision(row));
    });
  }
}

interface FakeRevisionRow {
  id: string;
  tipo: string;
  entidad: string;
  entidadId: string;
  pedidoId: string | null;
  pedidoNumero: string | null;
  detalle: unknown;
  estado: 'pendiente' | 'resuelta';
  createdAt: Date;
  resueltaPorId: string | null;
  resueltaPorNombre: string | null;
  resolucion: string | null;
  projectId: string | null;
}

export interface FakeAuditoriaRevisiones {
  readonly accion: string;
  readonly entidadId: string;
  readonly actorUserId: string;
}

/** Fake en memoria para tests de rutas (patron `FakeProveedoresStore`/`FakeAuthStore`). */
export class FakeRevisionesStore implements RevisionesStore {
  private readonly revisiones = new Map<string, FakeRevisionRow>();
  private seq = 1;
  readonly auditoria: FakeAuditoriaRevisiones[] = [];

  agregarRevision(input: {
    readonly id?: string;
    readonly tipo: string;
    readonly entidad: string;
    readonly entidadId: string;
    readonly pedidoId?: string | null;
    readonly pedidoNumero?: string | null;
    readonly projectId?: string | null;
    readonly detalle?: unknown;
    readonly estado?: 'pendiente' | 'resuelta';
    readonly createdAt?: Date;
  }): string {
    const id = input.id ?? `revision-${this.seq}`;
    this.seq += 1;
    this.revisiones.set(id, {
      id,
      tipo: input.tipo,
      entidad: input.entidad,
      entidadId: input.entidadId,
      pedidoId: input.pedidoId ?? null,
      pedidoNumero: input.pedidoNumero ?? null,
      projectId: input.projectId ?? null,
      detalle: input.detalle ?? null,
      estado: input.estado ?? 'pendiente',
      createdAt: input.createdAt ?? new Date(),
      resueltaPorId: null,
      resueltaPorNombre: null,
      resolucion: null,
    });
    return id;
  }

  private aPortal(row: FakeRevisionRow): RevisionColaPortal {
    return {
      id: row.id,
      tipo: row.tipo,
      entidad: row.entidad,
      entidadId: row.entidadId,
      pedido: row.pedidoId === null ? null : { id: row.pedidoId, numero: row.pedidoNumero ?? '' },
      detalle: row.detalle,
      estado: row.estado,
      createdAt: row.createdAt.toISOString(),
      resueltaPor: row.resueltaPorId === null
        ? null
        : { userId: row.resueltaPorId, nombre: row.resueltaPorNombre ?? '' },
      resolucion: row.resolucion,
    };
  }

  async listar(filtro: ListarRevisionesFiltro): Promise<ListaRevisionesPortal> {
    let items = [...this.revisiones.values()].filter((r) => r.estado === filtro.estado);
    if (filtro.tipo !== undefined) items = items.filter((r) => r.tipo === filtro.tipo);
    if (filtro.projectId !== undefined) items = items.filter((r) => r.projectId === filtro.projectId);
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const total = items.length;
    const pagina = items.slice(filtro.offset, filtro.offset + filtro.limit);
    return { items: pagina.map((r) => this.aPortal(r)), total, limit: filtro.limit, offset: filtro.offset };
  }

  async resolver(
    actor: PortalActor,
    revisionId: string,
    resolucion: string,
    ahora: Date,
  ): Promise<Result<RevisionColaPortal, ErrorResolverRevision>> {
    const row = this.revisiones.get(revisionId);
    if (row === undefined) return err('no_encontrada');
    if (row.estado === 'resuelta') return err('ya_resuelta');

    row.estado = 'resuelta';
    row.resueltaPorId = actor.userId;
    row.resueltaPorNombre = actor.nombre;
    row.resolucion = resolucion;
    void ahora;

    this.auditoria.push({ accion: 'revision_resuelta', entidadId: revisionId, actorUserId: actor.userId });
    return ok(this.aPortal(row));
  }
}
