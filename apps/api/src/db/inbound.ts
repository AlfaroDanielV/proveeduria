/**
 * Acceso a `inbound_messages` (data-model.md §Mensajeria y operacion).
 *
 * Idempotencia por `wamid`: `INSERT ... ON CONFLICT (wamid) DO NOTHING`; el metodo
 * devuelve `true` SOLO si la fila se inserto (rowCount === 1). El ingest usa ese
 * booleano para encolar una sola vez ante duplicados de Meta (EXECUTION_PLAN §1.3-4).
 *
 * SQL SIEMPRE parametrizado, nunca por concatenacion de strings.
 *
 * `pg` se importa como TIPO (`Pool`, `QueryResult`): el `Pool` se inyecta por
 * constructor, asi que este modulo no carga el runtime de `pg` y los tests pueden
 * usar `FakeInboundStore` sin abrir conexiones.
 */

import type { Pool, QueryResult } from 'pg';

export interface RegistroEntrante {
  readonly wamid: string;
  readonly fromPhone: string;
  readonly tipo: string;
  /** Objeto crudo del mensaje de Meta; se guarda como `payload` jsonb. */
  readonly payload: unknown;
}

export interface InboundStore {
  /** Inserta si el `wamid` es nuevo. `true` = insertado; `false` = duplicado. */
  insertarSiNuevo(reg: RegistroEntrante): Promise<boolean>;
}

const SQL_INSERT =
  'INSERT INTO inbound_messages (wamid, from_phone, tipo, payload, received_at) ' +
  'VALUES ($1, $2, $3, $4::jsonb, now()) ' +
  'ON CONFLICT (wamid) DO NOTHING';

export class PgInboundStore implements InboundStore {
  constructor(private readonly pool: Pool) {}

  async insertarSiNuevo(reg: RegistroEntrante): Promise<boolean> {
    const res: QueryResult = await this.pool.query(SQL_INSERT, [
      reg.wamid,
      reg.fromPhone,
      reg.tipo,
      JSON.stringify(reg.payload ?? null),
    ]);
    return res.rowCount === 1;
  }
}

/** Impl en memoria para tests: dedup por `wamid`, sin `pg`. */
export class FakeInboundStore implements InboundStore {
  private readonly vistos = new Set<string>();
  readonly registros: RegistroEntrante[] = [];

  async insertarSiNuevo(reg: RegistroEntrante): Promise<boolean> {
    if (this.vistos.has(reg.wamid)) return false;
    this.vistos.add(reg.wamid);
    this.registros.push(reg);
    return true;
  }
}
