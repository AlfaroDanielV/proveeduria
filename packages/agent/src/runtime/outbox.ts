import type { OutboxMessage, Tx } from './types.js';

const SQL_INSERT_OUTBOX =
  'INSERT INTO outbox_messages ' +
  '(destino, template, texto, payload, next_retry_at, attachment_id) ' +
  'VALUES ($1, $2, $3, $4::jsonb, $5, $6)';

export function crearOutboxInserter(
  tx: Tx,
): (message: OutboxMessage) => Promise<void> {
  return async (message) => {
    await tx.query(SQL_INSERT_OUTBOX, [
      message.destino,
      message.template ?? null,
      message.texto ?? null,
      JSON.stringify(message.payload ?? null),
      message.nextRetryAt ?? null,
      message.attachmentId ?? null,
    ]);
  };
}
