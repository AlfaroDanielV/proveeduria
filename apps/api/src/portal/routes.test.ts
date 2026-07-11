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

const USER_ID = '20000000-0000-4000-8000-000000000002';
const PEDIDO_ID = '70000000-0000-4000-8000-000000000001';
const PROJECT_ID = '30000000-0000-4000-8000-000000000001';

class FakePortalStore implements PortalStore {
  actor: PortalActor | null = {
    userId: USER_ID,
    nombre: 'Jose Pablo',
    email: 'proveeduria@atemporal.cr',
    roles: ['admin_materiales'],
    projectIds: [],
  };

  ultimoFiltro: ListarPedidosFiltro | null = null;

  async usuarioPorId(): Promise<PortalActor | null> {
    return this.actor;
  }

  async listarPedidos(_actor: PortalActor, filtro: ListarPedidosFiltro): Promise<ListaPedidosPortal> {
    this.ultimoFiltro = filtro;
    return { items: [], total: 0, limit: filtro.limit, offset: filtro.offset };
  }

  async detallePedido(): Promise<PedidoDetallePortal | null> {
    return {
      pedido: {
        id: PEDIDO_ID,
        numero: 'PED-2026-001',
        estado: 'en_revision',
        proyecto: { id: PROJECT_ID, nombre: 'Residencial Lopez', codigo: 'LOP' },
        solicitante: { userId: USER_ID, nombre: 'Ingeniero' },
        fechaRequerida: null,
        urgencia: null,
        plazoCotizacionAt: null,
        itemsCount: 0,
        rfqsTotal: 0,
        rfqsRespondidas: 0,
        revisionesPendientes: 0,
      },
      items: [],
      quoteRequests: [],
      revisionesPendientes: [],
    };
  }

  async comparativoPedido(): Promise<ComparativoPortal | null> {
    return {
      pedido: {
        id: PEDIDO_ID,
        numero: 'PED-2026-001',
        estado: 'en_revision',
        proyecto: { id: PROJECT_ID, nombre: 'Residencial Lopez', codigo: 'LOP' },
      },
      resumenProveedores: [],
      filas: [],
    };
  }
}

function construirDeps(store: FakePortalStore): PortalDeps {
  return {
    store,
    authStore: new FakeAuthStore(),
    portalStore: store,
    proveedoresStore: new FakeProveedoresStore(),
    revisionesStore: new FakeRevisionesStore(),
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

function req(path: string, autenticado = true): PortalRequest {
  const url = new URL(path, 'http://localhost');
  return {
    method: 'GET',
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers: {},
    cookies: autenticado ? { [COOKIE_TOKEN]: firmarTokenDePrueba(USER_ID) } : {},
    body: undefined,
  };
}

describe('resolverPortalRequest', () => {
  it('ignora rutas fuera de /api/portal', async () => {
    const store = new FakePortalStore();
    await expect(resolverPortalRequest(req('/webhook'), construirDeps(store))).resolves.toBeNull();
  });

  it('rechaza peticiones sin portal_token', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(req('/api/portal/me', false), construirDeps(store));
    expect(res?.status).toBe(401);
    expect(res?.body).toMatchObject({ error: 'auth_requerida' });
  });

  it('rechaza portal_token invalido con 401', async () => {
    const store = new FakePortalStore();
    const bad: PortalRequest = {
      method: 'GET',
      pathname: '/api/portal/me',
      searchParams: new URLSearchParams(),
      headers: {},
      cookies: { [COOKIE_TOKEN]: 'no-es-un-jwt' },
      body: undefined,
    };
    const res = await resolverPortalRequest(bad, construirDeps(store));
    expect(res?.status).toBe(401);
  });

  it('usuario resuelto por el token pero inactivo/no encontrado -> 403', async () => {
    const store = new FakePortalStore();
    store.actor = null;
    const bad: PortalRequest = {
      method: 'GET',
      pathname: '/api/portal/me',
      searchParams: new URLSearchParams(),
      headers: {},
      cookies: { [COOKIE_TOKEN]: firmarTokenDePrueba(USER_ID) },
      body: undefined,
    };
    const res = await resolverPortalRequest(bad, construirDeps(store));
    expect(res?.status).toBe(403);
  });

  it('lista pedidos con filtros validados', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(
      req(`/api/portal/pedidos?estado=en_revision&projectId=${PROJECT_ID}&limit=10&offset=5`),
      construirDeps(store),
    );

    expect(res?.status).toBe(200);
    expect(store.ultimoFiltro).toEqual({
      estado: 'en_revision',
      projectId: PROJECT_ID,
      limit: 10,
      offset: 5,
    });
  });

  it('rechaza estado invalido', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(req('/api/portal/pedidos?estado=listo'), construirDeps(store));
    expect(res?.status).toBe(400);
  });

  it('resuelve detalle y comparativo por pedido', async () => {
    const store = new FakePortalStore();
    const deps = construirDeps(store);
    const detalle = await resolverPortalRequest(req(`/api/portal/pedidos/${PEDIDO_ID}`), deps);
    const comparativo = await resolverPortalRequest(
      req(`/api/portal/pedidos/${PEDIDO_ID}/comparativo`),
      deps,
    );

    expect(detalle?.status).toBe(200);
    expect(comparativo?.status).toBe(200);
    expect(comparativo?.body).toMatchObject({
      pedido: { id: PEDIDO_ID, numero: 'PED-2026-001' },
    });
  });

  it('OPTIONS responde 204 sin headers CORS cuando no hay portalOrigin', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(
      { method: 'OPTIONS', pathname: '/api/portal/me', searchParams: new URLSearchParams(), headers: {}, cookies: {}, body: undefined },
      construirDeps(store),
    );
    expect(res?.status).toBe(204);
    expect(res?.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('con portalOrigin definido, agrega headers CORS con credentials', async () => {
    const store = new FakePortalStore();
    const deps = { ...construirDeps(store), portalOrigin: 'https://portal.example.com' };
    const res = await resolverPortalRequest(
      { method: 'OPTIONS', pathname: '/api/portal/me', searchParams: new URLSearchParams(), headers: {}, cookies: {}, body: undefined },
      deps,
    );
    expect(res?.status).toBe(204);
    expect(res?.headers['access-control-allow-origin']).toBe('https://portal.example.com');
    expect(res?.headers['access-control-allow-credentials']).toBe('true');
  });

  it('metodo no soportado responde 405', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(
      { method: 'DELETE', pathname: '/api/portal/me', searchParams: new URLSearchParams(), headers: {}, cookies: {}, body: undefined },
      construirDeps(store),
    );
    expect(res?.status).toBe(405);
  });
});
