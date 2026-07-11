/**
 * Store de LECTURA del historial de aprobaciones del portal (docs/specs/portal-api.md
 * §Aprobaciones y acciones de pedido `GET /pedidos/:pedidoId/aprobaciones`). Las 4
 * mutaciones de esa seccion NO viven aca: ejecutan tools de `@proveeduria/agent` via
 * `ejecutarToolPedido` (`acciones-pedido.ts`), que ya escriben `approval_events` dentro de
 * su propia transaccion de dominio (control-center.md principio 1: "El portal store NO
 * escribe SQL de dominio crudo").
 */

import type { Pool } from 'pg';
import type { CanalAprobacion, TipoAprobacion } from '@proveeduria/core';

import type { AprobacionEventoPortal, AprobacionesStore, ListaAprobacionesPortal } from './types.js';

interface AprobacionRow {
  readonly id: string;
  readonly tipo: TipoAprobacion;
  readonly aprobadoPorId: string;
  readonly aprobadoPorNombre: string;
  readonly canal: CanalAprobacion;
  readonly detalle: unknown;
  readonly at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapAprobacion(row: AprobacionRow): AprobacionEventoPortal {
  return {
    id: row.id,
    tipo: row.tipo,
    aprobadoPor: { userId: row.aprobadoPorId, nombre: row.aprobadoPorNombre },
    canal: row.canal,
    detalle: row.detalle,
    at: iso(row.at),
  };
}

const SELECT_APROBACION =
  'SELECT ae.id, ae.tipo, ae.aprobado_por AS "aprobadoPorId", u.nombre AS "aprobadoPorNombre", ' +
  'ae.canal, ae.detalle, ae.at ' +
  'FROM approval_events ae JOIN users u ON u.id = ae.aprobado_por';

export class PgAprobacionesStore implements AprobacionesStore {
  constructor(private readonly pool: Pool) {}

  async historial(pedidoId: string): Promise<ListaAprobacionesPortal | null> {
    const pedido = await this.pool.query<{ id: string }>('SELECT id FROM pedidos WHERE id = $1', [pedidoId]);
    if (pedido.rows[0] === undefined) return null;

    const result = await this.pool.query<AprobacionRow>(
      `${SELECT_APROBACION} WHERE ae.pedido_id = $1 ORDER BY ae.at DESC, ae.created_at DESC`,
      [pedidoId],
    );
    return { items: result.rows.map(mapAprobacion) };
  }
}

interface FakeAprobacionRow {
  id: string;
  pedidoId: string;
  tipo: TipoAprobacion;
  aprobadoPorId: string;
  aprobadoPorNombre: string;
  canal: CanalAprobacion;
  detalle: unknown;
  at: Date;
}

/** Fake en memoria para tests de rutas (patron `FakeProveedoresStore`/`FakeRevisionesStore`). */
export class FakeAprobacionesStore implements AprobacionesStore {
  private readonly pedidos = new Set<string>();
  private readonly eventos: FakeAprobacionRow[] = [];
  private seq = 1;

  agregarPedido(pedidoId: string): void {
    this.pedidos.add(pedidoId);
  }

  agregarEvento(input: {
    readonly id?: string;
    readonly pedidoId: string;
    readonly tipo: TipoAprobacion;
    readonly aprobadoPorId: string;
    readonly aprobadoPorNombre: string;
    readonly canal: CanalAprobacion;
    readonly detalle?: unknown;
    readonly at?: Date;
  }): string {
    this.pedidos.add(input.pedidoId);
    const id = input.id ?? `aprobacion-${this.seq}`;
    this.seq += 1;
    this.eventos.push({
      id,
      pedidoId: input.pedidoId,
      tipo: input.tipo,
      aprobadoPorId: input.aprobadoPorId,
      aprobadoPorNombre: input.aprobadoPorNombre,
      canal: input.canal,
      detalle: input.detalle ?? null,
      at: input.at ?? new Date(),
    });
    return id;
  }

  async historial(pedidoId: string): Promise<ListaAprobacionesPortal | null> {
    if (!this.pedidos.has(pedidoId)) return null;
    const items = this.eventos
      .filter((e) => e.pedidoId === pedidoId)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((row) => mapAprobacion({
        id: row.id,
        tipo: row.tipo,
        aprobadoPorId: row.aprobadoPorId,
        aprobadoPorNombre: row.aprobadoPorNombre,
        canal: row.canal,
        detalle: row.detalle,
        at: row.at,
      }));
    return { items };
  }
}
