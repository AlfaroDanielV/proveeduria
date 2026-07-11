import type { Tx } from '@proveeduria/agent';
import type { InboundMessage, InboundMessageRepo } from './types.js';

interface InboundMessageRow {
  readonly id: string;
  readonly wamid: string;
  readonly fromPhone: string | null;
  readonly tipo: string | null;
  readonly payload: unknown;
  readonly receivedAt: Date | string;
  readonly processedAt: Date | string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapInbound(row: InboundMessageRow): InboundMessage {
  return {
    id: row.id,
    wamid: row.wamid,
    fromPhone: row.fromPhone ?? '',
    tipo: row.tipo ?? 'desconocido',
    payload: row.payload,
    receivedAt: toDate(row.receivedAt),
    processedAt: row.processedAt === null ? null : toDate(row.processedAt),
  };
}

export class PgInboundMessageRepo implements InboundMessageRepo {
  constructor(private readonly tx: Tx) {}

  async bloquearPorWamid(wamid: string): Promise<InboundMessage | null> {
    const result = await this.tx.query<InboundMessageRow>(
      'SELECT id, wamid, from_phone AS "fromPhone", tipo, payload, ' +
        'received_at AS "receivedAt", processed_at AS "processedAt" ' +
        'FROM inbound_messages WHERE wamid = $1 FOR UPDATE',
      [wamid],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapInbound(row);
  }

  async marcarProcesado(id: string, at: Date): Promise<void> {
    await this.tx.query(
      'UPDATE inbound_messages SET processed_at = $2 WHERE id = $1',
      [id, at],
    );
  }

  async fijarConversacion(id: string, conversationId: string): Promise<void> {
    await this.tx.query(
      'UPDATE inbound_messages SET conversation_id = $2 WHERE id = $1',
      [id, conversationId],
    );
  }
}
