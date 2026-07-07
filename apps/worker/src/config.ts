/**
 * Configuracion del worker leida de variables de entorno.
 *
 * Fase 1: el stub navegable no abre conexiones reales, asi que la cadena de Postgres es
 * opcional (solo se validara cuando el handler de dominio la use en Fase 2). Mantener el
 * parseo aislado aqui facilita el arranque parametrizable en `index.ts` y en tests.
 */

export interface WorkerConfig {
  /** Cadena de conexion a Postgres (lock advisory, estado, outbox) — requerida en Fase 2. */
  readonly databaseUrl?: string;
  /** Nombre de la cola a consumir (broker de Fase 2). */
  readonly queueName: string;
  /** Espera entre polls cuando la cola esta vacia, en ms (long-poll de produccion). */
  readonly esperaVacioMs: number;
}

const DEFAULTS = {
  queueName: 'proveeduria-inbound',
  esperaVacioMs: 1000,
} as const;

/** Construye la config desde un objeto de entorno (por defecto `process.env`). */
export function cargarConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  const queueName = env.WORKER_QUEUE_NAME?.trim() || DEFAULTS.queueName;
  const esperaVacioMs = parseEnteroPositivo(env.WORKER_POLL_EMPTY_MS, DEFAULTS.esperaVacioMs);

  return {
    ...(databaseUrl ? { databaseUrl } : {}),
    queueName,
    esperaVacioMs,
  };
}

function parseEnteroPositivo(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
