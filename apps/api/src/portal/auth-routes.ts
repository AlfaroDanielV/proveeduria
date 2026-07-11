/**
 * Handlers puros de autenticacion del portal (docs/specs/control-center.md
 * §Autenticacion; docs/specs/portal-api.md §Autenticacion C1).
 *
 * Puros/testeables con fakes: no tocan `node:http` ni Postgres directamente. La capa
 * impura (routes.ts / index.ts) les inyecta `AuthStore`, `PortalStore` y el resto de
 * dependencias, y decide si una operacion necesita una transaccion real (solo
 * `emitirCredenciales`, ver deps.emitirCredenciales).
 */

import { randomInt } from 'node:crypto';

import type { AuthStore, CredencialAuthStore } from './auth-store.js';
import {
  firmarJwt,
  generarTokenOpaco,
  hashPassword,
  hashTokenOpaco,
  verificarPassword,
} from './crypto.js';
import { cookieDeBorrado, serializeCookie } from './http.js';
import type { LimitadorLogin } from './rate-limit.js';
import type { PortalActor, PortalStore } from './types.js';

export const COOKIE_TOKEN = 'portal_token';
export const COOKIE_REFRESH = 'portal_refresh';
export const VIDA_TOKEN_SEGUNDOS = 15 * 60;
export const VIDA_REFRESH_SEGUNDOS = 7 * 24 * 60 * 60;
const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Password temporal legible (>=12 caracteres, sin ambiguos 0/O 1/l/I), crypto.randomInt. */
export function generarPasswordTemporalLegible(longitud = 14): string {
  let out = '';
  for (let i = 0; i < longitud; i += 1) {
    out += PASSWORD_CHARSET[randomInt(PASSWORD_CHARSET.length)];
  }
  return out;
}

export interface AuthResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body?: unknown;
}

export interface EmitirCredencialesInput {
  readonly actorUserId: string;
  readonly targetUserId: string;
  readonly passwordHash: string;
  readonly ahora: Date;
}

export interface AuthRouteDeps {
  readonly authStore: AuthStore;
  readonly portalStore: PortalStore;
  readonly portalJwtSecret: string;
  readonly esProduccion: boolean;
  readonly ahora: () => Date;
  /** Genera y persiste la credencial + audit `credencial_emitida` en la MISMA operacion. */
  readonly emitirCredenciales: (input: EmitirCredencialesInput) => Promise<void>;
  readonly generarPasswordTemporal?: () => string;
  /** Rate limit de login por identificador + IP (control-center.md); opcional en tests. */
  readonly limitadorLogin?: LimitadorLogin;
}

/** Contexto por-request del login (lo arma la capa de rutas). */
export interface ContextoLogin {
  readonly userAgent: string | null;
  readonly ip: string | null;
}

function json(status: number, body: unknown): AuthResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
}

function sinContenido(status: number): AuthResponse {
  return { status, headers: {} };
}

function conCookies(resp: AuthResponse, cookies: readonly string[]): AuthResponse {
  return { ...resp, headers: { ...resp.headers, 'set-cookie': [...cookies] } };
}

function fallaLoginUniforme(): AuthResponse {
  return json(401, { error: 'credenciales_invalidas' });
}

// Hash fijo (calculado una sola vez, perezosamente) contra el que se compara cuando el
// identificador no existe: evita que el tiempo de respuesta de login delate si un
// usuario existe (misma cantidad de trabajo de scrypt en ambos casos).
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('___credencial_inexistente___');
  return dummyHashPromise;
}

function cookiesSesion(
  token: string,
  refresh: string,
  esProduccion: boolean,
): readonly string[] {
  return [
    serializeCookie(COOKIE_TOKEN, token, { maxAgeSeconds: VIDA_TOKEN_SEGUNDOS, secure: esProduccion }),
    serializeCookie(COOKIE_REFRESH, refresh, { maxAgeSeconds: VIDA_REFRESH_SEGUNDOS, secure: esProduccion }),
  ];
}

async function emitirSesion(
  actor: PortalActor,
  deps: AuthRouteDeps,
  ahora: Date,
  userAgent: string | null,
): Promise<{ readonly token: string; readonly refresh: string }> {
  const token = firmarJwt({
    sub: actor.userId,
    secreto: deps.portalJwtSecret,
    ahora,
    vidaSegundos: VIDA_TOKEN_SEGUNDOS,
  });
  const { token: refresh, hash } = generarTokenOpaco();
  await deps.authStore.crearSesion({
    userId: actor.userId,
    refreshTokenHash: hash,
    expiresAt: new Date(ahora.getTime() + VIDA_REFRESH_SEGUNDOS * 1000),
    userAgent,
  });
  return { token, refresh };
}

function comoTextoNoVacio(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export async function manejarLogin(
  body: unknown,
  contexto: ContextoLogin,
  deps: AuthRouteDeps,
): Promise<AuthResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const identificador = comoTextoNoVacio(b.identificador);
  const password = comoTextoNoVacio(b.password);
  if (identificador === null || password === null) return fallaLoginUniforme();

  // Rate limit ANTES de cualquier trabajo de scrypt (defensa de fuerza bruta y de CPU).
  const ahora = deps.ahora();
  const claveId = `id:${identificador.trim().toLowerCase()}`;
  const claveIp = contexto.ip !== null ? `ip:${contexto.ip}` : null;
  const limitador = deps.limitadorLogin;
  if (
    limitador !== undefined &&
    (limitador.porIdentificador.bloqueado(claveId, ahora) ||
      (claveIp !== null && limitador.porIp.bloqueado(claveIp, ahora)))
  ) {
    return json(429, { error: 'demasiados_intentos' });
  }

  const credencial: CredencialAuthStore | null = await deps.authStore.credencialPorIdentificador(
    identificador.trim(),
  );
  const hashParaComparar = credencial?.passwordHash ?? (await dummyHash());
  const passwordOk = await verificarPassword(password, hashParaComparar);
  if (credencial === null || !passwordOk) {
    if (limitador !== undefined) {
      limitador.porIdentificador.registrarFallo(claveId, ahora);
      if (claveIp !== null) limitador.porIp.registrarFallo(claveIp, ahora);
    }
    return fallaLoginUniforme();
  }

  const actor = await deps.portalStore.usuarioPorId(credencial.userId);
  if (actor === null) return fallaLoginUniforme();

  if (limitador !== undefined) {
    limitador.porIdentificador.registrarExito(claveId);
  }

  const { token, refresh } = await emitirSesion(actor, deps, ahora, contexto.userAgent);

  return conCookies(
    json(200, { user: actor, mustChangePassword: credencial.mustChangePassword }),
    cookiesSesion(token, refresh, deps.esProduccion),
  );
}

export async function manejarRefresh(
  cookies: Readonly<Record<string, string>>,
  deps: AuthRouteDeps,
): Promise<AuthResponse> {
  const refreshCookie = cookies[COOKIE_REFRESH];
  if (refreshCookie === undefined) return json(401, { error: 'refresh_invalido' });

  const ahora = deps.ahora();
  const sesion = await deps.authStore.sesionPorHash(hashTokenOpaco(refreshCookie), ahora);
  if (sesion === null) return json(401, { error: 'refresh_invalido' });

  // Rotacion: la sesion vieja queda revocada antes de emitir el nuevo par.
  await deps.authStore.revocarSesion(sesion.id, ahora);

  const token = firmarJwt({
    sub: sesion.userId,
    secreto: deps.portalJwtSecret,
    ahora,
    vidaSegundos: VIDA_TOKEN_SEGUNDOS,
  });
  const { token: refresh, hash } = generarTokenOpaco();
  await deps.authStore.crearSesion({
    userId: sesion.userId,
    refreshTokenHash: hash,
    expiresAt: new Date(ahora.getTime() + VIDA_REFRESH_SEGUNDOS * 1000),
    userAgent: null,
  });

  return conCookies(json(200, {}), cookiesSesion(token, refresh, deps.esProduccion));
}

export async function manejarLogout(
  cookies: Readonly<Record<string, string>>,
  deps: AuthRouteDeps,
): Promise<AuthResponse> {
  const refreshCookie = cookies[COOKIE_REFRESH];
  if (refreshCookie !== undefined) {
    const ahora = deps.ahora();
    const sesion = await deps.authStore.sesionPorHash(hashTokenOpaco(refreshCookie), ahora);
    if (sesion !== null) await deps.authStore.revocarSesion(sesion.id, ahora);
  }
  return conCookies(sinContenido(204), [
    cookieDeBorrado(COOKIE_TOKEN, deps.esProduccion),
    cookieDeBorrado(COOKIE_REFRESH, deps.esProduccion),
  ]);
}

export async function manejarCambiarPassword(
  actor: PortalActor,
  body: unknown,
  deps: AuthRouteDeps,
): Promise<AuthResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const passwordActual = comoTextoNoVacio(b.passwordActual);
  const passwordNueva = comoTextoNoVacio(b.passwordNueva);
  if (passwordActual === null || passwordNueva === null) {
    return json(400, { error: 'request_invalido', message: 'passwordActual y passwordNueva son requeridos.' });
  }
  if (passwordNueva.length < PASSWORD_MIN_LENGTH) {
    return json(400, {
      error: 'request_invalido',
      message: `passwordNueva debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    });
  }

  const credencial = await deps.authStore.credencialPorUserId(actor.userId);
  if (credencial === null) return json(401, { error: 'credenciales_invalidas' });
  const ok = await verificarPassword(passwordActual, credencial.passwordHash);
  if (!ok) return json(401, { error: 'credenciales_invalidas' });

  const ahora = deps.ahora();
  const nuevoHash = await hashPassword(passwordNueva);
  await deps.authStore.actualizarPassword(actor.userId, nuevoHash);

  // "Revoca las demas sesiones" (portal-api.md): todas las sesiones existentes del
  // usuario, incluida la que hizo este request, quedan invalidas; el cliente debe volver
  // a autenticarse con la password nueva (no hay nocion de "sesion actual" preservada).
  await deps.authStore.revocarSesionesDeUsuario(actor.userId, ahora);

  return sinContenido(204);
}

export async function manejarEmitirCredenciales(
  actor: PortalActor,
  targetUserId: string,
  body: unknown,
  deps: AuthRouteDeps,
): Promise<AuthResponse> {
  if (!actor.roles.includes('superadmin')) return json(403, { error: 'rol_insuficiente' });

  const target = await deps.portalStore.usuarioPorId(targetUserId);
  if (target === null) return json(404, { error: 'usuario_no_encontrado' });

  const b = (body ?? {}) as Record<string, unknown>;
  const provisto = comoTextoNoVacio(b.passwordTemporal);
  if (provisto !== null && provisto.length < PASSWORD_MIN_LENGTH) {
    return json(400, {
      error: 'request_invalido',
      message: `passwordTemporal debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    });
  }
  const generador = deps.generarPasswordTemporal ?? generarPasswordTemporalLegible;
  const passwordTemporal = provisto ?? generador();

  const passwordHash = await hashPassword(passwordTemporal);
  const ahora = deps.ahora();
  await deps.emitirCredenciales({
    actorUserId: actor.userId,
    targetUserId,
    passwordHash,
    ahora,
  });

  // Solo se devuelve en claro cuando el servidor la genero (nunca se re-emite la del cliente).
  return json(200, provisto === null ? { passwordTemporal } : {});
}
