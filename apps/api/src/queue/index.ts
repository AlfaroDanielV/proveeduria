/**
 * Cola de trabajo del webhook. El hilo del webhook solo ENCOLA un job liviano
 * (referencia al `inbound_messages` ya persistido); el procesamiento de IA/OCR y la
 * maquina de estados corren en apps/worker (EXECUTION_PLAN §1-2).
 *
 * Contrato de transporte: docs/specs/broker-colas.md. La cola se aisla detras de
 * `QueueClient` (cookbook §1.4): `InMemoryQueue` para tests, `AzureStorageQueue` para
 * prod. Cambiar el backend no toca el ingest.
 */

import { QueueClient as ClienteAzureQueueSDK } from '@azure/storage-queue';

/**
 * Job encolado por cada `inbound_messages` recien insertado.
 *
 * Adelgazado a solo `wamid` (docs/specs/broker-colas.md "Formato de mensaje"): el job
 * NUNCA transporta el efecto de dominio. El worker relee `fromPhone`/`tipo`/`payload`
 * desde `inbound_messages` con `FOR UPDATE` para evitar copias stale entre el broker y
 * la base de datos.
 */
export interface TrabajoIngesta {
  readonly wamid: string;
}

export interface QueueClient {
  /** Empuja un job. At-least-once: la idempotencia se garantiza por `wamid`. */
  enqueue(job: TrabajoIngesta): Promise<void>;
}

/** Impl en memoria para tests: expone `jobs` para aserciones. No usar en prod. */
export class InMemoryQueue implements QueueClient {
  readonly jobs: TrabajoIngesta[] = [];

  async enqueue(job: TrabajoIngesta): Promise<void> {
    this.jobs.push(job);
  }
}

/** Version del contrato de wire (docs/specs/broker-colas.md "Formato de mensaje"). */
const VERSION_WIRE = 1;

/**
 * Superficie minima del cliente subyacente de Azure Storage Queues que consumimos.
 * Permite inyectar un fake en tests unitarios sin abrir socket ni requerir
 * credenciales reales; el `QueueClient` real de `@azure/storage-queue` la satisface
 * estructuralmente (tiene estos metodos, con parametros adicionales opcionales).
 */
export interface AzureQueueClienteSubyacente {
  createIfNotExists(): Promise<unknown>;
  sendMessage(mensajeBase64: string): Promise<unknown>;
}

export interface AzureStorageQueueOpciones {
  readonly connectionString: string;
  readonly queueName: string;
  /**
   * Cliente subyacente inyectable (para tests unitarios sin red). Si se omite, se
   * crea un `QueueClient` real de `@azure/storage-queue` con `connectionString` y
   * `queueName` (comportamiento de produccion por defecto).
   */
  readonly cliente?: AzureQueueClienteSubyacente;
}

/**
 * Productor real sobre Azure Storage Queues (docs/specs/broker-colas.md "Productor").
 *
 * - `createIfNotExists` se invoca una unica vez por instancia: la promesa se memoiza
 *   en el primer `enqueue` y las llamadas siguientes la reutilizan sin volver a
 *   golpear la red.
 * - `enqueue` serializa el wire `{ v: 1, wamid }` a JSON UTF-8 y lo codifica en
 *   base64 (convencion de Azure Storage Queues) antes de `sendMessage`.
 * - **Sin reintentos internos**: si `createIfNotExists` o `sendMessage` fallan, la
 *   excepcion sube tal cual. El webhook responde 500 y Meta reintenta la entrega;
 *   esto es seguro porque el `wamid` ya quedo persistido y deduplicado en
 *   `inbound_messages` antes de encolar (un reintento de Meta no vuelve a encolar,
 *   ver `webhook/ingest.ts`). Reintentar aqui dentro solo alentaria el hilo del
 *   webhook, que debe mantenerse rapido.
 */
export class AzureStorageQueue implements QueueClient {
  private readonly cliente: AzureQueueClienteSubyacente;
  private colaLista: Promise<unknown> | undefined;

  constructor(opciones: AzureStorageQueueOpciones) {
    this.cliente =
      opciones.cliente ?? new ClienteAzureQueueSDK(opciones.connectionString, opciones.queueName);
  }

  private asegurarCola(): Promise<unknown> {
    if (this.colaLista === undefined) {
      this.colaLista = this.cliente.createIfNotExists();
    }
    return this.colaLista;
  }

  async enqueue(job: TrabajoIngesta): Promise<void> {
    await this.asegurarCola();
    const wire = { v: VERSION_WIRE, wamid: job.wamid };
    const mensajeBase64 = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64');
    await this.cliente.sendMessage(mensajeBase64);
  }
}
