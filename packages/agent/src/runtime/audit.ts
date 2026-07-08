import type { Actor, AuditEvent, Tx } from './types.js';
import type { OrigenAudit } from '@proveeduria/core';

const SQL_INSERT_AUDIT =
  'INSERT INTO audit_events ' +
  '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
  'VALUES ($1, false, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)';

export function crearAuditInserter(
  tx: Tx,
  actor: Actor,
  ahora: Date,
  origenDefault: OrigenAudit = 'system',
): (event: AuditEvent) => Promise<void> {
  return async (event) => {
    await tx.query(SQL_INSERT_AUDIT, [
      actor.userId,
      event.accion,
      event.entidad,
      event.entidadId ?? null,
      event.pedidoId ?? null,
      JSON.stringify(event.antes ?? null),
      JSON.stringify(event.despues ?? null),
      event.origen ?? origenDefault,
      ahora,
    ]);
  };
}
