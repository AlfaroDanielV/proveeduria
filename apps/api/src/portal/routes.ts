import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { ESTADOS_PEDIDO, TIPOS_REVIEW_QUEUE } from '@proveeduria/core';
import type { EstadoPedido, TipoReviewQueue } from '@proveeduria/core';

import type { EjecutorToolPedido } from './acciones-pedido.js';
import {
  manejarAdjudicarGanador,
  manejarEmitirOc,
  manejarEnviarRfq,
  manejarHistorialAprobaciones,
} from './aprobaciones-routes.js';
import type { AuthRouteDeps } from './auth-routes.js';
import {
  manejarCambiarPassword,
  manejarEmitirCredenciales,
  manejarLogin,
  manejarLogout,
  manejarRefresh,
} from './auth-routes.js';
import {
  esUuid,
  puedeEscribirProveedores,
  puedeGestionarAprobaciones,
  puedeGestionarRevisiones,
  puedeLeerProveedores,
  puedeLeerProyecto,
} from './auth.js';
import { verificarJwt } from './crypto.js';
import {
  CuerpoDemasiadoGrandeError,
  JsonInvalidoError,
  leerCuerpoJson,
  parseCookies,
  primerHeader,
} from './http.js';
import {
  manejarActualizarContacto,
  manejarActualizarProveedor,
  manejarBajaContacto,
  manejarCrearContacto,
  manejarCrearProveedor,
  manejarOptinContacto,
} from './proveedores-routes.js';
import { manejarResolverRevision } from './revisiones-routes.js';
import type {
  AprobacionesStore,
  ListarPedidosFiltro,
  ListarProveedoresFiltro,
  ListarRevisionesFiltro,
  PortalStore,
  ProveedoresStore,
  RevisionesStore,
} from './types.js';

const COOKIE_TOKEN = 'portal_token';

function corsHeaders(portalOrigin: string | undefined): Record<string, string> {
  if (portalOrigin === undefined) return {};
  return {
    'access-control-allow-origin': portalOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'Content-Type, X-Portal-CSRF',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-max-age': '600',
  };
}

export interface PortalRequest {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly cookies: Readonly<Record<string, string>>;
  readonly body: unknown;
  /** IP del socket (la glue impura la llena); el rate limit prefiere X-Forwarded-For. */
  readonly remoteIp?: string;
}

export interface PortalResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body?: unknown;
}

export interface PortalDeps extends AuthRouteDeps {
  readonly store: PortalStore;
  readonly proveedoresStore: ProveedoresStore;
  readonly revisionesStore: RevisionesStore;
  readonly aprobacionesStore: AprobacionesStore;
  /** Ejecuta tools de dominio sobre un pedido con el lock/Ctx del portal (acciones-pedido.ts). */
  readonly ejecutarToolPedido: EjecutorToolPedido;
  readonly portalOrigin?: string | undefined;
}

function json(status: number, body: unknown): PortalResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body,
  };
}

function empty(status: number): PortalResponse {
  return { status, headers: {} };
}

function conCors(resp: PortalResponse, cors: Record<string, string>): PortalResponse {
  return { ...resp, headers: { ...cors, ...resp.headers } };
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

function parseFiltroProveedores(searchParams: URLSearchParams): ListarProveedoresFiltro | { error: string } {
  const limit = parseEntero(searchParams.get('limit'), 25, 1, 100);
  if (limit === null) return { error: 'limit debe ser un entero entre 1 y 100.' };
  const offset = parseEntero(searchParams.get('offset'), 0, 0, 100_000);
  if (offset === null) return { error: 'offset debe ser un entero mayor o igual a 0.' };

  const filtro: { activo?: boolean; q?: string; limit: number; offset: number } = { limit, offset };

  const activo = searchParams.get('activo');
  if (activo !== null && activo !== '') {
    if (activo !== 'true' && activo !== 'false') return { error: 'activo debe ser true o false.' };
    filtro.activo = activo === 'true';
  }

  const q = searchParams.get('q');
  if (q !== null && q.trim() !== '') filtro.q = q.trim();

  return filtro;
}

function parseFiltroRevisiones(searchParams: URLSearchParams): ListarRevisionesFiltro | { error: string } {
  const limit = parseEntero(searchParams.get('limit'), 25, 1, 100);
  if (limit === null) return { error: 'limit debe ser un entero entre 1 y 100.' };
  const offset = parseEntero(searchParams.get('offset'), 0, 0, 100_000);
  if (offset === null) return { error: 'offset debe ser un entero mayor o igual a 0.' };

  const estadoParam = searchParams.get('estado');
  const estado = estadoParam === null || estadoParam === '' ? 'pendiente' : estadoParam;
  if (estado !== 'pendiente' && estado !== 'resuelta') {
    return { error: 'estado debe ser pendiente o resuelta.' };
  }

  const filtro: {
    estado: 'pendiente' | 'resuelta';
    tipo?: TipoReviewQueue;
    projectId?: string;
    limit: number;
    offset: number;
  } = { estado, limit, offset };

  const tipo = searchParams.get('tipo');
  if (tipo !== null && tipo !== '') {
    if (!TIPOS_REVIEW_QUEUE.includes(tipo as TipoReviewQueue)) {
      return { error: 'tipo no es valido.' };
    }
    filtro.tipo = tipo as TipoReviewQueue;
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

/**
 * Resuelve una request del portal. Pura (sin IO real): `manejarPortalApi` es la unica
 * que toca `node:http`/Postgres. `null` => la ruta no es del portal.
 */
export async function resolverPortalRequest(
  req: PortalRequest,
  deps: PortalDeps,
): Promise<PortalResponse | null> {
  if (!req.pathname.startsWith('/api/portal')) return null;

  const cors = corsHeaders(deps.portalOrigin);

  if (req.method === 'OPTIONS') return conCors(empty(204), cors);

  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT') {
    return conCors(json(405, { error: 'metodo_no_permitido' }), cors);
  }

  const path = partes(req.pathname);
  const esMutacion = req.method === 'POST' || req.method === 'PUT';

  // CSRF: toda mutacion exige el header explicito, incluidas las rutas de auth
  // (control-center.md; SameSite=Strict + este header cierran el ataque cross-site).
  if (esMutacion && primerHeader(req.headers['x-portal-csrf']) !== '1') {
    return conCors(json(403, { error: 'csrf_requerido' }), cors);
  }

  // Rutas de auth sin sesion previa.
  if (req.method === 'POST' && path.length === 2 && path[0] === 'auth' && path[1] === 'login') {
    const userAgent = primerHeader(req.headers['user-agent']) ?? null;
    // IP para el rate limit: primer hop de X-Forwarded-For (ingress de Azure) o el socket.
    const xff = primerHeader(req.headers['x-forwarded-for']);
    const ip = xff !== undefined && xff.trim() !== ''
      ? (xff.split(',')[0] as string).trim()
      : req.remoteIp ?? null;
    return conCors(await manejarLogin(req.body, { userAgent, ip }, deps), cors);
  }
  if (req.method === 'POST' && path.length === 2 && path[0] === 'auth' && path[1] === 'refresh') {
    return conCors(await manejarRefresh(req.cookies, deps), cors);
  }

  // Toda otra ruta exige portal_token valido (reemplaza el seam X-User-Id).
  const token = req.cookies[COOKIE_TOKEN];
  if (token === undefined) {
    return conCors(json(401, { error: 'auth_requerida' }), cors);
  }
  const claims = verificarJwt({ token, secreto: deps.portalJwtSecret, ahora: deps.ahora() });
  if (claims === null) {
    return conCors(json(401, { error: 'auth_requerida' }), cors);
  }
  const actor = await deps.store.usuarioPorId(claims.sub);
  if (actor === null) {
    return conCors(json(403, { error: 'usuario_no_autorizado' }), cors);
  }

  if (req.method === 'POST' && path.length === 2 && path[0] === 'auth' && path[1] === 'logout') {
    return conCors(await manejarLogout(req.cookies, deps), cors);
  }
  if (req.method === 'POST' && path.length === 2 && path[0] === 'auth' && path[1] === 'cambiar-password') {
    return conCors(await manejarCambiarPassword(actor, req.body, deps), cors);
  }
  if (
    req.method === 'POST' &&
    path.length === 3 &&
    path[0] === 'usuarios' &&
    path[2] === 'credenciales'
  ) {
    const targetUserId = path[1];
    if (targetUserId === undefined || !esUuid(targetUserId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'userId debe ser UUID.' }), cors);
    }
    return conCors(await manejarEmitirCredenciales(actor, targetUserId, req.body, deps), cors);
  }

  // Proveedores/contactos: mutaciones (control-center.md §CRUD proveedores).
  if (req.method === 'POST' && path.length === 1 && path[0] === 'proveedores') {
    if (!puedeEscribirProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(await manejarCrearProveedor(actor, req.body, deps.proveedoresStore, deps.ahora()), cors);
  }
  if (req.method === 'PUT' && path.length === 2 && path[0] === 'proveedores') {
    const supplierId = path[1];
    if (supplierId === undefined || !esUuid(supplierId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'proveedorId debe ser UUID.' }), cors);
    }
    if (!puedeEscribirProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarActualizarProveedor(actor, supplierId, req.body, deps.proveedoresStore, deps.ahora()),
      cors,
    );
  }
  if (req.method === 'POST' && path.length === 3 && path[0] === 'proveedores' && path[2] === 'contactos') {
    const supplierId = path[1];
    if (supplierId === undefined || !esUuid(supplierId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'proveedorId debe ser UUID.' }), cors);
    }
    if (!puedeEscribirProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarCrearContacto(actor, supplierId, req.body, deps.proveedoresStore, deps.ahora()),
      cors,
    );
  }
  if (req.method === 'PUT' && path.length === 2 && path[0] === 'contactos') {
    const contactoId = path[1];
    if (contactoId === undefined || !esUuid(contactoId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'contactoId debe ser UUID.' }), cors);
    }
    if (!puedeEscribirProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarActualizarContacto(actor, contactoId, req.body, deps.proveedoresStore, deps.ahora()),
      cors,
    );
  }
  if (
    req.method === 'POST' &&
    path.length === 3 &&
    path[0] === 'contactos' &&
    (path[2] === 'optin' || path[2] === 'baja')
  ) {
    const contactoId = path[1];
    if (contactoId === undefined || !esUuid(contactoId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'contactoId debe ser UUID.' }), cors);
    }
    if (!puedeEscribirProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    const accion = path[2] === 'optin' ? manejarOptinContacto : manejarBajaContacto;
    return conCors(await accion(actor, contactoId, deps.proveedoresStore, deps.ahora()), cors);
  }

  // Cola de revision: resolver (control-center.md §Resolver cola de revision).
  if (req.method === 'POST' && path.length === 3 && path[0] === 'revisiones' && path[2] === 'resolver') {
    const revisionId = path[1];
    if (revisionId === undefined || !esUuid(revisionId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'revisionId debe ser UUID.' }), cors);
    }
    if (!puedeGestionarRevisiones(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarResolverRevision(actor, revisionId, req.body, deps.revisionesStore, deps.ahora()),
      cors,
    );
  }

  // Aprobaciones y acciones de pedido (C2, portal-api.md §Aprobaciones y acciones de pedido;
  // control-center.md §Principios): cada mutacion EJECUTA una tool de dominio real via
  // `deps.ejecutarToolPedido` (mismo lock/Ctx que el worker, `origen: 'web'`).
  if (req.method === 'POST' && path.length === 3 && path[0] === 'pedidos' && path[2] === 'rfqs') {
    const pedidoId = path[1];
    if (pedidoId === undefined || !esUuid(pedidoId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'pedidoId debe ser UUID.' }), cors);
    }
    if (!puedeGestionarAprobaciones(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarEnviarRfq(actor, pedidoId, req.body, deps.ejecutarToolPedido, deps.ahora()),
      cors,
    );
  }
  if (req.method === 'POST' && path.length === 3 && path[0] === 'pedidos' && path[2] === 'adjudicacion') {
    const pedidoId = path[1];
    if (pedidoId === undefined || !esUuid(pedidoId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'pedidoId debe ser UUID.' }), cors);
    }
    if (!puedeGestionarAprobaciones(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarAdjudicarGanador(actor, pedidoId, req.body, deps.ejecutarToolPedido, deps.ahora()),
      cors,
    );
  }
  if (req.method === 'POST' && path.length === 3 && path[0] === 'pedidos' && path[2] === 'ocs') {
    const pedidoId = path[1];
    if (pedidoId === undefined || !esUuid(pedidoId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'pedidoId debe ser UUID.' }), cors);
    }
    if (!puedeGestionarAprobaciones(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    return conCors(
      await manejarEmitirOc(actor, pedidoId, deps.ejecutarToolPedido, deps.ahora()),
      cors,
    );
  }

  if (req.method !== 'GET') {
    return conCors(json(404, { error: 'ruta_no_encontrada' }), cors);
  }

  if (path.length === 1 && path[0] === 'me') {
    return conCors(json(200, { user: actor }), cors);
  }

  if (path.length === 1 && path[0] === 'proveedores') {
    if (!puedeLeerProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    const filtro = parseFiltroProveedores(req.searchParams);
    if ('error' in filtro) return conCors(json(400, { error: 'request_invalido', message: filtro.error }), cors);
    return conCors(json(200, await deps.proveedoresStore.listar(filtro)), cors);
  }

  if (path.length === 2 && path[0] === 'proveedores') {
    if (!puedeLeerProveedores(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    const supplierId = path[1];
    if (supplierId === undefined || !esUuid(supplierId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'proveedorId debe ser UUID.' }), cors);
    }
    const proveedor = await deps.proveedoresStore.porId(supplierId);
    return conCors(
      proveedor === null ? json(404, { error: 'proveedor_no_encontrado' }) : json(200, proveedor),
      cors,
    );
  }

  if (path.length === 1 && path[0] === 'revisiones') {
    if (!puedeGestionarRevisiones(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
    const filtro = parseFiltroRevisiones(req.searchParams);
    if ('error' in filtro) return conCors(json(400, { error: 'request_invalido', message: filtro.error }), cors);
    return conCors(json(200, await deps.revisionesStore.listar(filtro)), cors);
  }

  if (path.length === 1 && path[0] === 'pedidos') {
    const filtro = parseFiltro(req.searchParams);
    if ('error' in filtro) return conCors(json(400, { error: 'request_invalido', message: filtro.error }), cors);
    if (filtro.projectId !== undefined && !puedeLeerProyecto(actor, filtro.projectId)) {
      return conCors(json(403, { error: 'fuera_de_alcance' }), cors);
    }
    return conCors(json(200, await deps.store.listarPedidos(actor, filtro)), cors);
  }

  if (path.length >= 2 && path[0] === 'pedidos') {
    const pedidoId = path[1];
    if (pedidoId === undefined || !esUuid(pedidoId)) {
      return conCors(json(400, { error: 'request_invalido', message: 'pedidoId debe ser UUID.' }), cors);
    }

    if (path.length === 2) {
      const detalle = await deps.store.detallePedido(actor, pedidoId);
      return conCors(
        detalle === null ? json(404, { error: 'pedido_no_encontrado' }) : json(200, detalle),
        cors,
      );
    }

    if (path.length === 3 && path[2] === 'comparativo') {
      const comparativo = await deps.store.comparativoPedido(actor, pedidoId);
      return conCors(
        comparativo === null ? json(404, { error: 'pedido_no_encontrado' }) : json(200, comparativo),
        cors,
      );
    }

    if (path.length === 3 && path[2] === 'aprobaciones') {
      if (!puedeGestionarAprobaciones(actor)) return conCors(json(403, { error: 'rol_insuficiente' }), cors);
      return conCors(await manejarHistorialAprobaciones(pedidoId, deps.aprobacionesStore), cors);
    }
  }

  return conCors(json(404, { error: 'ruta_no_encontrada' }), cors);
}

/**
 * Glue impura: lee cookies/body reales, delega a `resolverPortalRequest` y escribe la
 * respuesta. Chequea el prefijo `/api/portal` ANTES de tocar el body del request, para no
 * consumir el stream de requests que en realidad son del webhook (index.ts).
 */
export async function manejarPortalApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PortalDeps,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/portal')) return false;

  const method = req.method ?? 'GET';
  let body: unknown;
  if (method === 'POST' || method === 'PUT') {
    try {
      body = await leerCuerpoJson(req);
    } catch (e) {
      if (e instanceof CuerpoDemasiadoGrandeError) {
        res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'cuerpo_demasiado_grande' }));
        return true;
      }
      if (e instanceof JsonInvalidoError) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'json_invalido' }));
        return true;
      }
      throw e;
    }
  }

  const cookies = parseCookies(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined);

  const response = await resolverPortalRequest(
    {
      method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: req.headers,
      cookies,
      body,
      ...(req.socket.remoteAddress !== undefined
        ? { remoteIp: req.socket.remoteAddress }
        : {}),
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
