import type { Actor, ApprovalEvent, Tx } from './types.js';

const SQL_INSERT_APPROVAL =
  'INSERT INTO approval_events ' +
  '(tipo, pedido_id, aprobado_por, canal, detalle, at) ' +
  'VALUES ($1, $2, $3, $4, $5::jsonb, $6)';

export function crearApprovalInserter(
  tx: Tx,
  actor: Actor,
  ahora: Date,
): (event: ApprovalEvent) => Promise<void> {
  return async (event) => {
    await tx.query(SQL_INSERT_APPROVAL, [
      event.tipo,
      event.pedidoId ?? null,
      actor.userId,
      event.canal,
      JSON.stringify(event.detalle ?? null),
      event.at ?? ahora,
    ]);
  };
}
