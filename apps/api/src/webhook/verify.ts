/**
 * Verificacion criptografica del webhook de WhatsApp. Funciones PURAS (sin IO).
 *
 * Controles NO negociables (apps/api/CLAUDE.md §1-2; EXECUTION_PLAN §1):
 *  - Firma `X-Hub-Signature-256` = `sha256=HMAC_SHA256(appSecret, rawBody)` sobre el
 *    CUERPO CRUDO (bytes), comparada en tiempo constante (`crypto.timingSafeEqual`).
 *  - GET de verificacion (`hub.mode=subscribe`): validar `hub.verify_token` (tambien en
 *    tiempo constante) y devolver `hub.challenge`.
 *
 * Falla-cerrado: firma/secreto ausente o invalido -> rechazo (false / null).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compara dos cadenas en tiempo constante. Devuelve `false` de inmediato si las
 * longitudes difieren (esa diferencia no es secreta).
 */
function igualesConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verifica la firma HMAC-SHA256 del cuerpo CRUDO.
 *
 * @param rawBody  Bytes exactos recibidos (nunca el JSON re-serializado).
 * @param header   Valor de `X-Hub-Signature-256` (`sha256=<hex>`); '' si ausente.
 * @param appSecret Meta App Secret.
 */
export function verificarFirma(rawBody: Buffer, header: string, appSecret: string): boolean {
  if (appSecret.length === 0) return false;
  if (typeof header !== 'string' || header.length === 0) return false;

  const [esquema, hex] = header.split('=');
  if (esquema !== 'sha256' || hex === undefined || hex.length === 0) return false;

  const provista = Buffer.from(hex, 'hex');
  if (provista.length === 0) return false;

  const esperada = createHmac('sha256', appSecret).update(rawBody).digest();
  // `timingSafeEqual` exige igual longitud; un hex mal formado no llega aca.
  if (provista.length !== esperada.length) return false;

  return timingSafeEqual(esperada, provista);
}

export interface ParamsChallenge {
  readonly mode?: string | undefined;
  readonly token?: string | undefined;
  readonly challenge?: string | undefined;
}

/**
 * Valida el handshake GET de suscripcion de Meta.
 * @returns el `challenge` a devolver si es valido; `null` si debe rechazarse.
 */
export function verificarChallenge(params: ParamsChallenge, verifyToken: string): string | null {
  if (verifyToken.length === 0) return null;
  if (params.mode !== 'subscribe') return null;
  if (typeof params.token !== 'string' || !igualesConstante(params.token, verifyToken)) {
    return null;
  }
  if (typeof params.challenge !== 'string' || params.challenge.length === 0) return null;
  return params.challenge;
}
