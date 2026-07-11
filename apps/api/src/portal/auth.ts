import type { PortalActor } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function esUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function tieneAccesoGlobal(actor: PortalActor): boolean {
  return actor.roles.includes('superadmin') || actor.roles.includes('admin_materiales');
}

export function puedeLeerProyecto(actor: PortalActor, projectId: string): boolean {
  return tieneAccesoGlobal(actor) || actor.projectIds.includes(projectId);
}

// ---------------------------------------------------------------------------
// Matriz de permisos portal-only (docs/specs/control-center.md §Matriz de permisos).
// ---------------------------------------------------------------------------

/** Ver proveedores: admin_materiales, admin_equipos, superadmin. */
export function puedeLeerProveedores(actor: PortalActor): boolean {
  return actor.roles.some(
    (r) => r === 'admin_materiales' || r === 'admin_equipos' || r === 'superadmin',
  );
}

/** Crear/editar proveedor y contactos (opt-in/BAJA): admin_materiales, superadmin. */
export function puedeEscribirProveedores(actor: PortalActor): boolean {
  return actor.roles.some((r) => r === 'admin_materiales' || r === 'superadmin');
}

/** Ver y resolver cola de revision: admin_materiales, superadmin. */
export function puedeGestionarRevisiones(actor: PortalActor): boolean {
  return actor.roles.some((r) => r === 'admin_materiales' || r === 'superadmin');
}

/**
 * Ver/actuar sobre aprobaciones de pedido (historial + `enviar_rfq`/`aprobar_ganador`/
 * `emitir_oc` via el portal): admin_materiales, superadmin (portal-api.md §Aprobaciones y
 * acciones de pedido; control-center.md matriz de permisos). Mismo conjunto de roles que
 * `TOOL_ROLES` de `@proveeduria/core` para esas 3 tools — las tools tambien lo validan por
 * su cuenta (el LLM/portal nunca decide permisos), este chequeo evita abrir una transaccion
 * y tomar el advisory lock cuando ya sabemos que el rol no alcanza.
 */
export function puedeGestionarAprobaciones(actor: PortalActor): boolean {
  return actor.roles.some((r) => r === 'admin_materiales' || r === 'superadmin');
}
