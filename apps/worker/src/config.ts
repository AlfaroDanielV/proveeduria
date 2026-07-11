/**
 * Configuracion del worker leida de variables de entorno.
 *
 * La cadena de Postgres es opcional aqui (solo se valida cuando el handler de dominio la
 * usa); `azureQueueConnection` tambien es opcional — sin ella `index.ts` usa la cola en
 * memoria (solo dev/test), igual que `apps/api` (ver docs/specs/broker-colas.md
 * §Configuracion). Mantener el parseo aislado aqui facilita el arranque parametrizable en
 * `index.ts` y en tests.
 */

/**
 * Modo del dispatcher de outbox del worker.
 * - `off` (default): el dispatcher NO corre.
 * - `console`: SOLO dev. Un loop de polling marca los mensajes como `enviado` logueando su
 *   contenido y devolviendo un `wamid_salida` sintetico (`console:<uuid>`); NO envia nada por
 *   WhatsApp.
 * - `meta`: envio real contra Meta WhatsApp Cloud API (`MetaOutboxSender`, ver
 *   docs/specs/outbox-whatsapp.md). Requiere `META_PHONE_NUMBER_ID` y `META_ACCESS_TOKEN`
 *   (falla-cerrado, ver `cargarConfig`).
 */
export type OutboxMode = 'off' | 'console' | 'meta';

export interface WorkerConfig {
  /** Cadena de conexion a Postgres (lock advisory, estado, outbox) — requerida en Fase 2. */
  readonly databaseUrl?: string;
  /** Cadena de conexion de Azure Storage Queues; sin ella el worker usa InMemoryConsumer. */
  readonly azureQueueConnection?: string;
  /** Nombre de la cola a consumir. Debe coincidir con `AZURE_STORAGE_QUEUE_NAME` de apps/api. */
  readonly queueName: string;
  /** Presupuesto de procesamiento por intento antes de que el mensaje reaparezca (segundos). */
  readonly visibilidadSegundos: number;
  /** Umbral de reintentos antes de mandar el mensaje a la cola de veneno. */
  readonly maxDequeue: number;
  /** Espera entre polls cuando la cola esta vacia, en ms (long-poll de produccion). */
  readonly esperaVacioMs: number;
  /** Modo del dispatcher de outbox: `off` (default), `console` (dev) o `meta` (real). */
  readonly outboxMode: OutboxMode;
  /** Intervalo de polling del dispatcher de outbox en ms (aplica en modo `console`/`meta`). */
  readonly outboxPollMs: number;
  /** `phone_number_id` de Meta; requerido en modo `meta`. */
  readonly metaPhoneNumberId?: string;
  /** Access token de Meta (secreto); requerido en modo `meta`. */
  readonly metaAccessToken?: string;
  /** Base del Graph API de Meta. */
  readonly metaGraphUrl: string;
  /**
   * Base publica de `apps/api` para construir links firmados de attachments
   * (`GET /api/attachments/:id?f=<firma>`, ver outbox-whatsapp.md §Documentos adjuntos).
   * Requerida en modo `meta`.
   */
  readonly publicApiUrl?: string;
  /**
   * Secreto HMAC compartido con `apps/api` para firmar/verificar los links de attachments
   * (mismo valor en ambos servicios). Requerido en modo `meta`.
   */
  readonly attachmentsLinkSecret?: string;
  /** Lease del claim del dispatcher, en segundos (`OUTBOX_CLAIM_LEASE_S`). */
  readonly claimLeaseSegundos: number;
  /** Tamano del batch que reclama el dispatcher por ciclo (`OUTBOX_BATCH`). */
  readonly outboxBatch: number;
}

const DEFAULTS = {
  queueName: 'ingesta',
  visibilidadSegundos: 120,
  maxDequeue: 5,
  esperaVacioMs: 1000,
  outboxPollMs: 2000,
  metaGraphUrl: 'https://graph.facebook.com/v23.0',
  claimLeaseSegundos: 300,
  outboxBatch: 20,
} as const;

function parseOutboxMode(raw: string | undefined): OutboxMode {
  const valor = raw?.trim();
  if (valor === 'console') return 'console';
  if (valor === 'meta') return 'meta';
  return 'off';
}

/** Construye la config desde un objeto de entorno (por defecto `process.env`). */
export function cargarConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  const azureQueueConnection = env.AZURE_STORAGE_QUEUE_CONNECTION?.trim();
  const queueName = env.WORKER_QUEUE_NAME?.trim() || DEFAULTS.queueName;
  const visibilidadSegundos = parseEnteroPositivo(
    env.WORKER_VISIBILITY_S,
    DEFAULTS.visibilidadSegundos,
  );
  const maxDequeue = parseEnteroPositivo(env.WORKER_MAX_DEQUEUE, DEFAULTS.maxDequeue);
  const esperaVacioMs = parseEnteroPositivo(env.WORKER_POLL_EMPTY_MS, DEFAULTS.esperaVacioMs);
  const outboxMode = parseOutboxMode(env.WORKER_OUTBOX_MODE);
  const outboxPollMs = parseEnteroPositivo(env.WORKER_OUTBOX_POLL_MS, DEFAULTS.outboxPollMs);
  const metaPhoneNumberId = env.META_PHONE_NUMBER_ID?.trim();
  const metaAccessToken = env.META_ACCESS_TOKEN?.trim();
  const metaGraphUrl = env.META_GRAPH_URL?.trim() || DEFAULTS.metaGraphUrl;
  const publicApiUrl = env.PUBLIC_API_URL?.trim();
  const attachmentsLinkSecret = env.ATTACHMENTS_LINK_SECRET?.trim();
  const claimLeaseSegundos = parseEnteroPositivo(
    env.OUTBOX_CLAIM_LEASE_S,
    DEFAULTS.claimLeaseSegundos,
  );
  const outboxBatch = parseEnteroPositivo(env.OUTBOX_BATCH, DEFAULTS.outboxBatch);

  // Falla-cerrado: en modo `meta` sin credenciales/secretos, el dispatcher arrancaria pero
  // cada envio fallaria (o peor, se descartaria como permanente, o un documento por
  // attachment_id no podria armar su link) — se rechaza al armar la config, igual espiritu
  // que apps/api/src/config.ts. `PUBLIC_API_URL`/`ATTACHMENTS_LINK_SECRET` son necesarios
  // para firmar el link de `GET /api/attachments/:id?f=` (outbox-whatsapp.md §Documentos
  // adjuntos), aunque un envio puntual no lleve documento.
  if (outboxMode === 'meta') {
    const faltantes: string[] = [];
    if (!metaPhoneNumberId) faltantes.push('META_PHONE_NUMBER_ID');
    if (!metaAccessToken) faltantes.push('META_ACCESS_TOKEN');
    if (!publicApiUrl) faltantes.push('PUBLIC_API_URL');
    if (!attachmentsLinkSecret) faltantes.push('ATTACHMENTS_LINK_SECRET');
    if (faltantes.length > 0) {
      throw new Error(
        `Config invalida: WORKER_OUTBOX_MODE=meta requiere ${faltantes.join(', ')}.`,
      );
    }
  }

  return {
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(azureQueueConnection ? { azureQueueConnection } : {}),
    queueName,
    visibilidadSegundos,
    maxDequeue,
    esperaVacioMs,
    outboxMode,
    outboxPollMs,
    ...(metaPhoneNumberId ? { metaPhoneNumberId } : {}),
    ...(metaAccessToken ? { metaAccessToken } : {}),
    metaGraphUrl,
    ...(publicApiUrl ? { publicApiUrl } : {}),
    ...(attachmentsLinkSecret ? { attachmentsLinkSecret } : {}),
    claimLeaseSegundos,
    outboxBatch,
  };
}

function parseEnteroPositivo(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
