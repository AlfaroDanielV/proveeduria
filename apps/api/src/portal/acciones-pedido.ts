/**
 * Ejecuta una tool de dominio de `@proveeduria/agent` para una accion del portal sobre un
 * pedido especifico (docs/specs/portal-api.md §Aprobaciones y acciones de pedido;
 * docs/specs/control-center.md §Principios 1-2).
 *
 * Replica EXACTAMENTE el camino del worker para el mismo pedido
 * (`apps/worker/src/domain/handler.ts` `tomarLockPedidoSiAplica`): toma
 * `pg_advisory_xact_lock(hashtext('pedido:' || pedidoId))` ANTES de correr la tool, dentro de
 * la MISMA transaccion (`withTx`) que la tool usa para su dominio + `audit_events` +
 * `approval_events`/outbox. Misma clave de lock (`'pedido:' + id`) que el worker: una accion
 * web y un mensaje de WhatsApp sobre el mismo pedido nunca corren en paralelo (dobles E12
 * evitados por el lock de Postgres, no por logica de aplicacion).
 *
 * `Ctx.origen = 'web'` (canal de aprobacion `'web'` via `canalAprobacionDesdeCtx`,
 * `packages/agent/src/tools/pedido.ts`) es la unica diferencia de contexto vs el worker
 * (que usa `origen: 'wamid'`).
 */

import type { Pool } from 'pg';
import { crearCtx, withTx } from '@proveeduria/agent';
import type { Actor, Ctx, ResultadoTool } from '@proveeduria/agent';

/** Misma clave de lock que `apps/worker/src/domain/handler.ts` (`tomarLockPedidoSiAplica`). */
function claveLockPedido(pedidoId: string): string {
  return `pedido:${pedidoId}`;
}

export interface EjecutarToolPedidoInput<T> {
  readonly pool: Pool;
  readonly actor: Actor;
  readonly pedidoId: string;
  readonly ahora: Date;
  /** Recibe el `Ctx` real (origen `'web'`, repos PG) ya con el lock del pedido tomado. */
  readonly tool: (ctx: Ctx) => Promise<ResultadoTool<T>>;
}

/**
 * Implementacion real contra Postgres: abre `withTx(pool, ...)`, toma el advisory lock del
 * pedido, arma el `Ctx` real (`crearCtx`, repos PG por defecto) con `origen: 'web'` y corre
 * `tool`. Si `tool` lanza o devuelve `err`, `withTx` hace `ROLLBACK` igual (un `ResultadoTool`
 * con `ok: false` NO lanza, asi que su efecto de dominio SI puede haber escrito algo antes de
 * fallar la validacion — exactamente igual que cuando el worker corre la misma tool; el
 * contrato de "todo o nada" de cada tool ya lo garantiza la tool misma antes de escribir).
 */
export async function ejecutarToolPedido<T>(
  input: EjecutarToolPedidoInput<T>,
): Promise<ResultadoTool<T>> {
  return withTx(input.pool, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [claveLockPedido(input.pedidoId)]);
    const ctx = crearCtx({ tx, actor: input.actor, ahora: input.ahora, origen: 'web' });
    return input.tool(ctx);
  });
}

/**
 * Seam inyectable en `PortalDeps` (igual forma que `ejecutarToolPedido` pero sin `pool`: ya
 * viene ligado por quien lo construye). El wiring real (`index.ts`) lo arma con
 * `crearEjecutorToolPedido(pool)`; los tests de ruta inyectan un fake que arma un `Ctx` con
 * `crearFakeCtx`/`crearFakeRepos` (`@proveeduria/agent`, exportados para testing) en vez de
 * abrir Postgres — mismas tools reales, sin reimplementar el dominio en el fake.
 */
export type EjecutorToolPedido = <T>(
  input: Omit<EjecutarToolPedidoInput<T>, 'pool'>,
) => Promise<ResultadoTool<T>>;

/** Factory para `index.ts` (mismo patron que `crearEmitirCredenciales(pool)` de `index.ts`). */
export function crearEjecutorToolPedido(pool: Pool): EjecutorToolPedido {
  return (input) => ejecutarToolPedido({ ...input, pool });
}
