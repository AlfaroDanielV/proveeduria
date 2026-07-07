/**
 * Configuracion de apps/api leida de variables de entorno.
 *
 * Falla-cerrado: si falta cualquier secreto requerido, `cargarConfig` lanza y el
 * proceso no arranca. Nunca se procesa un webhook sin app secret ni verify token
 * (EXECUTION_PLAN §1; apps/api/CLAUDE.md "Fallar-cerrado").
 *
 * Funcion pura sobre el objeto `env` recibido (por defecto `process.env`), para
 * poder testearla sin tocar el entorno real.
 */

export interface Config {
  /** Meta App Secret; clave del HMAC de `X-Hub-Signature-256`. */
  readonly metaAppSecret: string;
  /** Token del handshake GET (`hub.verify_token`). */
  readonly metaVerifyToken: string;
  /** Cadena de conexion a PostgreSQL. */
  readonly databaseUrl: string;
  /** Puerto HTTP del ingress. */
  readonly port: number;
  /** Entorno de ejecucion; `production` activa la validacion estricta de cola. */
  readonly nodeEnv: string;
  /** Cadena de conexion de la cola de ingesta (Azure Storage Queue); undefined en dev. */
  readonly queueConnection: string | undefined;
  /** Nombre de la cola de ingesta. */
  readonly queueName: string;
  /** Permite InMemoryQueue de forma explicita (solo dev/test); nunca en prod real. */
  readonly allowInMemoryQueue: boolean;
}

const REQUERIDAS = ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'DATABASE_URL'] as const;

const PUERTO_DEFAULT = 8080;

function estaVacio(v: string | undefined): boolean {
  return v === undefined || v.trim() === '';
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const faltantes = REQUERIDAS.filter((k) => estaVacio(env[k]));
  if (faltantes.length > 0) {
    throw new Error(
      `Config invalida: faltan variables de entorno requeridas: ${faltantes.join(', ')}`,
    );
  }

  let port = PUERTO_DEFAULT;
  const portRaw = env.PORT;
  if (!estaVacio(portRaw)) {
    const raw = (portRaw as string).trim();
    const n = Number.parseInt(raw, 10);
    // Estricto: rechaza sufijos no numericos ('8080abc') ademas del rango.
    if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new Error(`Config invalida: PORT no es un puerto valido: ${String(portRaw)}`);
    }
    port = n;
  }

  const nodeEnv = estaVacio(env.NODE_ENV) ? 'development' : (env.NODE_ENV as string).trim();
  const queueConnection = estaVacio(env.AZURE_STORAGE_QUEUE_CONNECTION)
    ? undefined
    : (env.AZURE_STORAGE_QUEUE_CONNECTION as string).trim();
  const queueName = estaVacio(env.AZURE_STORAGE_QUEUE_NAME)
    ? 'ingesta'
    : (env.AZURE_STORAGE_QUEUE_NAME as string).trim();
  const allowInMemoryQueue = (env.ALLOW_INMEMORY_QUEUE ?? '').trim().toLowerCase() === 'true';

  // Falla-cerrado: en produccion sin cola real, los jobs irian a una cola en memoria que
  // ningun worker consume -> perdida silenciosa de mensajes (rompe persist->encola->worker,
  // EXECUTION_PLAN §1.2). Solo se admite InMemoryQueue en dev/test o con flag explicito.
  if (queueConnection === undefined && nodeEnv === 'production' && !allowInMemoryQueue) {
    throw new Error(
      'Config invalida: en produccion se requiere AZURE_STORAGE_QUEUE_CONNECTION ' +
        '(o ALLOW_INMEMORY_QUEUE=true de forma explicita para entornos de prueba).',
    );
  }

  // Los valores ya se validaron no-vacios en `faltantes`; el `!` es seguro.
  return {
    metaAppSecret: env.META_APP_SECRET!,
    metaVerifyToken: env.META_VERIFY_TOKEN!,
    databaseUrl: env.DATABASE_URL!,
    port,
    nodeEnv,
    queueConnection,
    queueName,
    allowInMemoryQueue,
  };
}
