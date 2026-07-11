/**
 * Contrato de la cola que consume el worker + una implementacion en memoria para test.
 *
 * `QueueConsumer` es la interfaz que el loop de `consumer.ts` sabe operar
 * (poll/ack/nack). La implementacion real (`queue/azure.ts`) es un consumidor de Azure
 * Storage Queues que ademas gestiona la cola de veneno `<nombre>-poison`; el lock
 * advisory de Postgres por `pedido_id` lo toma el handler de dominio antes de procesar
 * (ver apps/worker/CLAUDE.md §Invariantes y docs/specs/broker-colas.md).
 *
 * El `Job` NO transporta el efecto de dominio: solo referencia el mensaje entrante ya
 * persistido por `apps/api` (`inbound_messages`, idempotencia por `wamid`). El handler
 * relee `fromPhone`/`tipo`/`payload`/timestamps desde la BD con `FOR UPDATE` — asi no
 * existen copias stale entre broker y BD (docs/specs/broker-colas.md §Formato de mensaje).
 */

/**
 * Unidad de trabajo encolada por `apps/api` tras persistir un `inbound_messages`.
 * Wire del broker: `{ v: 1, wamid, pedidoId? }` (docs/specs/broker-colas.md).
 */
export interface Job {
  /** Id de la entrada en cola (identifica el intento de entrega, no el mensaje). */
  readonly id: string;
  /** wamid del mensaje entrante; clave de idempotencia contra `inbound_messages`. */
  readonly wamid: string;
  /** Numero de intento de procesamiento (arranca en 1); crece con cada nack. */
  readonly intento: number;
  /**
   * Pedido al que pertenece el mensaje, si `apps/api` ya lo resolvio. Gobierna el
   * lock advisory por `pedido_id` que garantiza orden por pedido.
   */
  readonly pedidoId?: string;
}

/**
 * Consumidor de cola: entrega jobs uno a uno y confirma su destino.
 * - `poll()` devuelve el proximo job o `null` si la cola esta vacia.
 * - `ack(job)` confirma procesamiento exitoso (elimina el job de la cola).
 * - `nack(job)` devuelve el job para reintento (con backoff decidido por el loop).
 */
export interface QueueConsumer {
  poll(): Promise<Job | null>;
  ack(job: Job): Promise<void>;
  nack(job: Job): Promise<void>;
}

/**
 * Implementacion en memoria para tests y para el arranque local del stub.
 * NO es apta para produccion: sin durabilidad, sin visibility timeout, sin lock por
 * `pedido_id`. En Fase 2 se reemplaza por el consumidor real (ver arriba).
 */
export class InMemoryConsumer implements QueueConsumer {
  private readonly pendientes: Job[];
  /** Jobs confirmados (ack); expuesto para asercion en tests. */
  readonly reconocidos: Job[] = [];
  /** Jobs devueltos a la cola (nack); expuesto para asercion en tests. */
  readonly devueltos: Job[] = [];

  constructor(jobsIniciales: readonly Job[] = []) {
    this.pendientes = [...jobsIniciales];
  }

  /** Encola un job adicional (util en tests y para el productor local). */
  encolar(job: Job): void {
    this.pendientes.push(job);
  }

  poll(): Promise<Job | null> {
    const job = this.pendientes.shift() ?? null;
    return Promise.resolve(job);
  }

  ack(job: Job): Promise<void> {
    this.reconocidos.push(job);
    return Promise.resolve();
  }

  nack(job: Job): Promise<void> {
    // Reintento inmediato para la impl en memoria: reencola al final con intento+1.
    // El backoff real (next_retry_at / visibility timeout) es responsabilidad del
    // broker en Fase 2; aqui solo preservamos "nunca se pierde el job".
    this.devueltos.push(job);
    this.pendientes.push({ ...job, intento: job.intento + 1 });
    return Promise.resolve();
  }

  /** Cantidad de jobs aun sin entregar (util en tests / condicion de parada del loop). */
  get profundidad(): number {
    return this.pendientes.length;
  }
}
