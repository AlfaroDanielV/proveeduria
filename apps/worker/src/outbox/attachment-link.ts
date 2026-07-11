/**
 * Firma de links de attachments para el header `document` de una plantilla de WhatsApp
 * (docs/specs/outbox-whatsapp.md §Contenido del mensaje, camino 1: `attachment_id`).
 *
 * Construye `${publicApiUrl}/api/attachments/:id?f=<jwt>` con un JWT HS256 minimo
 * (`sub=attachmentId`, `iat`, `exp`) firmado con `node:crypto` (HMAC-SHA256, base64url).
 *
 * Este modulo SOLO FIRMA. El contrato completo del token (verificacion, formato, algoritmo
 * aceptado) vive en `apps/api/src/portal/crypto.ts` (`firmarJwt`/`verificarJwt`), que sirve
 * `GET /api/attachments/:id?f=<firma>` con el MISMO `ATTACHMENTS_LINK_SECRET`; no se
 * reimplementa aqui la verificacion, solo la firma minima que necesita el sender.
 */

import { createHmac } from 'node:crypto';

/** Vida por defecto del link: 72h, con margen para cubrir los reintentos del dispatcher. */
const VIDA_SEGUNDOS_DEFAULT = 72 * 60 * 60;

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function firmar(contenido: string, secreto: string): string {
  return createHmac('sha256', secreto).update(contenido).digest('base64url');
}

export interface FirmarLinkAttachmentInput {
  readonly attachmentId: string;
  readonly secreto: string;
  readonly ahora: Date;
  /** Vida del link en segundos; default 72h. */
  readonly vidaSegundos?: number;
  readonly publicApiUrl: string;
}

/** Emite el JWT HS256 minimo `{ sub: attachmentId, iat, exp }` firmado con `secreto`. */
function firmarJwtAttachment(attachmentId: string, secreto: string, ahora: Date, vidaSegundos: number): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'));
  const iat = Math.floor(ahora.getTime() / 1000);
  const payload = base64url(
    Buffer.from(JSON.stringify({ sub: attachmentId, iat, exp: iat + vidaSegundos }), 'utf8'),
  );
  const firma = firmar(`${header}.${payload}`, secreto);
  return `${header}.${payload}.${firma}`;
}

/**
 * Construye `${publicApiUrl}/api/attachments/:id?f=<jwt>` para que Meta descargue el
 * documento al entregar la plantilla. `publicApiUrl` sin `/` final es tolerado.
 */
export function firmarLinkAttachment(input: FirmarLinkAttachmentInput): string {
  const vidaSegundos = input.vidaSegundos ?? VIDA_SEGUNDOS_DEFAULT;
  const jwt = firmarJwtAttachment(input.attachmentId, input.secreto, input.ahora, vidaSegundos);
  const base = input.publicApiUrl.endsWith('/') ? input.publicApiUrl.slice(0, -1) : input.publicApiUrl;
  return `${base}/api/attachments/${input.attachmentId}?f=${jwt}`;
}
