/**
 * @proveeduria/agent — prompt, router, tools y extractores del agente Claude (Modulo 1).
 *
 * El contenido de produccion es de Fase 2 (docs/specs/tools.md). Reglas al implementarlo:
 *  - Un solo loop de agente Claude con router por remitente (interno vs proveedor vs
 *    desconocido E11). Los proveedores solo activan captura de cotizacion / confirmacion
 *    de OC; jamas tools internas.
 *  - Cada tool valida rol del solicitante contra @proveeduria/core (el LLM nunca decide
 *    permisos), corre en transaccion con su audit_event, y sus envios van al outbox.
 *  - Las excepciones E1..E13 son reglas deterministas en las tools, no juicio del LLM.
 *  - El prompt de produccion y la politica de decision los edita el humano, con goldens
 *    de conversacion como test de regresion (AI_ASSISTED_DEVELOPMENT.md §7).
 *
 * Este stub fija el paquete en el monorepo y publica el contrato de nombres de tools.
 */

import type { Rol } from '@proveeduria/core';

/** Nombres de las tools del agente segun docs/specs/tools.md (contrato a implementar). */
export const TOOLS_MODULO_1 = [
  'crear_pedido',
  'confirmar_pedido',
  'sugerir_proveedores',
  'enviar_rfq',
  'registrar_cotizacion',
  'generar_comparativo',
  'aprobar_ganador',
  'emitir_oc',
  'registrar_factura',
  'confirmar_recepcion',
  'asociar_nota_credito',
  'cerrar_pedido',
  'registrar_equipo',
  'registrar_devolucion',
  'consultar_inventario_equipos',
  'consultar_datos',
  'generar_link_dashboard',
  'exportar_datos',
  'registrar_retroalimentacion',
] as const;

export type ToolModulo1 = (typeof TOOLS_MODULO_1)[number];

/** Contexto minimo que el router resuelve por telefono antes de invocar cualquier tool. */
export interface ContextoRemitente {
  readonly tipo: 'interno' | 'proveedor' | 'desconocido';
  readonly userId?: string;
  readonly roles?: readonly Rol[];
  readonly supplierContactId?: string;
}

export * from './runtime/types.js';
export * from './runtime/tx.js';
export * from './runtime/approval.js';
export * from './runtime/audit.js';
export * from './runtime/outbox.js';
export * from './runtime/repos.js';
export * from './runtime/context.js';
export * from './runtime/approval-ganador.js';
// Fakes de testing (FakeToolStore/crearFakeRepos/crearFakeCtx/withFakeCtx): expuestos desde
// el paquete para que otros workspaces (p.ej. apps/api, tests de rutas del portal) puedan
// ejercitar las tools REALES contra un Ctx en memoria sin reimplementar el dominio ni abrir
// Postgres (docs/specs/portal-api.md §Aprobaciones y acciones de pedido).
export * from './runtime/fakes.js';
export * from './pdf/oc-pdf.js';
export * from './tools/pedido.js';
export * from './tools/adjudicacion.js';
export * from './tools/oc.js';
export * from './agent/types.js';
export * from './agent/structured.js';
export * from './agent/tool-dispatcher.js';
export * from './agent/loop.js';
