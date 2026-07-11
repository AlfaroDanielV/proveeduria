import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAuditInserter } from '@proveeduria/agent';
import type { Actor } from '@proveeduria/agent';

import { PgAuthStore } from './auth-store.js';
import { PgPortalStore } from './repo.js';
import { FakeProveedoresStore } from './proveedores-store.js';
import { FakeRevisionesStore } from './revisiones-store.js';
import { FakeAprobacionesStore } from './aprobaciones-store.js';
import { resolverPortalRequest } from './routes.js';
import type { PortalDeps, PortalRequest, PortalResponse } from './routes.js';
import { COOKIE_REFRESH, COOKIE_TOKEN } from './auth-routes.js';
import type { EmitirCredencialesInput } from './auth-routes.js';
import { firmarJwt } from './crypto.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

// Seed fijo (packages/db/seeds/001_base.sql): Jose Pablo / admin_materiales.
const USER_ID = '20000000-0000-4000-8000-000000000002';
const USER_EMAIL = 'proveeduria@atemporal.cr';
// Gerencia / superadmin.
const SUPERADMIN_ID = '20000000-0000-4000-8000-000000000001';

function setCookieValores(resp: PortalResponse | null): Record<string, string> {
  const raw = resp?.headers['set-cookie'];
  const lista = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out: Record<string, string> = {};
  for (const cookie of lista) {
    const [par] = cookie.split(';');
    const [nombre, valor] = (par ?? '').split('=');
    if (nombre !== undefined && valor !== undefined) out[nombre] = valor;
  }
  return out;
}

function baseReq(over: Partial<PortalRequest> & { readonly pathname: string }): PortalRequest {
  return {
    method: 'GET',
    searchParams: new URLSearchParams(),
    headers: {},
    cookies: {},
    body: undefined,
    ...over,
  };
}

describe.skipIf(!RUN)('Autenticacion del portal (integracion Postgres)', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    client?.release();
    await pool.end();
  });

  it('crear credencial -> login -> GET /me -> cambiar-password -> refresh viejo invalido', async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    try {
      const authStore = new PgAuthStore(client);
      const portalStore = new PgPortalStore(client);

      const deps: PortalDeps = {
        store: portalStore,
        authStore,
        portalStore,
        proveedoresStore: new FakeProveedoresStore(),
        revisionesStore: new FakeRevisionesStore(),
        aprobacionesStore: new FakeAprobacionesStore(),
        ejecutarToolPedido: async () => {
          throw new Error('ejecutarToolPedido no deberia invocarse en estos tests.');
        },
        portalJwtSecret: 'secreto-de-integracion-portal',
        esProduccion: false,
        ahora: () => new Date(),
        emitirCredenciales: async (input: EmitirCredencialesInput) => {
          await new PgAuthStore(client).crearOResetearCredencial(input.targetUserId, input.passwordHash);
          const actor: Actor = { userId: input.actorUserId, roles: ['superadmin'], nombre: 'Gerencia (test)' };
          await crearAuditInserter(client, actor, input.ahora, 'web')({
            accion: 'credencial_emitida',
            entidad: 'user_credentials',
            entidadId: input.targetUserId,
          });
        },
      };

      // 1. superadmin autenticado (JWT firmado directo con el mismo secreto: no requiere
      // login previo del superadmin para este flujo) emite la credencial de USER_ID.
      const tokenSuperadmin = firmarJwtDePrueba(SUPERADMIN_ID, deps.portalJwtSecret);
      const credRes = await resolverPortalRequest(
        baseReq({
          method: 'POST',
          pathname: `/api/portal/usuarios/${USER_ID}/credenciales`,
          headers: { 'x-portal-csrf': '1' },
          cookies: { [COOKIE_TOKEN]: tokenSuperadmin },
          body: {},
        }),
        deps,
      );
      expect(credRes?.status).toBe(200);
      const passwordTemporal = (credRes?.body as { passwordTemporal: string }).passwordTemporal;
      expect(typeof passwordTemporal).toBe('string');
      expect(passwordTemporal.length).toBeGreaterThanOrEqual(12);

      const auditRows = await client.query(
        "SELECT accion, entidad, entidad_id, origen, actor_user_id FROM audit_events " +
          "WHERE accion = 'credencial_emitida' AND entidad_id = $1",
        [USER_ID],
      );
      expect(auditRows.rowCount).toBe(1);
      expect(auditRows.rows[0]).toMatchObject({
        accion: 'credencial_emitida',
        entidad: 'user_credentials',
        entidad_id: USER_ID,
        origen: 'web',
        actor_user_id: SUPERADMIN_ID,
      });

      // 2. login con la password temporal.
      const loginRes = await resolverPortalRequest(
        baseReq({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: { 'x-portal-csrf': '1' },
          body: { identificador: USER_EMAIL, password: passwordTemporal },
        }),
        deps,
      );
      expect(loginRes?.status).toBe(200);
      expect(loginRes?.body).toMatchObject({ mustChangePassword: true, user: { userId: USER_ID } });
      const cookiesLogin = setCookieValores(loginRes);
      expect(cookiesLogin[COOKIE_TOKEN]).toBeTruthy();
      expect(cookiesLogin[COOKIE_REFRESH]).toBeTruthy();

      // 3. GET /me con la cookie de sesion.
      const meRes = await resolverPortalRequest(
        baseReq({ pathname: '/api/portal/me', cookies: { [COOKIE_TOKEN]: cookiesLogin[COOKIE_TOKEN]! } }),
        deps,
      );
      expect(meRes?.status).toBe(200);
      expect(meRes?.body).toMatchObject({ user: { userId: USER_ID, roles: ['admin_materiales'] } });

      // 4. cambiar-password.
      const cambioRes = await resolverPortalRequest(
        baseReq({
          method: 'POST',
          pathname: '/api/portal/auth/cambiar-password',
          headers: { 'x-portal-csrf': '1' },
          cookies: { [COOKIE_TOKEN]: cookiesLogin[COOKIE_TOKEN]! },
          body: { passwordActual: passwordTemporal, passwordNueva: 'password-nueva-de-prueba-1234' },
        }),
        deps,
      );
      expect(cambioRes?.status).toBe(204);

      // 5. el refresh viejo (obtenido en el login original) ya no sirve.
      const refreshViejo = await resolverPortalRequest(
        baseReq({
          method: 'POST',
          pathname: '/api/portal/auth/refresh',
          headers: { 'x-portal-csrf': '1' },
          cookies: { [COOKIE_REFRESH]: cookiesLogin[COOKIE_REFRESH]! },
        }),
        deps,
      );
      expect(refreshViejo?.status).toBe(401);

      // Login con la password vieja ya no funciona; con la nueva si.
      const loginConPasswordVieja = await resolverPortalRequest(
        baseReq({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: { 'x-portal-csrf': '1' },
          body: { identificador: USER_EMAIL, password: passwordTemporal },
        }),
        deps,
      );
      expect(loginConPasswordVieja?.status).toBe(401);

      const loginConPasswordNueva = await resolverPortalRequest(
        baseReq({
          method: 'POST',
          pathname: '/api/portal/auth/login',
          headers: { 'x-portal-csrf': '1' },
          body: { identificador: USER_EMAIL, password: 'password-nueva-de-prueba-1234' },
        }),
        deps,
      );
      expect(loginConPasswordNueva?.status).toBe(200);
      expect(loginConPasswordNueva?.body).toMatchObject({ mustChangePassword: false });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});

// Firma un JWT identico al que produce crypto.ts, sin pasar por un login real (para
// autenticar al superadmin que emite la credencial en el paso 1 del flujo).
function firmarJwtDePrueba(userId: string, secreto: string): string {
  return firmarJwt({ sub: userId, secreto, ahora: new Date(), vidaSegundos: 900 });
}
