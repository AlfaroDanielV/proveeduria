/**
 * Catalogo de tools del agente y matriz tool -> roles permitidos (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/tools.md. Equivale a `TOOL_ROLES` del prototipo (server.js).
 * El LLM nunca decide permisos: toda tool valida el rol del solicitante antes de ejecutar.
 *
 * Reconciliacion de roles (packages/core/CLAUDE.md): "Proveeduria" == admin_materiales,
 * "Gerencia" (lectura amplia) == superadmin. Se traducen a esos nombres del esquema.
 *
 * Fuera de alcance del Modulo 1 (NO incluidas): las tools de contratistas del prototipo
 * (`registrar_contratista/contrato/orden_cambio/pago_contratista`, `consultar_contratistas`).
 */

import type { Rol } from './types.js';
import { ROLES } from './types.js';

/** Tools expuestas al agente (tools.md). */
export const TOOLS = [
  // Pedidos
  'crear_pedido',
  'confirmar_pedido',
  // Cotizaciones
  'sugerir_proveedores',
  'enviar_rfq',
  'registrar_cotizacion',
  'generar_comparativo',
  // Adjudicacion y OC
  'aprobar_ganador',
  'emitir_oc',
  // Recepcion
  'registrar_factura',
  'confirmar_recepcion',
  'asociar_nota_credito',
  'cerrar_pedido',
  // Equipos de alquiler
  'registrar_equipo',
  'registrar_devolucion',
  'consultar_inventario_equipos',
  // Consultas y utilidades
  'consultar_datos',
  'generar_link_dashboard',
  'exportar_datos',
  'registrar_retroalimentacion',
] as const;
export type Tool = (typeof TOOLS)[number];

/**
 * Roles internos permitidos por tool (tools.md).
 *
 * Notas de traduccion tools.md -> esquema:
 * - "Proveeduria" => admin_materiales; "Gerencia" => superadmin (deduplicado).
 * - `confirmar_pedido`: la spec exige "el solicitante del pedido"; el conjunto de roles que
 *   pueden ser solicitantes es el de `crear_pedido`. La verificacion de identidad exacta
 *   (que sea EL solicitante) es un guard de instancia fuera del core.
 * - `registrar_cotizacion`: los proveedores la disparan por contexto del router (no son
 *   `users` con rol); aqui solo figuran los roles internos del reenvio manual de Proveeduria.
 * - `confirmar_recepcion`: la spec lista solo "bodeguero (del proyecto), admin_materiales"
 *   (sin superadmin explicito); se respeta literalmente.
 */
export const TOOL_ROLES: Record<Tool, readonly Rol[]> = {
  crear_pedido: ['ingeniero', 'admin_materiales', 'superadmin'],
  confirmar_pedido: ['ingeniero', 'admin_materiales', 'superadmin'],
  sugerir_proveedores: ['admin_materiales', 'superadmin'],
  enviar_rfq: ['admin_materiales', 'superadmin'],
  registrar_cotizacion: ['admin_materiales', 'superadmin'],
  generar_comparativo: ['admin_materiales', 'superadmin'],
  aprobar_ganador: ['admin_materiales', 'superadmin'],
  emitir_oc: ['admin_materiales', 'superadmin'],
  registrar_factura: ['bodeguero', 'admin_materiales', 'superadmin'],
  confirmar_recepcion: ['bodeguero', 'admin_materiales'],
  asociar_nota_credito: ['admin_materiales', 'superadmin'],
  cerrar_pedido: ['admin_materiales', 'superadmin'],
  registrar_equipo: ['bodeguero', 'admin_equipos', 'superadmin'],
  registrar_devolucion: ['bodeguero', 'admin_equipos', 'superadmin'],
  consultar_inventario_equipos: ['admin_equipos', 'superadmin'],
  consultar_datos: ROLES,
  generar_link_dashboard: ['admin_materiales', 'admin_equipos', 'superadmin'],
  exportar_datos: ['admin_materiales', 'superadmin'],
  registrar_retroalimentacion: ROLES,
};

/** `true` si alguno de los roles del solicitante puede usar la tool. */
export function puedeUsarTool(tool: Tool, roles: readonly Rol[]): boolean {
  const permitidos = TOOL_ROLES[tool];
  return roles.some((r) => permitidos.includes(r));
}

/** Roles permitidos para una tool (lectura). */
export function rolesDeTool(tool: Tool): readonly Rol[] {
  return TOOL_ROLES[tool];
}
