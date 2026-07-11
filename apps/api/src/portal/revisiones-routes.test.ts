import { describe, expect, it } from 'vitest';

import { resolverPortalRequest } from './routes.js';
import type { PortalDeps, PortalRequest } from './routes.js';
import { FakeAuthStore } from './auth-store.js';
import { FakeProveedoresStore } from './proveedores-store.js';
import { FakeRevisionesStore } from './revisiones-store.js';
import { FakeAprobacionesStore } from './aprobaciones-store.js';
import { COOKIE_TOKEN } from './auth-routes.js';
import { firmarTokenDePrueba, TEST_JWT_SECRET } from './auth-test-helpers.js';
import type {
  ComparativoPortal,
  ListaPedidosPortal,
  ListarPedidosFiltro,
  PedidoDetallePortal,
  PortalActor,
  PortalStore,
} from './types.js';

const REVISION_ID = 'a0000000-0000-4000-8000-000000000001';
const PEDIDO_ID = '70000000-0000-4000-8000-000000000001';
const PROJECT_ID = '30000000-0000-4000-8000-000000000001';

const ADMIN_MATERIALES = '20000000-0000-4000-8000-000000000002';
const SUPERADMIN = '20000000-0000-4000-8000-000000000001';
const ADMIN_EQUIPOS = '20000000-0000-4000-8000-000000000003';

const ACTORS: Record<string, PortalActor> = {
  [ADMIN_MATERIALES]: {
    userId: ADMIN_MATERIALES,
    nombre: 'Jose Pablo',
    email: 'proveeduria@atemporal.cr',
    roles: ['admin_materiales'],
    projectIds: [],
  },
  [SUPERADMIN]: {
    userId: SUPERADMIN,
    nombre: 'Gerencia',
    email: 'gerencia@atemporal.cr',
    roles: ['superadmin'],
    projectIds: [],
  },
  [ADMIN_EQUIPOS]: {
    userId: ADMIN_EQUIPOS,
    nombre: 'Bernal',
    email: 'equipos@atemporal.cr',
    roles: ['admin_equipos'],
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

function construirDeps(revisionesStore: FakeRevisionesStore): PortalDeps {
  return {
    store: new FakePortalStore(),
    authStore: new FakeAuthStore(),
    portalStore: new FakePortalStore(),
    proveedoresStore: new FakeProveedoresStore(),
    revisionesStore,
    aprobacionesStore: new FakeAprobacionesStore(),
    ejecutarToolPedido: async () => {
      throw new Error('ejecutarToolPedido no deberia invocarse en estos tests.');
    },
    portalJwtSecret: TEST_JWT_SECRET,
    esProduccion: false,
    ahora: () => new Date('2026-07-10T12:00:00.000Z'),
    emitirCredenciales: async () => {},
  };
}

function req(userId: string, over: Partial<PortalRequest> & { readonly pathname: string }): PortalRequest {
  const { pathname: rutaCruda, searchParams, ...resto } = over;
  const url = new URL(rutaCruda, 'http://localhost');
  return {
    method: 'GET',
    searchParams: searchParams ?? url.searchParams,
    headers: {},
    cookies: { [COOKIE_TOKEN]: firmarTokenDePrueba(userId) },
    body: undefined,
    ...resto,
    pathname: url.pathname,
  };
}

function conCsrf(headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, 'x-portal-csrf': '1' };
}

describe('Cola de revision del portal', () => {
  describe('GET /api/portal/revisiones', () => {
    it('403 para admin_equipos (fuera de la matriz de revisiones)', async () => {
      const store = new FakeRevisionesStore();
      const res = await resolverPortalRequest(
        req(ADMIN_EQUIPOS, { pathname: '/api/portal/revisiones' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(403);
    });

    it('default estado=pendiente', async () => {
      const store = new FakeRevisionesStore();
      store.agregarRevision({ tipo: 'cotizacion_incompleta', entidad: 'quote_responses', entidadId: 'x', estado: 'pendiente' });
      store.agregarRevision({ tipo: 'nc_ambigua', entidad: 'credit_notes', entidadId: 'y', estado: 'resuelta' });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, { pathname: '/api/portal/revisiones' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      const body = res?.body as { items: { estado: string }[]; total: number };
      expect(body.total).toBe(1);
      expect(body.items[0]?.estado).toBe('pendiente');
    });

    it('filtra por tipo y projectId; pedido null si no aplica', async () => {
      const store = new FakeRevisionesStore();
      store.agregarRevision({
        tipo: 'factura_sin_oc',
        entidad: 'invoices',
        entidadId: 'inv-1',
        pedidoId: PEDIDO_ID,
        pedidoNumero: 'PED-2026-001',
        projectId: PROJECT_ID,
      });
      store.agregarRevision({ tipo: 'diferencia_monto', entidad: 'invoices', entidadId: 'inv-2' });

      const res = await resolverPortalRequest(
        req(SUPERADMIN, { pathname: `/api/portal/revisiones?tipo=factura_sin_oc&projectId=${PROJECT_ID}` }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      const body = res?.body as { items: { pedido: { id: string; numero: string } | null }[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.pedido).toEqual({ id: PEDIDO_ID, numero: 'PED-2026-001' });
    });

    it('rechaza tipo invalido', async () => {
      const store = new FakeRevisionesStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, { pathname: '/api/portal/revisiones?tipo=no-existe' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(400);
    });

    it('rechaza estado invalido', async () => {
      const store = new FakeRevisionesStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, { pathname: '/api/portal/revisiones?estado=archivada' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(400);
    });
  });

  describe('POST /api/portal/revisiones/:id/resolver', () => {
    it('403 para admin_equipos', async () => {
      const store = new FakeRevisionesStore();
      const res = await resolverPortalRequest(
        req(ADMIN_EQUIPOS, {
          method: 'POST',
          pathname: `/api/portal/revisiones/${REVISION_ID}/resolver`,
          headers: conCsrf(),
          body: { resolucion: 'listo' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(403);
    });

    it('400 sin resolucion', async () => {
      const store = new FakeRevisionesStore();
      store.agregarRevision({ id: REVISION_ID, tipo: 'nc_ambigua', entidad: 'credit_notes', entidadId: 'x' });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/revisiones/${REVISION_ID}/resolver`,
          headers: conCsrf(),
          body: {},
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(400);
    });

    it('404 si no existe', async () => {
      const store = new FakeRevisionesStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/revisiones/${REVISION_ID}/resolver`,
          headers: conCsrf(),
          body: { resolucion: 'listo' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(404);
    });

    it('200 resuelve y audita; segunda resolucion responde 409', async () => {
      const store = new FakeRevisionesStore();
      store.agregarRevision({ id: REVISION_ID, tipo: 'nc_ambigua', entidad: 'credit_notes', entidadId: 'x' });
      const deps = construirDeps(store);

      const primera = await resolverPortalRequest(
        req(SUPERADMIN, {
          method: 'POST',
          pathname: `/api/portal/revisiones/${REVISION_ID}/resolver`,
          headers: conCsrf(),
          body: { resolucion: 'Se reviso y quedo conciliado.' },
        }),
        deps,
      );
      expect(primera?.status).toBe(200);
      expect(primera?.body).toMatchObject({
        estado: 'resuelta',
        resolucion: 'Se reviso y quedo conciliado.',
        resueltaPor: { userId: SUPERADMIN },
      });
      expect(store.auditoria).toContainEqual(
        expect.objectContaining({ accion: 'revision_resuelta', actorUserId: SUPERADMIN }),
      );

      const segunda = await resolverPortalRequest(
        req(SUPERADMIN, {
          method: 'POST',
          pathname: `/api/portal/revisiones/${REVISION_ID}/resolver`,
          headers: conCsrf(),
          body: { resolucion: 'otra vez' },
        }),
        deps,
      );
      expect(segunda?.status).toBe(409);
      expect(segunda?.body).toMatchObject({ error: 'revision_ya_resuelta' });
    });

    it('requiere header CSRF', async () => {
      const store = new FakeRevisionesStore();
      store.agregarRevision({ id: REVISION_ID, tipo: 'nc_ambigua', entidad: 'credit_notes', entidadId: 'x' });
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/revisiones/${REVISION_ID}/resolver`,
          body: { resolucion: 'listo' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(403);
      expect(res?.body).toMatchObject({ error: 'csrf_requerido' });
    });
  });
});
