/**
 * Tests de ruta de Aprobaciones y acciones de pedido (C2, docs/specs/portal-api.md
 * §Aprobaciones y acciones de pedido). Mismo patron que `proveedores-routes.test.ts`/
 * `revisiones-routes.test.ts`: van por `resolverPortalRequest` (router completo, cubre CSRF/
 * auth/rol/dispatch) con fakes.
 *
 * Las 3 mutaciones EJECUTAN las tools REALES de `@proveeduria/agent` (`enviarRfq`/
 * `aprobarGanador`/`emitirOc`) contra un `Ctx` fake (`FakeToolStore`/`crearFakeRepos`,
 * exportados por el paquete para testing) en vez de reimplementar el dominio: el
 * `EjecutorToolPedido` fake de aca replica exactamente lo que hace
 * `acciones-pedido.ts#ejecutarToolPedido` con Postgres real, salvo el advisory lock (que
 * solo tiene sentido con Postgres — cubierto por el test de integracion) y con
 * `origen: 'web'` fijo (control-center.md principio 1/2), igual que la implementacion real.
 */

import { describe, expect, it } from 'vitest';

import { crearCtx, crearFakeRepos, FakeToolStore } from '@proveeduria/agent';
import type { Actor, Ctx, ResultadoTool } from '@proveeduria/agent';

import type { EjecutorToolPedido } from './acciones-pedido.js';
import { FakeAprobacionesStore } from './aprobaciones-store.js';
import { resolverPortalRequest } from './routes.js';
import type { PortalDeps, PortalRequest } from './routes.js';
import { FakeAuthStore } from './auth-store.js';
import { FakeProveedoresStore } from './proveedores-store.js';
import { FakeRevisionesStore } from './revisiones-store.js';
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
import type {
  Pedido,
  Proveedor,
  Proyecto,
  QuoteRequest,
  QuoteResponse,
  UsuarioInterno,
} from '@proveeduria/agent';

const AHORA = new Date('2026-07-10T12:00:00.000Z');
const PEDIDO_ID = '70000000-0000-4000-8000-000000000001';
const ITEM_1 = 'item-1';
const ITEM_2 = 'item-2';

const ADMIN_MATERIALES = '20000000-0000-4000-8000-000000000002';
const SUPERADMIN = '20000000-0000-4000-8000-000000000001';
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
  [INGENIERO]: {
    userId: INGENIERO,
    nombre: 'Ingeniero de Obra',
    email: 'ingenieria@atemporal.cr',
    roles: ['ingeniero'],
    projectIds: [],
  },
};

const proyectoActivo: Proyecto = {
  id: '30000000-0000-4000-8000-000000000001',
  nombre: 'Residencial Lopez',
  codigo: 'LOP',
  activo: true,
};

const adminMateriales: UsuarioInterno = {
  userId: ADMIN_MATERIALES,
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
  telefonoWhatsapp: '+50688880002',
};

const proveedorRodex: Proveedor = {
  id: '40000000-0000-4000-8000-000000000001',
  nombre: 'Rodex',
  cedulaJuridica: '3-101-111111',
  categorias: ['cemento'],
  activo: true,
  contactoPrincipal: {
    id: '50000000-0000-4000-8000-000000000001',
    supplierId: '40000000-0000-4000-8000-000000000001',
    nombre: 'Ventas Rodex',
    telefonoWhatsapp: '+50688881001',
    optinAt: AHORA,
    esPrincipal: true,
  },
};

function storeBase(): FakeToolStore {
  const store = new FakeToolStore();
  store.agregarProyecto(proyectoActivo);
  store.agregarUsuario(adminMateriales);
  store.agregarProveedor(proveedorRodex);
  return store;
}

function pedidoBase(overrides: Partial<Pedido> = {}): Pedido {
  return {
    id: PEDIDO_ID,
    numero: 'PED-2026-001',
    projectId: proyectoActivo.id,
    solicitanteUserId: INGENIERO,
    estado: 'borrador',
    fechaRequerida: null,
    urgencia: null,
    confirmadoAt: null,
    confirmadoPor: null,
    plazoCotizacionAt: null,
    ...overrides,
  };
}

function agregarPedidoConItems(store: FakeToolStore, pedido: Pedido): void {
  store.pedidos.set(pedido.id, pedido);
  store.itemsPorPedido.set(pedido.id, [
    { id: ITEM_1, pedidoId: pedido.id, descripcion: 'Cemento gris', cantidad: 10, unidad: 'saco' },
    { id: ITEM_2, pedidoId: pedido.id, descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
  ]);
}

function quoteRequestBase(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return {
    id: 'quote-request-1',
    pedidoId: PEDIDO_ID,
    supplierId: proveedorRodex.id,
    plazoAt: new Date('2026-07-11T12:00:00.000Z'),
    estado: 'respondida',
    ...overrides,
  };
}

function quoteResponseCompleta(overrides: Partial<QuoteResponse> = {}): QuoteResponse {
  return {
    id: 'quote-response-1',
    quoteRequestId: 'quote-request-1',
    recibidoAt: AHORA,
    fuente: 'texto',
    condiciones: 'Contado',
    plazoEntrega: '2 dias',
    confianzaExtraccion: 0.95,
    estado: 'completa',
    intentosRepregunta: 0,
    ...overrides,
  };
}

/** Pedido en_revision con 1 proveedor que coti ambos items completos: listo para adjudicar. */
function sembrarPedidoEnRevisionCotizado(store: FakeToolStore): void {
  agregarPedidoConItems(store, pedidoBase({ estado: 'en_revision' }));
  store.quoteRequests.push(quoteRequestBase());
  store.quoteResponses.push(quoteResponseCompleta());
  store.quoteItems.push(
    { id: 'quote-item-1', quoteResponseId: 'quote-response-1', pedidoItemId: ITEM_1, precioUnitario: 4500, cantidad: 10, disponible: true, notas: null },
    { id: 'quote-item-2', quoteResponseId: 'quote-response-1', pedidoItemId: ITEM_2, precioUnitario: 1250, cantidad: 25, disponible: true, notas: null },
  );
}

/** Pedido `aprobado` con `approval_events(ganador)` normativo sembrado a mano (mismo patron
 * que `oc.test.ts#sembrarApprovalGanador`): listo para `emitir_oc`. */
function sembrarPedidoAprobadoConGanador(store: FakeToolStore): void {
  sembrarPedidoEnRevisionCotizado(store);
  const pedido = store.pedidos.get(PEDIDO_ID);
  if (pedido !== undefined) store.pedidos.set(PEDIDO_ID, { ...pedido, estado: 'aprobado' });
  store.approvalEvents.push({
    tipo: 'ganador',
    pedidoId: PEDIDO_ID,
    canal: 'web',
    detalle: {
      asignaciones: [
        { supplierId: proveedorRodex.id, pedidoItemIds: [ITEM_1, ITEM_2], quoteResponseId: 'quote-response-1' },
      ],
      comparativo: { pedidoId: PEDIDO_ID, numero: 'PED-2026-001', filas: [], resumenProveedores: [] },
    },
  });
}

/**
 * Replica `acciones-pedido.ts#ejecutarToolPedido` sin Postgres: mismo `Ctx` (repos reales
 * en memoria, `origen: 'web'`) sin el advisory lock (solo Postgres lo necesita; cubierto por
 * el test de integracion `aprobaciones.integration.test.ts`).
 */
function ejecutorFake(store: FakeToolStore): EjecutorToolPedido {
  return async <T>(input: {
    readonly actor: Actor;
    readonly pedidoId: string;
    readonly ahora: Date;
    readonly tool: (ctx: Ctx) => Promise<ResultadoTool<T>>;
  }): Promise<ResultadoTool<T>> => {
    const ctx: Ctx = {
      ...crearCtx({
        tx: store.tx,
        actor: input.actor,
        ahora: input.ahora,
        origen: 'web',
        repos: crearFakeRepos(store),
      }),
      audit: async (event) => {
        store.auditEvents.push({ ...event });
      },
      outbox: async (message) => {
        store.outboxMessages.push({ ...message });
      },
      approval: async (event) => {
        store.approvalEvents.push({ ...event });
      },
    };
    return input.tool(ctx);
  };
}

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

function construirDeps(
  toolStore: FakeToolStore,
  aprobacionesStore: FakeAprobacionesStore = new FakeAprobacionesStore(),
): PortalDeps {
  return {
    store: new FakePortalStore(),
    authStore: new FakeAuthStore(),
    portalStore: new FakePortalStore(),
    proveedoresStore: new FakeProveedoresStore(),
    revisionesStore: new FakeRevisionesStore(),
    aprobacionesStore,
    ejecutarToolPedido: ejecutorFake(toolStore),
    portalJwtSecret: TEST_JWT_SECRET,
    esProduccion: false,
    ahora: () => AHORA,
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

describe('POST /api/portal/pedidos/:id/rfqs', () => {
  it('403 para rol insuficiente (ingeniero)', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase());
    const res = await resolverPortalRequest(
      req(INGENIERO, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/rfqs`,
        headers: conCsrf(),
        body: { supplierIds: [proveedorRodex.id] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(403);
    expect(res?.body).toMatchObject({ error: 'rol_insuficiente' });
  });

  it('400 con supplierIds invalido', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase());
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/rfqs`,
        headers: conCsrf(),
        body: { supplierIds: [] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(400);
    expect(res?.body).toMatchObject({ error: 'request_invalido' });
  });

  it('200 feliz: transiciona a cotizando, crea RFQ y approval_events(lista_proveedores) con canal web', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'borrador' }));
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/rfqs`,
        headers: conCsrf(),
        body: { supplierIds: [proveedorRodex.id], plazoHoras: 48 },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(200);
    expect(res?.body).toMatchObject({ pedidoId: PEDIDO_ID, estado: 'cotizando', rfqs: 1 });
    expect(store.pedidos.get(PEDIDO_ID)?.estado).toBe('cotizando');
    expect(store.approvalEvents).toEqual([
      expect.objectContaining({ tipo: 'lista_proveedores', pedidoId: PEDIDO_ID, canal: 'web' }),
    ]);
  });

  it('409 si el pedido ya no esta en borrador (E12)', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'cotizando' }));
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/rfqs`,
        headers: conCsrf(),
        body: { supplierIds: [proveedorRodex.id] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(409);
    expect(res?.body).toMatchObject({ error: 'E12' });
  });
});

describe('POST /api/portal/pedidos/:id/adjudicacion', () => {
  it('403 para rol insuficiente (ingeniero)', async () => {
    const store = storeBase();
    sembrarPedidoEnRevisionCotizado(store);
    const res = await resolverPortalRequest(
      req(INGENIERO, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/adjudicacion`,
        headers: conCsrf(),
        body: { asignaciones: [{ supplierId: proveedorRodex.id, pedidoItemIds: [ITEM_1, ITEM_2] }] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(403);
  });

  it('400 con asignaciones vacio', async () => {
    const store = storeBase();
    sembrarPedidoEnRevisionCotizado(store);
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/adjudicacion`,
        headers: conCsrf(),
        body: { asignaciones: [] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(400);
  });

  it('200 feliz: adjudica, deja approval_events(ganador) con snapshot y canal web', async () => {
    const store = storeBase();
    sembrarPedidoEnRevisionCotizado(store);
    const res = await resolverPortalRequest(
      req(SUPERADMIN, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/adjudicacion`,
        headers: conCsrf(),
        body: { asignaciones: [{ supplierId: proveedorRodex.id, pedidoItemIds: [ITEM_1, ITEM_2] }] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(200);
    expect(res?.body).toMatchObject({ pedidoId: PEDIDO_ID, estado: 'aprobado' });
    expect(store.pedidos.get(PEDIDO_ID)?.estado).toBe('aprobado');
    const evento = store.approvalEvents.find((e) => e.tipo === 'ganador');
    expect(evento).toMatchObject({ pedidoId: PEDIDO_ID, canal: 'web' });
    expect((evento?.detalle as { comparativo?: unknown } | undefined)?.comparativo).toBeDefined();
  });

  it('409 si el pedido no esta en_revision (E12)', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'aprobado' }));
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/adjudicacion`,
        headers: conCsrf(),
        body: { asignaciones: [{ supplierId: proveedorRodex.id, pedidoItemIds: [ITEM_1] }] },
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(409);
    expect(res?.body).toMatchObject({ error: 'E12' });
  });
});

describe('POST /api/portal/pedidos/:id/ocs', () => {
  it('403 para rol insuficiente (ingeniero)', async () => {
    const store = storeBase();
    sembrarPedidoAprobadoConGanador(store);
    const res = await resolverPortalRequest(
      req(INGENIERO, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/ocs`,
        headers: conCsrf(),
        body: {},
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(403);
  });

  it('200 feliz: emite OC, transiciona a ordenado', async () => {
    const store = storeBase();
    sembrarPedidoAprobadoConGanador(store);
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/ocs`,
        headers: conCsrf(),
        body: {},
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(200);
    const body = res?.body as { pedidoId: string; estado: string; ocs: { supplierId: string; montoTotal: number }[] };
    expect(body.pedidoId).toBe(PEDIDO_ID);
    expect(body.estado).toBe('ordenado');
    expect(body.ocs).toHaveLength(1);
    expect(body.ocs[0]).toMatchObject({ supplierId: proveedorRodex.id });
    expect(store.pedidos.get(PEDIDO_ID)?.estado).toBe('ordenado');
  });

  it('409 sin adjudicacion registrada (precondicion de dominio)', async () => {
    const store = storeBase();
    agregarPedidoConItems(store, pedidoBase({ estado: 'aprobado' }));
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, {
        method: 'POST',
        pathname: `/api/portal/pedidos/${PEDIDO_ID}/ocs`,
        headers: conCsrf(),
        body: {},
      }),
      construirDeps(store),
    );
    expect(res?.status).toBe(409);
    expect(res?.body).toMatchObject({ error: 'validacion' });
  });
});

describe('GET /api/portal/pedidos/:id/aprobaciones', () => {
  it('403 para rol insuficiente (ingeniero)', async () => {
    const aprobacionesStore = new FakeAprobacionesStore();
    aprobacionesStore.agregarPedido(PEDIDO_ID);
    const res = await resolverPortalRequest(
      req(INGENIERO, { pathname: `/api/portal/pedidos/${PEDIDO_ID}/aprobaciones` }),
      construirDeps(storeBase(), aprobacionesStore),
    );
    expect(res?.status).toBe(403);
  });

  it('404 si el pedido no existe', async () => {
    const res = await resolverPortalRequest(
      req(ADMIN_MATERIALES, { pathname: `/api/portal/pedidos/${PEDIDO_ID}/aprobaciones` }),
      construirDeps(storeBase()),
    );
    expect(res?.status).toBe(404);
    expect(res?.body).toMatchObject({ error: 'pedido_no_encontrado' });
  });

  it('200 con historial mas reciente primero', async () => {
    const aprobacionesStore = new FakeAprobacionesStore();
    aprobacionesStore.agregarPedido(PEDIDO_ID);
    aprobacionesStore.agregarEvento({
      pedidoId: PEDIDO_ID,
      tipo: 'lista_proveedores',
      aprobadoPorId: ADMIN_MATERIALES,
      aprobadoPorNombre: 'Jose Pablo',
      canal: 'web',
      at: new Date('2026-07-09T10:00:00.000Z'),
    });
    aprobacionesStore.agregarEvento({
      pedidoId: PEDIDO_ID,
      tipo: 'ganador',
      aprobadoPorId: ADMIN_MATERIALES,
      aprobadoPorNombre: 'Jose Pablo',
      canal: 'web',
      detalle: { asignaciones: [], comparativo: {} },
      at: new Date('2026-07-10T10:00:00.000Z'),
    });

    const res = await resolverPortalRequest(
      req(SUPERADMIN, { pathname: `/api/portal/pedidos/${PEDIDO_ID}/aprobaciones` }),
      construirDeps(storeBase(), aprobacionesStore),
    );
    expect(res?.status).toBe(200);
    const body = res?.body as { items: { tipo: string; aprobadoPor: { userId: string; nombre: string } }[] };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.tipo).toBe('ganador');
    expect(body.items[1]?.tipo).toBe('lista_proveedores');
    expect(body.items[0]?.aprobadoPor).toEqual({ userId: ADMIN_MATERIALES, nombre: 'Jose Pablo' });
  });
});
