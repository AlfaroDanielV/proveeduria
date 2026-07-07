/**
 * Cola de trabajo del webhook. El hilo del webhook solo ENCOLA un job liviano
 * (referencia al `inbound_messages` ya persistido); el procesamiento de IA/OCR y la
 * maquina de estados corren en apps/worker (EXECUTION_PLAN §1-2).
 *
 * La cola se aisla detras de `QueueClient` (cookbook §1.4): `InMemoryQueue` para
 * tests, `AzureStorageQueue` (stub) para prod. Cambiar el backend no toca el ingest.
 */

/** Job encolado por cada `inbound_messages` recien insertado. */
export interface TrabajoIngesta {
  readonly wamid: string;
  readonly from: string;
  readonly tipo: string;
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

export interface AzureStorageQueueOpciones {
  readonly connectionString: string;
  readonly queueName: string;
}

/**
 * STUB de produccion. En el despliegue se implementa con `@azure/storage-queue`
 * (o una `PostgresQueue` basada en `SELECT ... FOR UPDATE SKIP LOCKED`), encolando
 * el `TrabajoIngesta` serializado. Se deja tras la interfaz para no acoplar el
 * ingest al backend concreto (cookbook §1.4). Instanciarlo y usarlo lanza a
 * proposito hasta implementarlo.
 */
export class AzureStorageQueue implements QueueClient {
  constructor(private readonly opciones: AzureStorageQueueOpciones) {}

  async enqueue(_job: TrabajoIngesta): Promise<void> {
    throw new Error(
      `AzureStorageQueue.enqueue no implementado (stub) para cola '${this.opciones.queueName}'; ` +
        'ver DEPLOYMENT_COOKBOOK §1.4',
    );
  }
}
