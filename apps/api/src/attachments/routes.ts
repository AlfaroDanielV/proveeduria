/**
 * `GET /api/attachments/:id?f=<firma>` — descarga publica del PDF de OC (u otro adjunto)
 * que Meta usa como header de documento de la plantilla `oc_emitida`
 * (docs/specs/outbox-whatsapp.md §Contenido del mensaje / §Documentos adjuntos).
 *
 * SIN cookie de sesion, SIN CORS: Meta descarga este link directo al enviar la plantilla,
 * no hay navegador de por medio. La unica autenticacion es la firma `f`: un JWT HS256
 * (`verificarJwt` de `../portal/crypto.js`, REUSADO tal cual) con `sub = attachmentId`,
 * vida corta (72h por defecto, cubre reintentos del dispatcher del outbox).
 *
 * Regla dura (no filtrar existencia): CUALQUIER fallo -- falta `f`, firma invalida o
 * expirada, `claims.sub` distinto del `:id` de la URL, `:id` mal formado, adjunto sin blob
 * -- responde el MISMO 404 sin cuerpo. Nunca 400/401/403 que revele cual paso fallo.
 *
 * Funciones puras (`resolverAttachmentsRequest`) + una glue impura
 * (`manejarAttachmentsApi`) que lee la URL real y escribe la respuesta, mismo patron que
 * `portal/routes.ts`.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { firmarJwt, verificarJwt } from '../portal/crypto.js';
import type { AttachmentBlobStore } from './store.js';

export const RUTA_ATTACHMENTS_PREFIX = '/api/attachments/';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Vida por defecto del link firmado: 72h (outbox-whatsapp.md), cubre reintentos del dispatcher. */
const VIDA_SEGUNDOS_DEFAULT = 72 * 3600;

/**
 * Firma el link de descarga de un adjunto (`f`). El worker firma con este MISMO metodo y
 * el MISMO `ATTACHMENTS_LINK_SECRET` compartido (docs/specs/outbox-whatsapp.md) al armar
 * `GET {PUBLIC_API_URL}/api/attachments/:id?f=<firma>` para el header de documento de la
 * plantilla; este helper tambien es el que usan los tests de este modulo para construir
 * una firma valida sin duplicar la logica de `firmarJwt`.
 */
export function firmarLinkAttachment(
  attachmentId: string,
  secreto: string,
  ahora: Date,
  vidaSegundos: number = VIDA_SEGUNDOS_DEFAULT,
): string {
  return firmarJwt({ sub: attachmentId, secreto, ahora, vidaSegundos });
}

export interface AttachmentsRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
}

export interface AttachmentsResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  /** Ausente en 404 y en respuestas a HEAD. */
  readonly body?: Buffer;
}

export interface AttachmentsDeps {
  readonly store: AttachmentBlobStore;
  readonly secreto: string;
  readonly ahora: () => Date;
}

function noEncontrado(): AttachmentsResponse {
  return { status: 404, headers: {} };
}

/**
 * Resuelve una request de adjuntos. Pura (sin IO real salvo `store.obtener`, inyectado):
 * `null` => la ruta no es de adjuntos (el llamador debe seguir probando otras rutas).
 */
export async function resolverAttachmentsRequest(
  req: AttachmentsRequest,
  deps: AttachmentsDeps,
): Promise<AttachmentsResponse | null> {
  if (!req.pathname.startsWith(RUTA_ATTACHMENTS_PREFIX)) return null;

  if (req.method !== 'GET' && req.method !== 'HEAD') return noEncontrado();

  const id = req.pathname.slice(RUTA_ATTACHMENTS_PREFIX.length);
  if (id === '' || !UUID_RE.test(id)) return noEncontrado();

  const f = req.searchParams.get('f');
  if (f === null || f === '') return noEncontrado();

  const claims = verificarJwt({ token: f, secreto: deps.secreto, ahora: deps.ahora() });
  if (claims === null) return noEncontrado();
  // La firma es especifica de ESTE adjunto: un `f` valido de otro `sub` no sirve aqui
  // (evita reusar la firma de un adjunto para descargar otro).
  if (claims.sub !== id) return noEncontrado();

  const blob = await deps.store.obtener(id);
  if (blob === null) return noEncontrado();

  const headers: Record<string, string> = {
    'content-type': blob.contentType ?? 'application/octet-stream',
    'content-length': String(blob.bytes.length),
    // Nunca cacheado por intermediarios: el link es firmado y de un solo destinatario.
    'cache-control': 'private, max-age=0',
  };

  if (req.method === 'HEAD') return { status: 200, headers };
  return { status: 200, headers, body: blob.bytes };
}

/**
 * Glue impura: parsea la URL real, delega a `resolverAttachmentsRequest` y escribe la
 * respuesta cruda (bytes, no JSON). `false` => la ruta no era de adjuntos; el llamador
 * (`index.ts`) sigue con el resto del routing (portal, luego webhook).
 */
export async function manejarAttachmentsApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AttachmentsDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith(RUTA_ATTACHMENTS_PREFIX)) return false;

  const response = await resolverAttachmentsRequest(
    { method: req.method ?? 'GET', pathname: url.pathname, searchParams: url.searchParams },
    deps,
  );
  if (response === null) return false;

  res.writeHead(response.status, response.headers);
  if (response.body === undefined) {
    res.end();
  } else {
    res.end(response.body);
  }
  return true;
}
