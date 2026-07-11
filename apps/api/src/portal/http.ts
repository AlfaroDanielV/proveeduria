/**
 * Utilidades HTTP crudas (node:http, sin dependencias) para el portal: parseo de cookies
 * de request y lectura de bodies JSON con limite de tamano.
 *
 * Antes de este bloque solo el webhook leia bodies (index.ts). Las rutas de mutacion del
 * portal (`/api/portal/auth/*`, `/api/portal/usuarios/:id/credenciales`) tambien lo
 * necesitan; los bodies son pequenos (credenciales/identificadores), de ahi el limite bajo.
 */

import type { IncomingMessage } from 'node:http';

/** Limite de tamano de body JSON del portal (credenciales/identificadores: bodies chicos). */
export const MAX_JSON_BODY_BYTES = 65_536; // 64 KiB

export class CuerpoDemasiadoGrandeError extends Error {
  constructor() {
    super('cuerpo demasiado grande');
    this.name = 'CuerpoDemasiadoGrandeError';
  }
}

export class JsonInvalidoError extends Error {
  constructor() {
    super('json invalido');
    this.name = 'JsonInvalidoError';
  }
}

/**
 * Lee el body de `req` y lo parsea como JSON. Body vacio -> `{}` (rutas sin payload
 * obligatorio, ej. logout/refresh). Excede `maxBytes` -> `CuerpoDemasiadoGrandeError`
 * (destruye el socket). JSON invalido -> `JsonInvalidoError`.
 */
export function leerCuerpoJson(
  req: IncomingMessage,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new CuerpoDemasiadoGrandeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new JsonInvalidoError());
      }
    });
    req.on('error', reject);
  });
}

/** Parsea el header `Cookie: a=1; b=2` a un mapa simple. Tolerante a formato invalido. */
export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === '') continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/** Path al que se restringen las cookies de sesion del portal (control-center.md). */
export const COOKIE_PATH = '/api/portal';

export interface CookieOptions {
  /** 0 => instruye al navegador a borrar la cookie de inmediato. */
  readonly maxAgeSeconds: number;
  /** Secure solo cuando NODE_ENV=production (dev sobre http no puede setear Secure). */
  readonly secure: boolean;
}

/** Serializa un `Set-Cookie` httpOnly; SameSite=Strict; Path=/api/portal. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const partes = [
    `${name}=${value}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (options.secure) partes.push('Secure');
  return partes.join('; ');
}

/** `Set-Cookie` que borra la cookie (Max-Age=0, valor vacio). */
export function cookieDeBorrado(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, secure });
}

/** Lee un header que puede venir como string o string[] (headers duplicados). */
export function primerHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (value === undefined) return undefined;
  return value[0];
}
