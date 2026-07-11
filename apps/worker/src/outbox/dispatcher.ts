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
 *
 * Ventana 24h (docs/specs/agente-conversacional.md §A4, reemplaza el fallback pasivo por
 * error 131047 de Meta): antes de aceptar para envio una fila de SESION LIBRE
 * (`texto != null && template === null`), se consulta si `destino` tiene una conversacion
 * con `ventana_24h_expira_at > ahora`; si no, se descarta de inmediato
 * (`error_ultimo = 'ventana_24h_cerrada'`, mismo camino de `marcarDescartado` que un error
 * permanente, cuenta en `descartados`). Las plantillas (`template != null`) se envian
 * siempre, sin consultar la ventana. Decision de costura: `OutboxStore` gana
 * `ventanaVigentePorDestino`, respaldado en `PgOutboxStore` por
 * `ConversacionRepo.ventanaVigente` de `@proveeduria/agent` (misma `Tx` que el claim, por lo
 * que la lectura ocurre en la MISMA transaccion que reclama el batch) en vez de un
 * `VentanaStore` inyectado aparte en `despacharOutbox`: evita una dependencia nueva en la
 * firma de `despacharOutbox` y reusa una sola fuente de verdad (la tabla `conversations`)
 * para esta lectura, igual que la usa el handler de dominio (A4) al hacer el upsert.
 */

import { PgConversacionRepo } from '@proveeduria/agent';
import type { ConversacionRepo, Tx } from '@proveeduria/agent';
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
  /**
   * Ventana 24h activa (agente-conversacional.md §A4) del `destino`: `true` si existe una
   * conversacion con `ventana_24h_expira_at > ahora`. Solo se consulta para filas de sesion
   * libre (`texto != null && template === null`); las plantillas nunca la consultan.
   */
  ventanaVigentePorDestino(destino: string, ahora: Date): Promise<boolean>;
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
  private readonly conversaciones: ConversacionRepo;

  constructor(private readonly tx: Tx) {
    this.conversaciones = new PgConversacionRepo(tx);
  }

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

  async ventanaVigentePorDestino(destino: string, ahora: Date): Promise<boolean> {
    return this.conversaciones.ventanaVigente(destino, ahora);
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

/** Error terminal (agente-conversacional.md §A4) cuando la ventana 24h del destino cerro. */
const ERROR_VENTANA_24H_CERRADA = 'ventana_24h_cerrada';

/** Sesion libre = candidata a la prevencion activa de ventana 24h (spec §A4). */
function esSesionLibre(mensaje: OutboxMessagePendiente): boolean {
  return mensaje.texto !== null && mensaje.template === null;
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

  // 1) Claim en tx corta propia. En la MISMA tx (misma lectura indexada, spec §A4) se
  // descartan de inmediato las filas de sesion libre cuya ventana 24h ya cerro: nunca
  // llegan al sender ni al batch devuelto.
  const claim = await deps.runner.run(async (tx) => {
    const s = store(tx);
    const reclamados = await s.reclamar({
      ahora: now,
      leaseVencidoAntesDe: new Date(now.getTime() - claimLeaseMs),
      limit,
    });

    const aceptados: OutboxMessagePendiente[] = [];
    let descartadosPorVentana = 0;
    for (const mensaje of reclamados) {
      if (esSesionLibre(mensaje) && !(await s.ventanaVigentePorDestino(mensaje.destino, now))) {
        await s.marcarDescartado(mensaje, ERROR_VENTANA_24H_CERRADA, now);
        descartadosPorVentana += 1;
        continue;
      }
      aceptados.push(mensaje);
    }

    return { tomados: reclamados.length, aceptados, descartadosPorVentana };
  });

  const mensajes = claim.aceptados;
  let enviados = 0;
  let fallidos = 0;
  let descartados = claim.descartadosPorVentana;

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

  return { tomados: claim.tomados, enviados, fallidos, descartados };
}
