/**
 * Helpers compartidos por los tests de rutas del portal (no es un `*.test.ts`: no corre
 * como suite, vitest solo colecta `src/**\/*.test.ts`).
 */
import { firmarJwt } from './crypto.js';
import { COOKIE_TOKEN } from './auth-routes.js';

export const TEST_JWT_SECRET = 'secreto-de-pruebas-portal';

export function firmarTokenDePrueba(
  userId: string,
  opciones: { readonly secreto?: string; readonly ahora?: Date; readonly vidaSegundos?: number } = {},
): string {
  return firmarJwt({
    sub: userId,
    secreto: opciones.secreto ?? TEST_JWT_SECRET,
    ahora: opciones.ahora ?? new Date(),
    vidaSegundos: opciones.vidaSegundos ?? 900,
  });
}

export function cookieHeader(nombreValor: Record<string, string>): string {
  return Object.entries(nombreValor)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function cookiePortalToken(userId: string, opciones?: Parameters<typeof firmarTokenDePrueba>[1]): string {
  return cookieHeader({ [COOKIE_TOKEN]: firmarTokenDePrueba(userId, opciones) });
}
