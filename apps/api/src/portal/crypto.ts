/**
 * Nucleo criptografico del Centro de Control (docs/specs/control-center.md §Autenticacion).
 *
 * Sin dependencias nuevas: todo sobre node:crypto.
 *  - Passwords: scrypt con salt por usuario, formato VERSIONADO
 *    `scrypt$N$r$p$<salt-b64>$<hash-b64>` — los parametros viajan en el hash, asi un
 *    upgrade futuro de costo no invalida credenciales viejas. Comparacion en tiempo
 *    constante.
 *  - Access token: JWT HS256 firmado y VERIFICADO EN SERVIDOR (a diferencia del legado,
 *    que decodificaba en el cliente sin verificar). Solo claims minimos (`sub`, `iat`,
 *    `exp`); los roles se releen de DB en cada request — el token autentica, no autoriza.
 *  - Refresh token: opaco de 256 bits; solo su sha256 se persiste (`portal_sessions`).
 *
 * Todas las funciones reciben el reloj como parametro (sin `new Date()` interno) para ser
 * testeables y coherentes con la convencion del monorepo.
 */

import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';

// --- Passwords (scrypt) -----------------------------------------------------

/** Parametros por defecto (formato los persiste, asi que son ajustables a futuro). */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      password,
      salt,
      SCRYPT_KEYLEN,
      // maxmem holgado para N=16384*r=8 (~16MB por defecto no alcanza con margen).
      { N: n, r, p, maxmem: 128 * 1024 * 1024 },
      (err, derived) => {
        if (err !== null) reject(err);
        else resolve(derived);
      },
    );
  });
}

/** Hashea un password al formato versionado `scrypt$N$r$p$salt$hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Verifica un password contra un hash almacenado. Formato invalido, parametros absurdos
 * o cualquier fallo interno -> `false` (nunca lanza hacia el flujo de login).
 */
export async function verificarPassword(password: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  // Cotas duras: rechaza parametros no potencia-de-2 o costos fuera de rango razonable
  // (un hash adulterado no debe poder convertir el login en un DoS de memoria/CPU).
  if (!Number.isInteger(n) || n < 1024 || n > 1 << 20 || (n & (n - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > 32) return false;
  if (!Number.isInteger(p) || p < 1 || p > 4) return false;
  let salt: Buffer;
  let esperado: Buffer;
  try {
    salt = Buffer.from(partes[4] as string, 'base64');
    esperado = Buffer.from(partes[5] as string, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || esperado.length === 0) return false;
  let calculado: Buffer;
  try {
    calculado = await scryptAsync(password, salt, n, r, p);
  } catch {
    return false;
  }
  if (calculado.length !== esperado.length) return false;
  return timingSafeEqual(calculado, esperado);
}

// --- JWT HS256 ---------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function firmar(contenido: string, secreto: string): string {
  return createHmac('sha256', secreto).update(contenido).digest('base64url');
}

export interface FirmarJwtInput {
  /** users.id del sujeto autenticado. */
  readonly sub: string;
  readonly secreto: string;
  readonly ahora: Date;
  readonly vidaSegundos: number;
}

/** Emite un JWT HS256 con claims minimos: `sub`, `iat`, `exp`. */
export function firmarJwt(input: FirmarJwtInput): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'));
  const iat = Math.floor(input.ahora.getTime() / 1000);
  const payload = base64url(
    Buffer.from(
      JSON.stringify({ sub: input.sub, iat, exp: iat + input.vidaSegundos }),
      'utf8',
    ),
  );
  const firma = firmar(`${header}.${payload}`, input.secreto);
  return `${header}.${payload}.${firma}`;
}

export interface VerificarJwtInput {
  readonly token: string;
  readonly secreto: string;
  readonly ahora: Date;
}

/**
 * Verifica firma, algoritmo y expiracion. Devuelve `{ sub }` o `null` (nunca lanza).
 * Rechaza cualquier `alg` distinto de HS256 (confusion de algoritmo) y compara la firma
 * en tiempo constante.
 */
export function verificarJwt(input: VerificarJwtInput): { readonly sub: string } | null {
  const partes = input.token.split('.');
  if (partes.length !== 3) return null;
  const [headerB64, payloadB64, firmaB64] = partes as [string, string, string];

  const esperada = firmar(`${headerB64}.${payloadB64}`, input.secreto);
  const bufEsperada = Buffer.from(esperada, 'utf8');
  const bufRecibida = Buffer.from(firmaB64, 'utf8');
  if (bufEsperada.length !== bufRecibida.length) return null;
  if (!timingSafeEqual(bufEsperada, bufRecibida)) return null;

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof header !== 'object' || header === null ||
    (header as Record<string, unknown>).alg !== 'HS256'
  ) {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const claims = payload as Record<string, unknown>;
  if (typeof claims.sub !== 'string' || claims.sub === '') return null;
  if (typeof claims.exp !== 'number') return null;
  if (claims.exp <= Math.floor(input.ahora.getTime() / 1000)) return null;
  return { sub: claims.sub };
}

// --- Refresh token opaco ------------------------------------------------------

/** Genera el refresh opaco (256 bits) y el hash sha256 que se persiste. */
export function generarTokenOpaco(): { readonly token: string; readonly hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashTokenOpaco(token) };
}

/** sha256 hex del token opaco; lo UNICO que toca `portal_sessions.refresh_token_hash`. */
export function hashTokenOpaco(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
