import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { ESTADOS_PEDIDO } from '@proveeduria/core';
import type { EstadoPedido } from '@proveeduria/core';

import { esUuid, leerUserId, puedeLeerProyecto } from './auth.js';
import type { ListarPedidosFiltro, PortalStore } from './types.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-user-id',
  'access-control-max-age': '600',
} as const;

export interface PortalRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
}

export interface PortalResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

export interface PortalDeps {
  readonly store: PortalStore;
}

function json(status: number, body: unknown): PortalResponse {
  return {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
    },
    body,
  };
}

function empty(status: number): PortalResponse {
  return { status, headers: { ...CORS_HEADERS } };
}

function parseEntero(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === null || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function parseFiltro(searchParams: URLSearchParams): ListarPedidosFiltro | { error: string } {
  const limit = parseEntero(searchParams.get('limit'), 25, 1, 100);
  if (limit === null) return { error: 'limit debe ser un entero entre 1 y 100.' };
  const offset = parseEntero(searchParams.get('offset'), 0, 0, 100_000);
  if (offset === null) return { error: 'offset debe ser un entero mayor o igual a 0.' };

  const filtro: {
    estado?: EstadoPedido;
    projectId?: string;
    limit: number;
    offset: number;
  } = { limit, offset };

  const estado = searchParams.get('estado');
  if (estado !== null && estado !== '') {
    if (!ESTADOS_PEDIDO.includes(estado as EstadoPedido)) {
      return { error: 'estado no es valido.' };
    }
    filtro.estado = estado as EstadoPedido;
  }

  const projectId = searchParams.get('projectId');
  if (projectId !== null && projectId !== '') {
    if (!esUuid(projectId)) return { error: 'projectId debe ser UUID.' };
    filtro.projectId = projectId;
  }

  return filtro;
}

function partes(pathname: string): readonly string[] {
  return pathname.replace(/^\/api\/portal\/?/, '').split('/').filter(Boolean);
}

export async function resolverPortalRequest(
  req: PortalRequest,
  { store }: PortalDeps,
): Promise<PortalResponse | null> {
  if (!req.pathname.startsWith('/api/portal')) return null;

  if (req.method === 'OPTIONS') return empty(204);
  if (req.method !== 'GET') {
    return json(405, { error: 'metodo_no_permitido' });
  }

  const userId = leerUserId(req.headers);
  if (userId === null) {
    return json(401, { error: 'auth_requerida', message: 'Envia X-User-Id con un usuario interno activo.' });
  }

  const actor = await store.usuarioPorId(userId);
  if (actor === null) {
    return json(403, { error: 'usuario_no_autorizado' });
  }

  const path = partes(req.pathname);

  if (path.length === 1 && path[0] === 'me') {
    return json(200, { user: actor });
  }

  if (path.length === 1 && path[0] === 'pedidos') {
    const filtro = parseFiltro(req.searchParams);
    if ('error' in filtro) return json(400, { error: 'request_invalido', message: filtro.error });
    if (filtro.projectId !== undefined && !puedeLeerProyecto(actor, filtro.projectId)) {
      return json(403, { error: 'fuera_de_alcance' });
    }
    return json(200, await store.listarPedidos(actor, filtro));
  }

  if (path.length >= 2 && path[0] === 'pedidos') {
    const pedidoId = path[1];
    if (pedidoId === undefined || !esUuid(pedidoId)) {
      return json(400, { error: 'request_invalido', message: 'pedidoId debe ser UUID.' });
    }

    if (path.length === 2) {
      const detalle = await store.detallePedido(actor, pedidoId);
      return detalle === null
        ? json(404, { error: 'pedido_no_encontrado' })
        : json(200, detalle);
    }

    if (path.length === 3 && path[2] === 'comparativo') {
      const comparativo = await store.comparativoPedido(actor, pedidoId);
      return comparativo === null
        ? json(404, { error: 'pedido_no_encontrado' })
        : json(200, comparativo);
    }
  }

  return json(404, { error: 'ruta_no_encontrada' });
}

export async function manejarPortalApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const response = await resolverPortalRequest(
    {
      method: req.method ?? 'GET',
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: req.headers,
    },
    deps,
  );

  if (response === null) return false;

  res.writeHead(response.status, response.headers);
  if (response.body === undefined || response.status === 204) {
    res.end();
    return true;
  }
  res.end(JSON.stringify(response.body));
  return true;
}
