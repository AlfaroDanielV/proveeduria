/**
 * Dispatcher del outbox (docs/specs/outbox-whatsapp.md).
 *
 * Ciclo claim -> send -> mark en TRANSACCIONES SEPARADAS: el claim marca un batch como
 * `enviando` (lease por `claimed_at`, `intentos+1`) en una tx corta; el envio corre fuera
 * de toda transaccion (nunca se sostienen locks durante HTTP); y cada resultado se marca
 * en su propia tx corta (`enviado` / `fallido` con backoff / `descartado` terminal con
 * audit). Filas `enviando` cuyo lease vencio (crash a mitad de envio) son reclamables.
 *
 * Garantia: at-least-once. Un crash entre el accept de Meta y el mark puede duplicar UN
 * envio tras vencer el lease; el `intentos+1` del claim lo acota a `max_intentos`.
 *
 * Taxonomia de errores del sender (`ErrorEnvio`): `permanente` -> descartado inmediato;
 * `rate_limit` -> fallido con max(Retry-After, backoff) y el resto del batch se libera
 * (revirtiendo el intento del claim); `transitorio` (y todo throw no tipado) -> fallido
 * con backoff exponencial, o descartado si agoto `max_intentos`.
 */

import type { Tx } from '@proveeduria/agent';
import type { TransactionRunner } from '../domain/types.js';

export interface OutboxMessagePendiente {
  readonly id: string;
  readonly destino: string;
  readonly template: string | null;
  readonly texto: string | null;
  readonly payload: unknown;
  /** Intentos INCLUYENDO el actual (el claim ya lo incremento). */
  readonly intentos: number;
  readonly maxIntentos: number;
  /** Documento a adjuntar (header de plantilla); se activa con B4. */
  readonly attachmentId: string | null;
}

export type TipoErrorEnvio = 'permanente' | 'rate_limit' | 'transitorio';

/** Error tipado que el sender lanza para que el dispatcher decida el destino de la fila. */
export class ErrorEnvio extends Error {
  readonly tipo: TipoErrorEnvio;
  readonly codigo: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    tipo: TipoErrorEnvio,
    mensaje: string,
    opciones: { readonly codigo?: number; readonly retryAfterMs?: number } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorEnvio';
    this.tipo = tipo;
    this.codigo = opciones.codigo;
    this.retryAfterMs = opciones.retryAfterMs;
  }
}

/** Normaliza cualquier throw del sender a `ErrorEnvio` (no tipado = transitorio). */
export function clasificarErrorEnvio(error: unknown): ErrorEnvio {
  if (error instanceof ErrorEnvio) return error;
  return new ErrorEnvio(
    'transitorio',
    error instanceof Error ? error.message : String(error),
  );
}

export interface OutboxSender {
  enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }>;
}

export interface ReclamarInput {
  readonly ahora: Date;
  /** Filas `enviando` con `claimed_at` anterior a este instante se reclaman (lease vencido). */
  readonly leaseVencidoAntesDe: Date;
  readonly limit: number;
}

export interface OutboxStore {
  /** Claim: pendientes + fallidos vencidos + enviando con lease vencido -> `enviando`. */
  reclamar(input: ReclamarInput): Promise<readonly OutboxMessagePendiente[]>;
  marcarEnviado(id: string, wamidSalida: string): Promise<void>;
  marcarFallido(id: string, nextRetryAt: Date, errorUltimo: string): Promise<void>;
  /** Terminal: marca `descartado` y registra `audit_event(outbox_descartado)`. */
  marcarDescartado(
    message: OutboxMessagePendiente,
    errorUltimo: string,
    ahora: Date,
  ): Promise<void>;
  /** Devuelve filas reclamadas no intentadas a `pendiente`, revirtiendo el intento del claim. */
  liberar(ids: readonly string[]): Promise<void>;
}

interface OutboxRow {
  readonly id: string;
  readonly destino: string;
  readonly template: string | null;
  readonly texto: string | null;
  readonly payload: unknown;
  readonly intentos: number;
  readonly max_intentos: number;
  readonly attachment_id: string | null;
}

function mapOutbox(row: OutboxRow): OutboxMessagePendiente {
  return {
    id: row.id,
    destino: row.destino,
    template: row.template,
    texto: row.texto,
    payload: row.payload,
    intentos: row.intentos,
    maxIntentos: row.max_intentos,
    attachmentId: row.attachment_id,
  };
}

/** Extrae `payload.pedido_id` si viene como string no vacio (para el audit de descarte). */
function pedidoIdDePayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const valor = (payload as Record<string, unknown>).pedido_id;
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

export class PgOutboxStore implements OutboxStore {
  constructor(private readonly tx: Tx) {}

  async reclamar(input: ReclamarInput): Promise<readonly OutboxMessagePendiente[]> {
    const result = await this.tx.query<OutboxRow>(
      'UPDATE outbox_messages SET estado = $4, claimed_at = $1, intentos = intentos + 1 ' +
        'WHERE id IN (' +
        'SELECT id FROM outbox_messages ' +
        "WHERE estado = 'pendiente' " +
        "OR (estado = 'fallido' AND (next_retry_at IS NULL OR next_retry_at <= $1)) " +
        "OR (estado = 'enviando' AND claimed_at IS NOT NULL AND claimed_at <= $2) " +
        'ORDER BY created_at ASC, id ASC ' +
        'FOR UPDATE SKIP LOCKED ' +
        'LIMIT $3' +
        ') ' +
        'RETURNING id, destino, template, texto, payload, intentos, max_intentos, attachment_id',
      [input.ahora, input.leaseVencidoAntesDe, input.limit, 'enviando'],
    );
    return result.rows.map(mapOutbox);
  }

  async marcarEnviado(id: string, wamidSalida: string): Promise<void> {
    await this.tx.query(
      "UPDATE outbox_messages SET estado = 'enviado', wamid_salida = $2, " +
        'next_retry_at = NULL, claimed_at = NULL, error_ultimo = NULL WHERE id = $1',
      [id, wamidSalida],
    );
  }

  async marcarFallido(id: string, nextRetryAt: Date, errorUltimo: string): Promise<void> {
    await this.tx.query(
      "UPDATE outbox_messages SET estado = 'fallido', next_retry_at = $2, " +
        'claimed_at = NULL, error_ultimo = $3 WHERE id = $1',
      [id, nextRetryAt, errorUltimo],
    );
  }

  async marcarDescartado(
    message: OutboxMessagePendiente,
    errorUltimo: string,
    ahora: Date,
  ): Promise<void> {
    await this.tx.query(
      "UPDATE outbox_messages SET estado = 'descartado', next_retry_at = NULL, " +
        'claimed_at = NULL, error_ultimo = $2 WHERE id = $1',
      [message.id, errorUltimo],
    );
    await this.tx.query(
      'INSERT INTO audit_events ' +
        '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
        'VALUES (null, true, $1, $2, $3, $4, null, $5::jsonb, $6, $7)',
      [
        'outbox_descartado',
        'outbox_message',
        message.id,
        pedidoIdDePayload(message.payload),
        JSON.stringify({
          destino: message.destino,
          template: message.template,
          intentos: message.intentos,
          error: errorUltimo,
        }),
        // 'system': unico origen valido para procesos del worker (check de audit_events).
        'system',
        ahora,
      ],
    );
  }

  async liberar(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.query(
      "UPDATE outbox_messages SET estado = 'pendiente', claimed_at = NULL, " +
        "intentos = greatest(intentos - 1, 0) WHERE id = ANY($1) AND estado = 'enviando'",
      [ids],
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
  /** Lease del claim; filas `enviando` mas viejas que esto se reclaman. */
  readonly claimLeaseMs?: number;
}

export interface ResultadoDespachoOutbox {
  readonly tomados: number;
  readonly enviados: number;
  readonly fallidos: number;
  readonly descartados: number;
}

/** `min(retryBaseMs * 2^(intentos-1), retryMaxMs)`; `intentos` ya incluye el actual. */
function backoffMs(intentos: number, retryBaseMs: number, retryMaxMs: number): number {
  return Math.min(retryBaseMs * 2 ** Math.max(0, intentos - 1), retryMaxMs);
}

export async function despacharOutbox(
  deps: DespacharOutboxDeps,
): Promise<ResultadoDespachoOutbox> {
  const now = deps.ahora?.() ?? new Date();
  const limit = deps.limit ?? 20;
  const retryBaseMs = deps.retryBaseMs ?? 60_000;
  const retryMaxMs = deps.retryMaxMs ?? 15 * 60_000;
  const claimLeaseMs = deps.claimLeaseMs ?? 300_000;
  const store = (tx: Tx): OutboxStore => deps.store?.(tx) ?? new PgOutboxStore(tx);

  // 1) Claim en tx corta propia.
  const mensajes = await deps.runner.run((tx) =>
    store(tx).reclamar({
      ahora: now,
      leaseVencidoAntesDe: new Date(now.getTime() - claimLeaseMs),
      limit,
    }),
  );

  let enviados = 0;
  let fallidos = 0;
  let descartados = 0;

  for (let i = 0; i < mensajes.length; i += 1) {
    const mensaje = mensajes[i] as OutboxMessagePendiente;
    let resultado: { readonly wamidSalida: string };
    try {
      // 2) Envio FUERA de toda transaccion.
      resultado = await deps.sender.enviar(mensaje);
    } catch (error) {
      const err = clasificarErrorEnvio(error);
      const detalle = err.codigo !== undefined ? `[${err.codigo}] ${err.message}` : err.message;

      if (err.tipo === 'permanente') {
        await deps.runner.run((tx) => store(tx).marcarDescartado(mensaje, detalle, now));
        descartados += 1;
        continue;
      }

      if (err.tipo === 'rate_limit') {
        const delay = Math.max(
          err.retryAfterMs ?? 0,
          backoffMs(mensaje.intentos, retryBaseMs, retryMaxMs),
        );
        await deps.runner.run((tx) =>
          store(tx).marcarFallido(mensaje.id, new Date(now.getTime() + delay), detalle),
        );
        fallidos += 1;
        // No martillar a Meta: liberar el resto del batch y cortar el ciclo.
        const resto = mensajes.slice(i + 1).map((m) => m.id);
        if (resto.length > 0) {
          await deps.runner.run((tx) => store(tx).liberar(resto));
        }
        break;
      }

      // transitorio
      if (mensaje.intentos >= mensaje.maxIntentos) {
        await deps.runner.run((tx) =>
          store(tx).marcarDescartado(mensaje, `intentos agotados: ${detalle}`, now),
        );
        descartados += 1;
      } else {
        const delay = backoffMs(mensaje.intentos, retryBaseMs, retryMaxMs);
        await deps.runner.run((tx) =>
          store(tx).marcarFallido(mensaje.id, new Date(now.getTime() + delay), detalle),
        );
        fallidos += 1;
      }
      continue;
    }

    // 3) Mark en tx corta propia.
    await deps.runner.run((tx) => store(tx).marcarEnviado(mensaje.id, resultado.wamidSalida));
    enviados += 1;
  }

  return { tomados: mensajes.length, enviados, fallidos, descartados };
}
