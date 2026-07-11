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

const SUPPLIER_ID = '40000000-0000-4000-8000-000000000001';
const OTRO_SUPPLIER_ID = '40000000-0000-4000-8000-000000000002';
const CONTACTO_ID = '50000000-0000-4000-8000-000000000001';

const ADMIN_MATERIALES = '20000000-0000-4000-8000-000000000002';
const SUPERADMIN = '20000000-0000-4000-8000-000000000001';
const ADMIN_EQUIPOS = '20000000-0000-4000-8000-000000000003';
const INGENIERO = '20000000-0000-4000-8000-000000000004';

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
  [INGENIERO]: {
    userId: INGENIERO,
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

function construirDeps(proveedoresStore: FakeProveedoresStore): PortalDeps {
  return {
    store: new FakePortalStore(),
    authStore: new FakeAuthStore(),
    portalStore: new FakePortalStore(),
    proveedoresStore,
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

describe('Proveedores del portal', () => {
  describe('GET /api/portal/proveedores', () => {
    it('403 para roles sin lectura de proveedores (ingeniero)', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(req(INGENIERO, { pathname: '/api/portal/proveedores' }), construirDeps(store));
      expect(res?.status).toBe(403);
    });

    it('200 para admin_equipos (lectura permitida aunque no pueda escribir)', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      const res = await resolverPortalRequest(
        req(ADMIN_EQUIPOS, { pathname: '/api/portal/proveedores' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ total: 1 });
    });

    it('filtra por q y activo, con contactos embebidos', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex', activo: true });
      store.agregarProveedor({ id: OTRO_SUPPLIER_ID, nombre: 'El Lagar', activo: false });
      store.agregarContacto({ supplierId: SUPPLIER_ID, telefonoWhatsapp: '+50688881001', esPrincipal: true });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, { pathname: '/api/portal/proveedores?q=rodex&activo=true' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      const body = res?.body as { items: { nombre: string; contactos: unknown[] }[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.nombre).toBe('Rodex');
      expect(body.items[0]?.contactos).toHaveLength(1);
    });

    it('rechaza limit invalido', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, { pathname: '/api/portal/proveedores?limit=0' }),
        construirDeps(store),
      );
      expect(res?.status).toBe(400);
    });
  });

  describe('GET /api/portal/proveedores/:id', () => {
    it('404 si no existe', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, { pathname: `/api/portal/proveedores/${SUPPLIER_ID}` }),
        construirDeps(store),
      );
      expect(res?.status).toBe(404);
      expect(res?.body).toMatchObject({ error: 'proveedor_no_encontrado' });
    });

    it('200 con detalle', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      const res = await resolverPortalRequest(
        req(SUPERADMIN, { pathname: `/api/portal/proveedores/${SUPPLIER_ID}` }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ id: SUPPLIER_ID, nombre: 'Rodex' });
    });
  });

  describe('POST /api/portal/proveedores', () => {
    it('403 para admin_equipos (sin escritura)', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_EQUIPOS, {
          method: 'POST',
          pathname: '/api/portal/proveedores',
          headers: conCsrf(),
          body: { nombre: 'Nuevo' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(403);
    });

    it('400 sin nombre', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: '/api/portal/proveedores',
          headers: conCsrf(),
          body: {},
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(400);
    });

    it('201 crea y audita proveedor_creado', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: '/api/portal/proveedores',
          headers: conCsrf(),
          body: { nombre: 'Nuevo Proveedor', categorias: ['cemento'] },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(201);
      expect(res?.body).toMatchObject({ nombre: 'Nuevo Proveedor', activo: true, categorias: ['cemento'] });
      expect(store.auditoria).toContainEqual(
        expect.objectContaining({ accion: 'proveedor_creado', actorUserId: ADMIN_MATERIALES }),
      );
    });

    it('requiere header CSRF', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: '/api/portal/proveedores',
          body: { nombre: 'Nuevo' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(403);
      expect(res?.body).toMatchObject({ error: 'csrf_requerido' });
    });
  });

  describe('PUT /api/portal/proveedores/:id', () => {
    it('404 si no existe', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'PUT',
          pathname: `/api/portal/proveedores/${SUPPLIER_ID}`,
          headers: conCsrf(),
          body: { activo: false },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(404);
    });

    it('200 actualiza parcialmente y audita antes/despues', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex', activo: true });

      const res = await resolverPortalRequest(
        req(SUPERADMIN, {
          method: 'PUT',
          pathname: `/api/portal/proveedores/${SUPPLIER_ID}`,
          headers: conCsrf(),
          body: { activo: false },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ activo: false, nombre: 'Rodex' });
      const audit = store.auditoria.find((a) => a.accion === 'proveedor_actualizado');
      expect(audit).toBeDefined();
      expect(audit?.antes).toMatchObject({ activo: true });
      expect(audit?.despues).toMatchObject({ activo: false });
    });
  });

  describe('POST /api/portal/proveedores/:id/contactos', () => {
    it('400 telefono invalido', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/proveedores/${SUPPLIER_ID}/contactos`,
          headers: conCsrf(),
          body: { telefonoWhatsapp: '88881001' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(400);
    });

    it('404 si el proveedor no existe', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/proveedores/${SUPPLIER_ID}/contactos`,
          headers: conCsrf(),
          body: { telefonoWhatsapp: '+50688881001' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(404);
    });

    it('201 crea contacto', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/proveedores/${SUPPLIER_ID}/contactos`,
          headers: conCsrf(),
          body: { telefonoWhatsapp: '+50688881001', nombre: 'Ana', esPrincipal: true },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(201);
      expect(res?.body).toMatchObject({ telefonoWhatsapp: '+50688881001', esPrincipal: true, optinAt: null });
    });

    it('409 telefono duplicado (constraint unique global)', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      store.agregarProveedor({ id: OTRO_SUPPLIER_ID, nombre: 'El Lagar' });
      store.agregarContacto({ supplierId: SUPPLIER_ID, telefonoWhatsapp: '+50688881001' });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/proveedores/${OTRO_SUPPLIER_ID}/contactos`,
          headers: conCsrf(),
          body: { telefonoWhatsapp: '+50688881001' },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(409);
      expect(res?.body).toMatchObject({ error: 'telefono_duplicado' });
    });
  });

  describe('PUT /api/portal/contactos/:id', () => {
    it('404 si no existe', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'PUT',
          pathname: `/api/portal/contactos/${CONTACTO_ID}`,
          headers: conCsrf(),
          body: { esPrincipal: true },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(404);
    });

    it('200 actualiza nombre/esPrincipal', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      store.agregarContacto({ id: CONTACTO_ID, supplierId: SUPPLIER_ID, telefonoWhatsapp: '+50688881001' });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'PUT',
          pathname: `/api/portal/contactos/${CONTACTO_ID}`,
          headers: conCsrf(),
          body: { nombre: 'Ana Nueva', esPrincipal: true },
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      expect(res?.body).toMatchObject({ nombre: 'Ana Nueva', esPrincipal: true });
    });
  });

  describe('opt-in / baja de contacto', () => {
    it('optin fija optinAt', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      store.agregarContacto({ id: CONTACTO_ID, supplierId: SUPPLIER_ID, telefonoWhatsapp: '+50688881001' });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/contactos/${CONTACTO_ID}/optin`,
          headers: conCsrf(),
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      expect((res?.body as { optinAt: string | null }).optinAt).not.toBeNull();
    });

    it('baja limpia optinAt', async () => {
      const store = new FakeProveedoresStore();
      store.agregarProveedor({ id: SUPPLIER_ID, nombre: 'Rodex' });
      store.agregarContacto({
        id: CONTACTO_ID,
        supplierId: SUPPLIER_ID,
        telefonoWhatsapp: '+50688881001',
        optinAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/contactos/${CONTACTO_ID}/baja`,
          headers: conCsrf(),
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(200);
      expect((res?.body as { optinAt: string | null }).optinAt).toBeNull();
      expect(store.auditoria).toContainEqual(expect.objectContaining({ accion: 'contacto_baja' }));
    });

    it('404 si el contacto no existe', async () => {
      const store = new FakeProveedoresStore();
      const res = await resolverPortalRequest(
        req(ADMIN_MATERIALES, {
          method: 'POST',
          pathname: `/api/portal/contactos/${CONTACTO_ID}/optin`,
          headers: conCsrf(),
        }),
        construirDeps(store),
      );
      expect(res?.status).toBe(404);
    });
  });
});
