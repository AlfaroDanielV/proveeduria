import type { Tx } from '@proveeduria/agent';
import type { TransactionRunner } from '../domain/types.js';

export interface OutboxMessagePendiente {
  readonly id: string;
  readonly destino: string;
  readonly template: string | null;
  readonly texto: string | null;
  readonly payload: unknown;
  readonly intentos: number;
}

export interface OutboxSender {
  enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }>;
}

export interface OutboxStore {
  tomarPendientes(now: Date, limit: number): Promise<readonly OutboxMessagePendiente[]>;
  marcarEnviado(id: string, wamidSalida: string): Promise<void>;
  marcarFallido(id: string, nextRetryAt: Date): Promise<void>;
}

interface OutboxRow {
  readonly id: string;
  readonly destino: string;
  readonly template: string | null;
  readonly texto: string | null;
  readonly payload: unknown;
  readonly intentos: number;
}

function mapOutbox(row: OutboxRow): OutboxMessagePendiente {
  return {
    id: row.id,
    destino: row.destino,
    template: row.template,
    texto: row.texto,
    payload: row.payload,
    intentos: row.intentos,
  };
}

export class PgOutboxStore implements OutboxStore {
  constructor(private readonly tx: Tx) {}

  async tomarPendientes(now: Date, limit: number): Promise<readonly OutboxMessagePendiente[]> {
    const result = await this.tx.query<OutboxRow>(
      'SELECT id, destino, template, texto, payload, intentos ' +
        'FROM outbox_messages ' +
        "WHERE estado IN ('pendiente', 'fallido') " +
        'AND (next_retry_at IS NULL OR next_retry_at <= $1) ' +
        'ORDER BY created_at ASC, id ASC ' +
        'FOR UPDATE SKIP LOCKED ' +
        'LIMIT $2',
      [now, limit],
    );
    return result.rows.map(mapOutbox);
  }

  async marcarEnviado(id: string, wamidSalida: string): Promise<void> {
    await this.tx.query(
      "UPDATE outbox_messages SET estado = 'enviado', wamid_salida = $2, " +
        'intentos = intentos + 1, next_retry_at = NULL WHERE id = $1',
      [id, wamidSalida],
    );
  }

  async marcarFallido(id: string, nextRetryAt: Date): Promise<void> {
    await this.tx.query(
      "UPDATE outbox_messages SET estado = 'fallido', intentos = intentos + 1, " +
        'next_retry_at = $2 WHERE id = $1',
      [id, nextRetryAt],
    );
  }
}

export interface DespacharOutboxDeps {
  readonly runner: TransactionRunner;
  readonly sender: OutboxSender;
  readonly store?: (tx: Tx) => OutboxStore;
  readonly ahora?: () => Date;
  readonly limit?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
}

export interface ResultadoDespachoOutbox {
  readonly tomados: number;
  readonly enviados: number;
  readonly fallidos: number;
}

export async function despacharOutbox(
  deps: DespacharOutboxDeps,
): Promise<ResultadoDespachoOutbox> {
  const now = deps.ahora?.() ?? new Date();
  const limit = deps.limit ?? 20;
  const retryBaseMs = deps.retryBaseMs ?? 60_000;
  const retryMaxMs = deps.retryMaxMs ?? 15 * 60_000;

  return deps.runner.run(async (tx) => {
    const store = deps.store?.(tx) ?? new PgOutboxStore(tx);
    const messages = await store.tomarPendientes(now, limit);
    let enviados = 0;
    let fallidos = 0;

    for (const message of messages) {
      try {
        const result = await deps.sender.enviar(message);
        await store.marcarEnviado(message.id, result.wamidSalida);
        enviados += 1;
      } catch {
        const delay = Math.min(
          retryBaseMs * 2 ** message.intentos,
          retryMaxMs,
        );
        await store.marcarFallido(message.id, new Date(now.getTime() + delay));
        fallidos += 1;
      }
    }

    return {
      tomados: messages.length,
      enviados,
      fallidos,
    };
  });
}
