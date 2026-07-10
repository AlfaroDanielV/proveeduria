import { describe, expect, it } from 'vitest';

import { resolverPortalRequest } from './routes.js';
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
    email: 'proveeduria@proyekta.cr',
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

function req(path: string, headers: Record<string, string> = { 'x-user-id': USER_ID }) {
  const url = new URL(path, 'http://localhost');
  return {
    method: 'GET',
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers,
  };
}

describe('resolverPortalRequest', () => {
  it('ignora rutas fuera de /api/portal', async () => {
    const store = new FakePortalStore();
    await expect(resolverPortalRequest(req('/webhook'), { store })).resolves.toBeNull();
  });

  it('rechaza peticiones sin X-User-Id', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(req('/api/portal/me', {}), { store });
    expect(res?.status).toBe(401);
    expect(res?.body).toMatchObject({ error: 'auth_requerida' });
  });

  it('lista pedidos con filtros validados', async () => {
    const store = new FakePortalStore();
    const res = await resolverPortalRequest(
      req(`/api/portal/pedidos?estado=en_revision&projectId=${PROJECT_ID}&limit=10&offset=5`),
      { store },
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
    const res = await resolverPortalRequest(req('/api/portal/pedidos?estado=listo'), { store });
    expect(res?.status).toBe(400);
  });

  it('resuelve detalle y comparativo por pedido', async () => {
    const store = new FakePortalStore();
    const detalle = await resolverPortalRequest(req(`/api/portal/pedidos/${PEDIDO_ID}`), { store });
    const comparativo = await resolverPortalRequest(
      req(`/api/portal/pedidos/${PEDIDO_ID}/comparativo`),
      { store },
    );

    expect(detalle?.status).toBe(200);
    expect(comparativo?.status).toBe(200);
    expect(comparativo?.body).toMatchObject({
      pedido: { id: PEDIDO_ID, numero: 'PED-2026-001' },
    });
  });
});
