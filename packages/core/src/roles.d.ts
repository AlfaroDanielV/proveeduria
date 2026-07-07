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
/** Tools expuestas al agente (tools.md). */
export declare const TOOLS: readonly ["crear_pedido", "confirmar_pedido", "sugerir_proveedores", "enviar_rfq", "registrar_cotizacion", "generar_comparativo", "aprobar_ganador", "emitir_oc", "registrar_factura", "confirmar_recepcion", "asociar_nota_credito", "cerrar_pedido", "registrar_equipo", "registrar_devolucion", "consultar_inventario_equipos", "consultar_datos", "generar_link_dashboard", "exportar_datos", "registrar_retroalimentacion"];
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
export declare const TOOL_ROLES: Record<Tool, readonly Rol[]>;
/** `true` si alguno de los roles del solicitante puede usar la tool. */
export declare function puedeUsarTool(tool: Tool, roles: readonly Rol[]): boolean;
/** Roles permitidos para una tool (lectura). */
export declare function rolesDeTool(tool: Tool): readonly Rol[];
//# sourceMappingURL=roles.d.ts.map