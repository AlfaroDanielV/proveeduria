/**
 * Consumidor real de Azure Storage Queues (docs/specs/broker-colas.md §Consumidor).
 *
 * Contrato de wire: `{ v: 1, wamid, pedidoId? }` en JSON UTF-8 codificado en base64
 * (convencion de Azure Storage Queues). `intento = dequeueCount`. Mensajes malformados
 * (base64/JSON invalido, `v` desconocida, `wamid` vacio) o agotados (`dequeueCount >
 * maxDequeue`) se copian a la cola de veneno `<queueName>-poison` y se borran del
 * original — nunca se lanzan ni se pierden.
 *
 * El `popReceipt` es interno del consumidor (no viaja en `Job`): se guarda en un mapa
 * `id -> popReceipt` que `ack`/`nack` consultan y limpian.
 */

import { QueueClient } from '@azure/storage-queue';
import type { Job, QueueConsumer } from './index.js';

/** Mensaje recibido de una cola de Azure Storage Queue, ya "dequeued". */
export interface AzureQueueMessage {
  readonly messageId: string;
  readonly popReceipt: string;
  readonly messageText: string;
  readonly dequeueCount: number;
}

/**
 * Subconjunto de `QueueClient` (@azure/storage-queue) que el consumidor necesita.
 * El `QueueClient` real lo satisface estructuralmente; en tests se inyecta un fake sin
 * red que implementa solo esta forma.
 */
export interface AzureQueueClientLike {
  createIfNotExists(): Promise<unknown>;
  receiveMessages(options: {
    numberOfMessages: number;
    visibilityTimeout: number;
  }): Promise<{ receivedMessageItems: readonly AzureQueueMessage[] }>;
  sendMessage(messageText: string): Promise<unknown>;
  deleteMessage(messageId: string, popReceipt: string): Promise<unknown>;
  updateMessage(
    messageId: string,
    popReceipt: string,
    message?: string,
    visibilityTimeout?: number,
  ): Promise<unknown>;
}

export interface AzureQueueConsumerOpciones {
  /** Cadena de conexion de Azure Storage Queues; ignorada si se inyectan clientes de test. */
  readonly connectionString: string;
  /** Nombre de la cola de ingesta (la de veneno se deriva como `<queueName>-poison`). */
  readonly queueName: string;
  /** Visibility timeout por intento, en segundos (`WORKER_VISIBILITY_S`). */
  readonly visibilidadSegundos: number;
  /** Umbral de `dequeueCount` antes de mandar a la cola de veneno (`WORKER_MAX_DEQUEUE`). */
  readonly maxDequeue: number;
  /** Cliente de la cola principal inyectable (tests); default: `QueueClient` real. */
  readonly principalClient?: AzureQueueClientLike;
  /** Cliente de la cola de veneno inyectable (tests); default: `QueueClient` real. */
  readonly poisonClient?: AzureQueueClientLike;
}

interface MensajeWire {
  readonly wamid: string;
  readonly pedidoId?: string;
}

/** Decodifica y valida el wire `{ v: 1, wamid, pedidoId? }`; `null` si es invalido. */
function decodificarWire(base64: string): MensajeWire | null {
  let json: string;
  try {
    json = Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return null;
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof obj !== 'object' || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  if (rec.v !== 1) return null;
  if (typeof rec.wamid !== 'string' || rec.wamid.trim() === '') return null;

  const pedidoId = typeof rec.pedidoId === 'string' && rec.pedidoId.trim() !== ''
    ? rec.pedidoId
    : undefined;

  return { wamid: rec.wamid, ...(pedidoId !== undefined ? { pedidoId } : {}) };
}

/** `min(300, 5 * 2^(intento-1))` segundos (docs/specs/broker-colas.md §Consumidor). */
export function backoffSegundos(intento: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, intento - 1));
}

export class AzureQueueConsumer implements QueueConsumer {
  private readonly principal: AzureQueueClientLike;
  private readonly poison: AzureQueueClientLike;
  private readonly visibilidadSegundos: number;
  private readonly maxDequeue: number;
  private readonly popReceipts = new Map<string, string>();
  private colasListas: Promise<void> | undefined;

  constructor(opciones: AzureQueueConsumerOpciones) {
    this.principal = opciones.principalClient
      ?? new QueueClient(opciones.connectionString, opciones.queueName);
    this.poison = opciones.poisonClient
      ?? new QueueClient(opciones.connectionString, `${opciones.queueName}-poison`);
    this.visibilidadSegundos = opciones.visibilidadSegundos;
    this.maxDequeue = opciones.maxDequeue;
  }

  private asegurarColas(): Promise<void> {
    this.colasListas ??= Promise.all([
      this.principal.createIfNotExists(),
      this.poison.createIfNotExists(),
    ]).then(() => undefined);
    return this.colasListas;
  }

  async poll(): Promise<Job | null> {
    await this.asegurarColas();

    // Descarta mensajes malformados/agotados en el mismo poll: nunca se propagan al
    // handler ni se pierden (siempre veneno + delete), hasta encontrar uno valido o
    // vaciar la cola.
    for (;;) {
      const respuesta = await this.principal.receiveMessages({
        numberOfMessages: 1,
        visibilityTimeout: this.visibilidadSegundos,
      });
      const item = respuesta.receivedMessageItems[0];
      if (item === undefined) return null;

      if (item.dequeueCount > this.maxDequeue) {
        await this.enviarAVeneno(item);
        continue;
      }

      const wire = decodificarWire(item.messageText);
      if (wire === null) {
        await this.enviarAVeneno(item);
        continue;
      }

      this.popReceipts.set(item.messageId, item.popReceipt);
      return {
        id: item.messageId,
        wamid: wire.wamid,
        intento: item.dequeueCount,
        ...(wire.pedidoId !== undefined ? { pedidoId: wire.pedidoId } : {}),
      };
    }
  }

  async ack(job: Job): Promise<void> {
    const popReceipt = this.popReceipts.get(job.id);
    this.popReceipts.delete(job.id);
    if (popReceipt === undefined) return;
    await this.principal.deleteMessage(job.id, popReceipt);
  }

  async nack(job: Job): Promise<void> {
    const popReceipt = this.popReceipts.get(job.id);
    this.popReceipts.delete(job.id);
    if (popReceipt === undefined) return;

    try {
      await this.principal.updateMessage(
        job.id,
        popReceipt,
        undefined,
        backoffSegundos(job.intento),
      );
    } catch {
      // Se traga el error: la visibilidad expira sola y el mensaje reaparece
      // (docs/specs/broker-colas.md §Consumidor).
    }
  }

  private async enviarAVeneno(item: AzureQueueMessage): Promise<void> {
    await this.poison.sendMessage(item.messageText);
    await this.principal.deleteMessage(item.messageId, item.popReceipt);
  }
}
