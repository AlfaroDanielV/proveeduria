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

import { randomBytes } from 'node:crypto';

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
  /**
   * Secreto HS256 de los JWT de sesion del portal (docs/specs/control-center.md
   * §Autenticacion). Requerido y fallo-cerrado en produccion; en dev/test, si falta, se
   * genera uno efimero (no sobrevive reinicios) con warning explicito.
   */
  readonly portalJwtSecret: string;
  /**
   * Origen exacto habilitado para CORS con credenciales del portal (`PORTAL_ORIGIN`).
   * Si no esta definido, la API no emite headers CORS (solo acceso same-origin).
   */
  readonly portalOrigin: string | undefined;
  /**
   * Secreto HS256 compartido api/worker para los links firmados de adjuntos
   * (docs/specs/outbox-whatsapp.md §Documentos adjuntos): el worker firma
   * `sub=attachmentId` con este mismo secreto al armar el link del header de plantilla, y
   * `GET /api/attachments/:id?f=<firma>` lo verifica. Mismo patron que `portalJwtSecret`:
   * fallo-cerrado en produccion; en dev/test, si falta, se genera uno efimero con warning.
   */
  readonly attachmentsLinkSecret: string;
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

  // PORTAL_JWT_SECRET: fallo-cerrado en produccion (sin secreto no hay JWT verificable).
  // En dev/test, si falta, se genera un secreto efimero en memoria: las sesiones no
  // sobreviven un reinicio del proceso, pero el servidor arranca para desarrollo local.
  let portalJwtSecret: string;
  if (!estaVacio(env.PORTAL_JWT_SECRET)) {
    portalJwtSecret = (env.PORTAL_JWT_SECRET as string).trim();
  } else if (nodeEnv === 'production') {
    throw new Error(
      'Config invalida: en produccion se requiere PORTAL_JWT_SECRET (Key Vault en Azure).',
    );
  } else {
    portalJwtSecret = randomBytes(32).toString('base64url');
    // eslint-disable-next-line no-console
    console.warn(
      'PORTAL_JWT_SECRET no definido: usando un secreto efimero generado en memoria. ' +
        'Las sesiones del portal NO sobreviven un reinicio del proceso. Definilo en el ' +
        'entorno antes de produccion.',
    );
  }

  const portalOrigin = estaVacio(env.PORTAL_ORIGIN) ? undefined : (env.PORTAL_ORIGIN as string).trim();

  // ATTACHMENTS_LINK_SECRET: mismo patron exacto que PORTAL_JWT_SECRET (fallo-cerrado en
  // produccion; efimero con warning en dev/test).
  let attachmentsLinkSecret: string;
  if (!estaVacio(env.ATTACHMENTS_LINK_SECRET)) {
    attachmentsLinkSecret = (env.ATTACHMENTS_LINK_SECRET as string).trim();
  } else if (nodeEnv === 'production') {
    throw new Error(
      'Config invalida: en produccion se requiere ATTACHMENTS_LINK_SECRET (Key Vault en Azure).',
    );
  } else {
    attachmentsLinkSecret = randomBytes(32).toString('base64url');
    // eslint-disable-next-line no-console
    console.warn(
      'ATTACHMENTS_LINK_SECRET no definido: usando un secreto efimero generado en memoria. ' +
        'Los links de adjuntos firmados antes de un reinicio del proceso dejan de ser ' +
        'verificables. Definilo en el entorno antes de produccion.',
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
    portalJwtSecret,
    portalOrigin,
    attachmentsLinkSecret,
  };
}
