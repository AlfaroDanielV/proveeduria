/**
 * Handler puro de resolucion de la cola de revision (docs/specs/portal-api.md §Cola de
 * revision; docs/specs/control-center.md §Resolver cola de revision). Mismo patron que
 * `proveedores-routes.ts`/`auth-routes.ts`: sin `node:http` ni Postgres directo.
 */

import type { PortalActor, RevisionesStore } from './types.js';

export interface RevisionRouteResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body?: unknown;
}

function json(status: number, body: unknown): RevisionRouteResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
}

export async function manejarResolverRevision(
  actor: PortalActor,
  revisionId: string,
  body: unknown,
  store: RevisionesStore,
  ahora: Date,
): Promise<RevisionRouteResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const resolucion = typeof b.resolucion === 'string' ? b.resolucion.trim() : '';
  if (resolucion === '') {
    return json(400, { error: 'request_invalido', message: 'resolucion es requerida.' });
  }

  const resultado = await store.resolver(actor, revisionId, resolucion, ahora);
  if (!resultado.ok) {
    return resultado.error === 'no_encontrada'
      ? json(404, { error: 'revision_no_encontrada' })
      : json(409, { error: 'revision_ya_resuelta' });
  }
  return json(200, resultado.value);
}
