import { beforeAll, describe, expect, it } from 'vitest';

import { resolverPortalRequest } from './routes.js';
import type { PortalDeps, PortalRequest, PortalResponse } from './routes.js';
import { FakeAuthStore } from './auth-store.js';
import { FakeProveedoresStore } from './proveedores-store.js';
import { FakeRevisionesStore } from './revisiones-store.js';
import { FakeAprobacionesStore } from './aprobaciones-store.js';
import type { EmitirCredencialesInput } from './auth-routes.js';
import { COOKIE_REFRESH, COOKIE_TOKEN } from './auth-routes.js';
import { crearLimitadorLogin } from './rate-limit.js';
import { hashPassword } from './crypto.js';
import { cookieHeader, firmarTokenDePrueba, TEST_JWT_SECRET } from './auth-test-helpers.js';
import type {
  ComparativoPortal,
  ListaPedidosPortal,
  ListarPedidosFiltro,
  PedidoDetallePortal,
  PortalActor,
  PortalStore,
} from './types.js';

const ADMIN_ID = '20000000-0000-4000-8000-000000000002';
const SUPERADMIN_ID = '20000000-0000-4000-8000-000000000001';
const TARGET_ID = '20000000-0000-4000-8000-000000000004';
const PASSWORD_ACTUAL = 'clave-actual-123';

const ACTORS: Record<string, PortalActor> = {
  [ADMIN_ID]: {
    userId: ADMIN_ID,
    nombre: 'Jose Pablo',
    email: 'proveeduria@atemporal.cr',
    roles: ['admin_materiales'],
    projectIds: [],
  },
  [SUPERADMIN_ID]: {
    userId: SUPERADMIN_ID,
    nombre: 'Gerencia',
    email: 'gerencia@atemporal.cr',
    roles: ['superadmin'],
    projectIds: [],
  },
  [TARGET_ID]: {
    userId: TARGET_ID,
    nombre: 'Ingeniero de Obra',
    email: 'ingenieria@atemporal.cr',
    roles: ['ingeniero'],
    projectIds: [],
  },
};

class FakePortalStore implements PortalStore {
  async usuarioPorId(userId: string): Promise<PortalActor | null> {
    return ACTORS[userId] ?? null;
  }

  async listarPedidos(_actor: PortalActor, filtro: ListarPedidosFiltro): Promise<ListaPedidosPortal> {
    return { items: [], total: 0, limit: filtro.limit, offset: filtro.offset };
  }

  async detallePedido(): Promise<PedidoDetallePortal | null> {
    return null;
  }

  async comparativoPedido(): Promise<ComparativoPortal | null> {
    return null;
  }
}

function req(partial: Partial<PortalRequest> & { readonly pathname: string }): PortalRequest {
  return {
    method: 'GET',
    searchParams: new URLSearchParams(),
    headers: {},
    cookies: {},
    body: undefined,
    ...partial,
  };
}

function conCsrf(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, 'x-portal-csrf': '1' };
}

interface Deps {
  readonly deps: PortalDeps;
  readonly authStore: FakeAuthStore;
  readonly auditEventos: EmitirCredencialesInput[];
}

const CLOCK = new Date('2026-07-10T12:00:00.000Z');

function construirDeps(overrides: Partial<PortalDeps> = {}): Deps {
  const authStore = new FakeAuthStore();
  authStore.agregarUsuario({ userId: ADMIN_ID, email: 'proveeduria@atemporal.cr', telefonoWhatsapp: '+50688880002' });
  authStore.agregarUsuario({ userId: SUPERADMIN_ID, email: 'gerencia@atemporal.cr' });
  const auditEventos: EmitirCredencialesInput[] = [];

  const deps: PortalDeps = {
    store: new FakePortalStore(),
    authStore,
    portalStore: new FakePortalStore(),
    proveedoresStore: new FakeProveedoresStore(),
    revisionesStore: new FakeRevisionesStore(),
    aprobacionesStore: new FakeAprobacionesStore(),
    ejecutarToolPedido: async () => {
      throw new Error('ejecutarToolPedido no deberia invocarse en estos tests.');
    },
    portalJwtSecret: TEST_JWT_SECRET,
    esProduccion: false,
    ahora: () => CLOCK,
    emitirCredenciales: async (input) => {
      await authStore.crearOResetearCredencial(input.targetUserId, input.passwordHash);
      auditEventos.push(input);
    },
    generarPasswordTemporal: () => 'Temporal12345',
    ...overrides,
  };

  return { deps, authStore, auditEventos };
}

function setCookieValores(resp: PortalResponse): Record<string, string> {
  const raw = resp.headers['set-cookie'];
  const lista = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out: Record<string, string> = {};
  for (const cookie of lista) {
    const [par] = cookie.split(';');
    const [nombre, valor] = (par ?? '').split('=');
    if (nombre !== undefined && valor !== undefined) out[nombre] = valor;
  }
  return out;
}

describe('auth del portal', () => {
  let hashAdmin: string;

  beforeAll(async () => {
    hashAdmin = await hashPassword(PASSWORD_ACTUAL);
  });

  describe('POST /auth/login', () => {
    it('login ok setea cookies portal_token y portal_refresh', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });

      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );

      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ mustChangePassword: false, user: { userId: ADMIN_ID } });
      const cookies = setCookieValores(res!);
      expect(cookies[COOKIE_TOKEN]).toBeTruthy();
      expect(cookies[COOKIE_REFRESH]).toBeTruthy();
    });

    it('propaga mustChangePassword true', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: true });

      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );

      expect(res?.body).toMatchObject({ mustChangePassword: true });
    });

    it('usuario inexistente y password incorrecto responden IGUAL (401 uniforme)', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });

      const usuarioInexistente = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'nadie@nada.com', password: 'lo-que-sea' },
        }),
        deps,
      );
      const passwordMalo = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: 'password-incorrecto' },
        }),
        deps,
      );

      expect(usuarioInexistente?.status).toBe(401);
      expect(passwordMalo?.status).toBe(401);
      expect(usuarioInexistente?.body).toEqual(passwordMalo?.body);
    });

    it('sin header X-Portal-CSRF responde 403', async () => {
      const { deps } = construirDeps();
      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );
      expect(res?.status).toBe(403);
      expect(res?.body).toMatchObject({ error: 'csrf_requerido' });
    });

    it('rate limit: al 6.o fallo el identificador queda bloqueado (429) aun con password correcto', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });
      const depsConLimite = { ...deps, limitadorLogin: crearLimitadorLogin() };
      const intento = (password: string) =>
        resolverPortalRequest(
          req({
            method: 'POST',
            pathname: '/api/portal/auth/login',
            headers: conCsrf(),
            body: { identificador: 'proveeduria@atemporal.cr', password },
          }),
          depsConLimite,
        );

      for (let i = 0; i < 5; i += 1) {
        expect((await intento('password-incorrecto'))?.status).toBe(401);
      }
      // Bloqueado: ni siquiera la password correcta entra hasta que venza la ventana.
      const bloqueado = await intento(PASSWORD_ACTUAL);
      expect(bloqueado?.status).toBe(429);
      expect(bloqueado?.body).toMatchObject({ error: 'demasiados_intentos' });
    });

    it('rate limit: un login exitoso limpia el contador del identificador', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });
      const depsConLimite = { ...deps, limitadorLogin: crearLimitadorLogin() };
      const intento = (password: string) =>
        resolverPortalRequest(
          req({
            method: 'POST',
            pathname: '/api/portal/auth/login',
            headers: conCsrf(),
            body: { identificador: 'proveeduria@atemporal.cr', password },
          }),
          depsConLimite,
        );

      for (let i = 0; i < 4; i += 1) {
        expect((await intento('password-incorrecto'))?.status).toBe(401);
      }
      expect((await intento(PASSWORD_ACTUAL))?.status).toBe(200);
      // El contador quedo limpio: hay margen de nuevo.
      expect((await intento('password-incorrecto'))?.status).toBe(401);
      expect((await intento(PASSWORD_ACTUAL))?.status).toBe(200);
    });
  });

  describe('POST /auth/refresh', () => {
    async function login(deps: PortalDeps): Promise<PortalResponse> {
      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );
      if (res === null || res.status !== 200) throw new Error('login de prueba fallo');
      return res;
    }

    it('rota: el refresh viejo queda invalido tras usarse', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });
      const loginRes = await login(deps);
      const cookiesLogin = setCookieValores(loginRes);

      const refreshRes = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/refresh',
          headers: conCsrf(),
          cookies: { [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]! },
        }),
        deps,
      );
      expect(refreshRes?.status).toBe(200);
      const cookiesRefresh = setCookieValores(refreshRes!);
      expect(cookiesRefresh[COOKIE_REFRESH]).not.toBe(cookiesLogin[COOKIE_REFRESH]);

      // El refresh viejo ya no sirve.
      const segundoIntento = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/refresh',
          headers: conCsrf(),
          cookies: { [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]! },
        }),
        deps,
      );
      expect(segundoIntento?.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revoca la sesion: el refresh usado deja de servir', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });
      const loginRes = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );
      const cookiesLogin = setCookieValores(loginRes!);

      const logoutRes = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/logout',
          headers: conCsrf(),
          cookies: {
            [COOKIE_TOKEN]: cookiesLogin[COOKIE_TOKEN]!,
            [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]!,
          },
        }),
        deps,
      );
      expect(logoutRes?.status).toBe(204);

      const refreshRes = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/refresh',
          headers: conCsrf(),
          cookies: { [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]! },
        }),
        deps,
      );
      expect(refreshRes?.status).toBe(401);
    });
  });

  describe('acceso autenticado', () => {
    it('access token expirado responde 401', async () => {
      const { deps } = construirDeps();
      const tokenVencido = firmarTokenDePrueba(ADMIN_ID, {
        secreto: TEST_JWT_SECRET,
        ahora: new Date(CLOCK.getTime() - 20 * 60 * 1000),
        vidaSegundos: 900,
      });

      const res = await resolverPortalRequest(
        req({
          pathname: '/api/portal/me',
          cookies: { [COOKIE_TOKEN]: tokenVencido },
        }),
        deps,
      );
      expect(res?.status).toBe(401);
    });

    it('sin cookie responde 401', async () => {
      const { deps } = construirDeps();
      const res = await resolverPortalRequest(req({ pathname: '/api/portal/me' }), deps);
      expect(res?.status).toBe(401);
    });

    it('token valido resuelve /me', async () => {
      const { deps } = construirDeps();
      const token = firmarTokenDePrueba(ADMIN_ID, { ahora: CLOCK });
      const res = await resolverPortalRequest(
        req({ pathname: '/api/portal/me', cookies: { [COOKIE_TOKEN]: token } }),
        deps,
      );
      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ user: { userId: ADMIN_ID } });
    });
  });

  describe('POST /usuarios/:userId/credenciales', () => {
    it('403 para admin_materiales (no superadmin)', async () => {
      const { deps } = construirDeps();
      const token = firmarTokenDePrueba(ADMIN_ID, { ahora: CLOCK });
      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: `/api/portal/usuarios/${TARGET_ID}/credenciales`,
          headers: conCsrf(),
          cookies: { [COOKIE_TOKEN]: token },
          body: {},
        }),
        deps,
      );
      expect(res?.status).toBe(403);
    });

    it('superadmin genera password temporal y audita en la misma operacion', async () => {
      const { deps, auditEventos } = construirDeps();
      const token = firmarTokenDePrueba(SUPERADMIN_ID, { ahora: CLOCK });
      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: `/api/portal/usuarios/${TARGET_ID}/credenciales`,
          headers: conCsrf(),
          cookies: { [COOKIE_TOKEN]: token },
          body: {},
        }),
        deps,
      );
      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ passwordTemporal: 'Temporal12345' });
      expect(auditEventos).toHaveLength(1);
      expect(auditEventos[0]).toMatchObject({ actorUserId: SUPERADMIN_ID, targetUserId: TARGET_ID });
    });

    it('requiere header CSRF tambien en esta ruta', async () => {
      const { deps } = construirDeps();
      const token = firmarTokenDePrueba(SUPERADMIN_ID, { ahora: CLOCK });
      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: `/api/portal/usuarios/${TARGET_ID}/credenciales`,
          cookies: { [COOKIE_TOKEN]: token },
          body: {},
        }),
        deps,
      );
      expect(res?.status).toBe(403);
      expect(res?.body).toMatchObject({ error: 'csrf_requerido' });
    });
  });

  describe('POST /auth/cambiar-password', () => {
    it('valida passwordActual, actualiza y revoca todas las sesiones existentes', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: true });

      const loginRes = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );
      const cookiesLogin = setCookieValores(loginRes!);

      // Segunda sesion (ej. otro dispositivo), tambien debe quedar revocada.
      const segundoLogin = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: conCsrf(),
          body: { identificador: 'proveeduria@atemporal.cr', password: PASSWORD_ACTUAL },
        }),
        deps,
      );
      const cookiesSegundo = setCookieValores(segundoLogin!);

      const cambioRes = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/cambiar-password',
          headers: conCsrf(),
          cookies: {
            [COOKIE_TOKEN]: cookiesLogin[COOKIE_TOKEN]!,
            [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]!,
          },
          body: { passwordActual: PASSWORD_ACTUAL, passwordNueva: 'password-nueva-1234' },
        }),
        deps,
      );
      expect(cambioRes?.status).toBe(204);

      // La sesion usada para el cambio tambien queda invalida (revoca TODAS las sesiones).
      const refreshPrimera = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/refresh',
          headers: conCsrf(),
          cookies: { [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]! },
        }),
        deps,
      );
      expect(refreshPrimera?.status).toBe(401);

      // La otra sesion (segundo login) tambien quedo revocada.
      const refreshSegunda = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/refresh',
          headers: conCsrf(),
          cookies: { [COOKIE_REFRESH]: cookiesSegundo[COOKIE_REFRESH]! },
        }),
        deps,
      );
      expect(refreshSegunda?.status).toBe(401);
    });

    it('passwordActual incorrecto responde 401', async () => {
      const { deps, authStore } = construirDeps();
      authStore.fijarCredencial(ADMIN_ID, { passwordHash: hashAdmin, mustChangePassword: false });
      const token = firmarTokenDePrueba(ADMIN_ID, { ahora: CLOCK });

      const res = await resolverPortalRequest(
        req({
          method: 'POST',
          pathname: '/api/portal/auth/cambiar-password',
          headers: conCsrf(),
          cookies: { [COOKIE_TOKEN]: token },
          body: { passwordActual: 'incorrecta', passwordNueva: 'password-nueva-1234' },
        }),
        deps,
      );
      expect(res?.status).toBe(401);
    });
  });

  it('helper cookieHeader arma "a=1; b=2" (sanity de test-helper compartido)', () => {
    expect(cookieHeader({ a: '1', b: '2' })).toBe('a=1; b=2');
  });
});
