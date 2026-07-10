import type { IncomingHttpHeaders } from 'node:http';

import type { PortalActor } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function esUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function leerUserId(headers: IncomingHttpHeaders): string | null {
  const raw = headers['x-user-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return esUuid(trimmed) ? trimmed : null;
}

export function tieneAccesoGlobal(actor: PortalActor): boolean {
  return actor.roles.includes('superadmin') || actor.roles.includes('admin_materiales');
}

export function puedeLeerProyecto(actor: PortalActor, projectId: string): boolean {
  return tieneAccesoGlobal(actor) || actor.projectIds.includes(projectId);
}
