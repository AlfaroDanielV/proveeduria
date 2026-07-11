/**
 * Handlers puros de Aprobaciones y acciones de pedido del portal (C2, docs/specs/portal-api.md
 * §Aprobaciones y acciones de pedido; docs/specs/control-center.md §Principios). Mismo patron
 * que `proveedores-routes.ts`/`revisiones-routes.ts`: reciben el actor ya autenticado y sus
 * dependencias inyectadas; no tocan `node:http` ni Postgres directamente, y NO chequean rol
 * (eso lo hace `routes.ts` antes de llamarlos, igual que con `puedeGestionarRevisiones`).
 *
 * Cada mutacion EJECUTA la tool de dominio correspondiente de `@proveeduria/agent`
 * (`enviar_rfq` / `aprobar_ganador` / `emitir_oc`) via `ejecutarToolPedido`
 * (`acciones-pedido.ts`): misma transaccion + mismo advisory lock que el worker de
 * WhatsApp, `Ctx.origen = 'web'`. Esta capa NUNCA escribe SQL de dominio.
 *
 * ## Mapeo de errores de tool -> HTTP (portal-api.md §Aprobaciones y acciones de pedido)
 *
 * Las 3 tools que se ejecutan aca (`enviarRfq`/`aprobarGanador`/`emitirOc`, leidas de
 * `packages/agent/src/tools/{pedido,adjudicacion,oc}.ts`) solo devuelven 4 codigos de
 * `ErrorTool` en la practica: `rol_insuficiente`, `no_encontrado`, `E12` (transicion
 * invalida, `puedeTransicionar`) y `validacion`. El codigo `validacion` lo usan las tools
 * TANTO para forma de input invalida (parseo) COMO para precondiciones de dominio con forma
 * ya valida (p.ej. "sin adjudicacion registrada", "proveedor sin contacto opt-in", "el
 * pedido no tiene items", "el proveedor no coti el item X") — el tool no distingue el
 * codigo entre ambos casos.
 *
 * Esta capa de rutas SI valida la FORMA del body ANTES de invocar la tool (igual que
 * `proveedores-routes.ts`) y devuelve 400 ahi mismo si la forma es invalida. Por construccion,
 * entonces, cualquier `validacion` que devuelva la tool en este punto ya paso el chequeo de
 * forma y es una precondicion de DOMINIO -> 409 (regla explicita de portal-api.md: "sin
 * adjudicacion registrada"/"proveedor sin opt-in" -> 409). Mapeo final:
 *
 *   - `rol_insuficiente`                    -> 403
 *   - `no_encontrado`                        -> 404 (pedido/quote_request/etc. inexistente)
 *   - `E12`                                  -> 409 (transicion de estado invalida)
 *   - `validacion` (ya con forma valida)     -> 409 (precondicion de dominio)
 *   - cualquier otro `CodigoExcepcion` (defensivo; estas 3 tools no emiten otros hoy) -> 409
 */

import type { Actor, Ctx, ErrorTool, ResultadoTool } from '@proveeduria/agent';
import { aprobarGanador, emitirOc, enviarRfq } from '@proveeduria/agent';

import type { EjecutorToolPedido } from './acciones-pedido.js';
import type { AprobacionesStore, PortalActor } from './types.js';

export interface AprobacionRouteResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body?: unknown;
}

function json(status: number, body: unknown): AprobacionRouteResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
}

function actorAgent(actor: PortalActor): Actor {
  return { userId: actor.userId, roles: actor.roles, nombre: actor.nombre };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Ver mapeo documentado arriba. */
function mapErrorToolAHttp(error: ErrorTool): AprobacionRouteResponse {
  if (error.codigo === 'rol_insuficiente') {
    return json(403, { error: 'rol_insuficiente', message: error.mensaje });
  }
  if (error.codigo === 'no_encontrado') {
    return json(404, { error: 'pedido_no_encontrado', message: error.mensaje });
  }
  return json(409, { error: error.codigo, message: error.mensaje });
}

async function ejecutarYResponder<T>(
  resultado: Promise<ResultadoTool<T>>,
  aOk: (value: T) => Record<string, unknown>,
): Promise<AprobacionRouteResponse> {
  const result = await resultado;
  return result.ok ? json(200, aOk(result.value)) : mapErrorToolAHttp(result.error);
}

export async function manejarHistorialAprobaciones(
  pedidoId: string,
  store: AprobacionesStore,
): Promise<AprobacionRouteResponse> {
  const historial = await store.historial(pedidoId);
  return historial === null ? json(404, { error: 'pedido_no_encontrado' }) : json(200, historial);
}

/** Arreglo de texto no vacio (UUIDs de supplier/pedido_item): forma minima validada aca. */
function parseListaTextoNoVacio(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.map((v) => (typeof v === 'string' ? v.trim() : ''));
  if (items.some((item) => item === '')) return null;
  return items;
}

export async function manejarEnviarRfq(
  actor: PortalActor,
  pedidoId: string,
  body: unknown,
  ejecutar: EjecutorToolPedido,
  ahora: Date,
): Promise<AprobacionRouteResponse> {
  const b = isRecord(body) ? body : {};
  const supplierIds = parseListaTextoNoVacio(b.supplierIds);
  if (supplierIds === null) {
    return json(400, {
      error: 'request_invalido',
      message: 'supplierIds debe ser un arreglo no vacio de UUID.',
    });
  }
  let plazoHoras: number | undefined;
  if (b.plazoHoras !== undefined) {
    if (typeof b.plazoHoras !== 'number' || !Number.isFinite(b.plazoHoras) || b.plazoHoras <= 0) {
      return json(400, { error: 'request_invalido', message: 'plazoHoras debe ser un numero mayor que 0.' });
    }
    plazoHoras = b.plazoHoras;
  }

  return ejecutarYResponder(
    ejecutar({
      actor: actorAgent(actor),
      pedidoId,
      ahora,
      tool: (ctx: Ctx) => enviarRfq(
        { pedidoId, supplierIds, ...(plazoHoras !== undefined ? { plazoHoras } : {}) },
        ctx,
      ),
    }),
    (value) => ({ pedidoId: value.pedidoId, estado: value.estado, rfqs: value.quoteRequests.length }),
  );
}

interface AsignacionBody {
  readonly supplierId: string;
  readonly pedidoItemIds: readonly string[];
}

function parseAsignaciones(value: unknown): readonly AsignacionBody[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const asignaciones: AsignacionBody[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const supplierId = typeof item.supplierId === 'string' ? item.supplierId.trim() : '';
    if (supplierId === '') return null;
    const pedidoItemIds = parseListaTextoNoVacio(item.pedidoItemIds);
    if (pedidoItemIds === null) return null;
    asignaciones.push({ supplierId, pedidoItemIds });
  }
  return asignaciones;
}

export async function manejarAdjudicarGanador(
  actor: PortalActor,
  pedidoId: string,
  body: unknown,
  ejecutar: EjecutorToolPedido,
  ahora: Date,
): Promise<AprobacionRouteResponse> {
  const b = isRecord(body) ? body : {};
  const asignaciones = parseAsignaciones(b.asignaciones);
  if (asignaciones === null) {
    return json(400, {
      error: 'request_invalido',
      message: 'asignaciones debe ser un arreglo no vacio de { supplierId, pedidoItemIds }.',
    });
  }

  return ejecutarYResponder(
    ejecutar({
      actor: actorAgent(actor),
      pedidoId,
      ahora,
      tool: (ctx: Ctx) => aprobarGanador({ pedidoId, asignaciones }, ctx),
    }),
    (value) => ({ pedidoId: value.pedidoId, estado: value.estado }),
  );
}

export async function manejarEmitirOc(
  actor: PortalActor,
  pedidoId: string,
  ejecutar: EjecutorToolPedido,
  ahora: Date,
): Promise<AprobacionRouteResponse> {
  return ejecutarYResponder(
    ejecutar({
      actor: actorAgent(actor),
      pedidoId,
      ahora,
      tool: (ctx: Ctx) => emitirOc({ pedidoId }, ctx),
    }),
    (value) => ({
      pedidoId: value.pedidoId,
      estado: value.estado,
      ocs: value.ocs.map((oc) => ({
        ocId: oc.ocId,
        numero: oc.numero,
        supplierId: oc.supplierId,
        montoTotal: oc.montoTotal,
      })),
    }),
  );
}
