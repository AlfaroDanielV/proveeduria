/**
 * Aplica `StatusEntrega` (statuses de Meta: `sent|delivered|read|failed`) a
 * `outbox_messages` por `wamid_salida` (docs/specs/outbox-whatsapp.md "Statuses de
 * Meta"; migracion 007 en `packages/db`).
 *
 * UPDATE parametrizado con guard MONOTONICO: `sent < delivered < read` (un status de
 * rango menor no pisa uno mayor, aplicado a la fila DIRECTO en SQL, sin read-then-write
 * — seguro ante statuses concurrentes/fuera de orden de Meta). `failed` SIEMPRE se
 * aplica (no participa del orden) y guarda `errors[]` crudo en `entrega_error`.
 * Idempotente por construccion: reentregar el mismo status re-aplica el mismo UPDATE
 * sin cambio observable.
 *
 * `rowCount === 0` puede significar `wamid_salida` desconocido (trafico del prototipo
 * legado u otro canal que no pasa por este outbox) o un status de rango menor que el
 * guard bloqueo; en ambos casos el llamador lo trata igual: ignorar con log, nunca
 * lanzar (ver `webhook/ingest.ts` `aplicarStatuses`).
 *
 * SQL SIEMPRE parametrizado, nunca por concatenacion de strings.
 *
 * Constructor tipado sobre `Tx` (`@proveeduria/agent`, mismo patron que
 * `portal/repo.ts`: `query<T>(sql, params): Promise<TxResult<T>>`) en vez del `Pool`
 * concreto de `pg`: import SOLO de tipo (se borra en compilacion), y tanto `Pool` como
 * `PoolClient` lo satisfacen estructuralmente sin cast, asi este store sirve igual
 * fuera de una transaccion (`index.ts`, un `Pool`) que dentro de una (tests de
 * integracion con `BEGIN`/`ROLLBACK` sobre un `PoolClient`).
 */

import type { Tx } from '@proveeduria/agent';

import type { EstadoEntrega, StatusEntrega } from '../webhook/parse.js';

export interface EntregaStore {
  /** Aplica un status; `true` si el UPDATE afecto una fila, `false` si se ignoro. */
  aplicarStatus(status: StatusEntrega): Promise<boolean>;
}

/** Orden monotonico de los statuses "de progreso" (`failed` no participa: siempre aplica). */
const RANGOS_ENTREGA: Readonly<Partial<Record<EstadoEntrega, number>>> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

/** `timestamp` de Meta es epoch en SEGUNDOS (string); si falta, se usa el reloj local. */
function fechaDeTimestamp(timestamp: string | undefined): Date {
  if (timestamp === undefined) return new Date();
  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos)) return new Date();
  return new Date(segundos * 1000);
}

const SQL_UPDATE =
  'UPDATE outbox_messages SET ' +
  'entrega_estado = $2, ' +
  'entrega_actualizada_at = $3, ' +
  "entrega_error = CASE WHEN $2 = 'failed' THEN $4::jsonb ELSE entrega_error END " +
  'WHERE wamid_salida = $1 ' +
  'AND (' +
  "  $2 = 'failed'" +
  '  OR entrega_estado IS NULL' +
  '  OR (' +
  "    CASE entrega_estado WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 END" +
  '    <' +
  "    CASE $2 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 END" +
  '  )' +
  ')';

export class PgEntregaStore implements EntregaStore {
  constructor(private readonly db: Tx) {}

  async aplicarStatus(status: StatusEntrega): Promise<boolean> {
    const res = await this.db.query(SQL_UPDATE, [
      status.wamid,
      status.estado,
      fechaDeTimestamp(status.timestamp),
      JSON.stringify(status.errores ?? null),
    ]);
    return res.rowCount === 1;
  }
}

/**
 * Impl en memoria para tests: replica el guard monotonico del SQL sin `pg`.
 *
 * `wamid`s "conocidos" simulan filas existentes de `outbox_messages` (las que tienen
 * `wamid_salida` seteado); un status para un `wamid` no registrado se ignora, igual que
 * el `rowCount === 0` de `PgEntregaStore` ante un `wamid` desconocido.
 */
export class FakeEntregaStore implements EntregaStore {
  private readonly conocidos: Set<string>;
  private readonly estados = new Map<string, EstadoEntrega>();
  private readonly erroresPorWamid = new Map<string, unknown>();
  /** Statuses efectivamente aplicados, en orden (para aserciones de tests). */
  readonly aplicados: StatusEntrega[] = [];

  constructor(wamidsConocidos: Iterable<string> = []) {
    this.conocidos = new Set(wamidsConocidos);
  }

  /** Simula que `outbox_messages` ya tiene una fila con este `wamid_salida`. */
  registrarWamid(wamid: string): void {
    this.conocidos.add(wamid);
  }

  estadoDe(wamid: string): EstadoEntrega | undefined {
    return this.estados.get(wamid);
  }

  erroresDe(wamid: string): unknown {
    return this.erroresPorWamid.get(wamid);
  }

  async aplicarStatus(status: StatusEntrega): Promise<boolean> {
    if (!this.conocidos.has(status.wamid)) return false;

    const actual = this.estados.get(status.wamid);
    if (status.estado !== 'failed' && actual !== undefined) {
      const actualRango = RANGOS_ENTREGA[actual];
      const nuevoRango = RANGOS_ENTREGA[status.estado];
      // `actualRango` es undefined cuando el estado actual es 'failed' (no tiene rango):
      // un status de progreso no pisa un 'failed' ya registrado, igual que en SQL.
      if (actualRango === undefined || nuevoRango === undefined || actualRango >= nuevoRango) {
        return false;
      }
    }

    this.estados.set(status.wamid, status.estado);
    if (status.estado === 'failed') {
      this.erroresPorWamid.set(status.wamid, status.errores ?? null);
    }
    this.aplicados.push(status);
    return true;
  }
}
