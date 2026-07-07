/**
 * Politica de aprobacion y de decision del agente (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/tools.md (que tool registra que `approval_events`) y
 * docs/EXECUTION_PLAN.md §1.5 / "Politica de decision": el agente SIEMPRE puede recomendar,
 * pero NUNCA adjudica un ganador ni emite una OC por su cuenta. La aprobacion humana en
 * seleccion de ganador, emision de OC, confirmacion de recepcion, aplicacion de NC ambigua
 * y cierre es obligatoria y queda registrada en `approval_events`.
 */
import type { Tool } from './roles.js';
import type { TipoAprobacion } from './types.js';
/**
 * Tipo de aprobacion humana que exige la accion, o `null` si no requiere aprobacion.
 * (enviar_rfq->lista_proveedores, aprobar_ganador->ganador, emitir_oc->emision_oc,
 *  confirmar_recepcion->recepcion, asociar_nota_credito->nc, cerrar_pedido->cierre.)
 */
export declare function requiereAprobacion(accion: Tool): TipoAprobacion | null;
/** `true` si la accion no puede ejecutarse sin una aprobacion humana registrada. */
export declare function requiereAprobacionHumana(accion: Tool): boolean;
/**
 * Politica explicita: el agente recomienda ganador pero NUNCA adjudica solo.
 * La adjudicacion viene de decision humana (aprobar_ganador con approval_events(ganador)).
 * (tools.md `aprobar_ganador`; EXECUTION_PLAN §1.5.)
 */
export declare function agentePuedeAdjudicarSolo(): boolean;
/**
 * Politica explicita: el agente NUNCA emite una OC sin instruccion humana en el turno.
 * (tools.md `emitir_oc` guard: "nunca auto-invocada por el agente sin instruccion humana".)
 */
export declare function agentePuedeEmitirOcSolo(): boolean;
//# sourceMappingURL=policy.d.ts.map