/**
 * Handler minimo de Fase 1.
 *
 * Cierra el lazo "job entra -> handler lo procesa -> ack" produciendo un unico efecto
 * placeholder: un log estructurado. No toca BD, no llama al agente, no envia WhatsApp.
 *
 * TODO(Fase 2): reemplazar por el motor de dominio real. El handler de produccion, dentro
 * de UNA transaccion por job, debe:
 *   1. Verificar idempotencia (`inbound_messages.processed_at`); si ya esta procesado, ack.
 *   2. Tomar el lock advisory por `pedido_id` (orden por pedido; ver consumer.ts).
 *   3. Enrutar el remitente (interno | proveedor | desconocido E11) via @proveeduria/agent
 *      (ContextoRemitente) y ejecutar el loop del agente Claude + tools.
 *   4. Aplicar transiciones SOLO via @proveeduria/core (state-machine) y reglas E1..E13.
 *   5. Insertar cualquier envio en `outbox_messages` en la misma transaccion (nunca envio
 *      directo) y marcar `inbound_messages.processed_at`.
 * Cualquier fallo transitorio se propaga (throw) para que el loop haga nack + backoff.
 */

import type { Job } from '../queue/index.js';

/** Contrato de un handler de jobs. En Fase 2 habra un handler de dominio que lo cumpla. */
export interface JobHandler {
  manejar(job: Job): Promise<void>;
}

/** Sink de logging inyectable (facilita asercion en tests sin capturar stdout). */
export interface LogSink {
  info(evento: string, datos: Record<string, unknown>): void;
}

/** Sink por defecto: log estructurado a stdout en una linea JSON. */
export const consoleLogSink: LogSink = {
  info(evento, datos) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ nivel: 'info', evento, ...datos }));
  },
};

/**
 * Crea el handler echo de Fase 1. El efecto es un log estructurado con la referencia del
 * job; deliberadamente no realiza trabajo de dominio.
 */
export function crearEchoHandler(log: LogSink = consoleLogSink): JobHandler {
  return {
    manejar(job: Job): Promise<void> {
      log.info('job.echo', {
        jobId: job.id,
        wamid: job.wamid,
        fromPhone: job.fromPhone,
        tipo: job.tipo,
        intento: job.intento,
        ...(job.pedidoId !== undefined ? { pedidoId: job.pedidoId } : {}),
        // TODO(Fase 2): aqui iria el resultado real del motor de dominio, no un placeholder.
        efecto: 'placeholder',
      });
      return Promise.resolve();
    },
  };
}
