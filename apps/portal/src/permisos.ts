import type { Rol, Usuario } from './types';

/**
 * Matriz de permisos por accion web (docs/specs/control-center.md §Matriz de permisos).
 * Esto SOLO controla que la UI muestre u oculte pantallas/acciones; la autorizacion real
 * vive en el servidor — el cliente jamas es la fuente de verdad.
 */
export const ROLES_VER_PROVEEDORES: readonly Rol[] = ['admin_materiales', 'admin_equipos', 'superadmin'];
export const ROLES_ESCRIBIR_PROVEEDORES: readonly Rol[] = ['admin_materiales', 'superadmin'];
export const ROLES_VER_REVISIONES: readonly Rol[] = ['admin_materiales', 'superadmin'];
export const ROLES_RESOLVER_REVISIONES: readonly Rol[] = ['admin_materiales', 'superadmin'];
/** Aprobar lista de proveedores (enviar RFQs), adjudicar ganador y emitir OC(s). */
export const ROLES_APROBAR_PEDIDOS: readonly Rol[] = ['admin_materiales', 'superadmin'];

export function tieneAlgunRol(usuario: Usuario, roles: readonly Rol[]): boolean {
  return usuario.roles.some((rol) => roles.includes(rol));
}
