/**
 * Maquina de estados del pedido (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/state-machine.md. Toda transicion fuera de la tabla
 * `TRANSICIONES` es invalida y se rechaza (E12). Defensa en profundidad: la BD replica
 * esta tabla por trigger, pero la verdad canonica vive aqui.
 *
 * Reconciliacion de roles (packages/core/CLAUDE.md): "Proveeduria" == admin_materiales,
 * "Gerencia" (lectura amplia / cancelacion) == superadmin. No existe rol `gerencia`.
 */
import type { ActorTransicion, EstadoPedido, Result, TipoAprobacion } from './types.js';
/** Una transicion valida de la maquina de estados. */
export interface Transicion {
    readonly de: EstadoPedido;
    readonly a: EstadoPedido;
    /** Quien la activa (state-machine.md columna "Quien lo activa"). */
    readonly actor: ActorTransicion;
    /** Aprobacion humana obligatoria que debe existir para esta transicion (approval_events). */
    readonly requiresApproval?: TipoAprobacion;
    /** Cancelacion exige motivo (state-machine.md: "con motivo obligatorio"). */
    readonly requiereMotivo?: true;
    readonly descripcion: string;
}
/** Error de transicion invalida. Codigo E12 (exceptions.md). */
export interface ErrorTransicion {
    readonly codigo: 'E12';
    readonly mensaje: string;
}
export type ResultadoTransicion = Result<void, ErrorTransicion>;
export declare const TRANSICIONES: readonly Transicion[];
/** Devuelve la transicion `de -> a` si existe. */
export declare function buscarTransicion(de: EstadoPedido, a: EstadoPedido): Transicion | undefined;
/**
 * E12: valida que la transicion `de -> a` exista en la maquina de estados.
 * Regla dura: `cerrado`/`cancelado` son terminales e inmutables (no tienen salida).
 * `ordenado`+ no admite `cancelado` (no esta en la tabla).
 */
export declare function puedeTransicionar(de: EstadoPedido, a: EstadoPedido): ResultadoTransicion;
/** Estados alcanzables desde `estado` en un paso. */
export declare function transicionesValidasDesde(estado: EstadoPedido): readonly EstadoPedido[];
/** `true` si el estado es terminal (sin transiciones de salida): cerrado o cancelado. */
export declare function esTerminal(estado: EstadoPedido): boolean;
/** `true` si la transicion existe y exige motivo (cancelaciones). */
export declare function transicionRequiereMotivo(de: EstadoPedido, a: EstadoPedido): boolean;
/** Aprobacion humana obligatoria de la transicion, o `null` si no requiere. */
export declare function aprobacionDeTransicion(de: EstadoPedido, a: EstadoPedido): TipoAprobacion | null;
/**
 * `true` si `solicitante` esta autorizado a disparar la transicion `de -> a`.
 *
 * - Transiciones `sistema` (automaticas, via cron/worker/outbox) solo las dispara el
 *   sistema; el LLM/humano no las "fuerza" (state-machine.md regla 5).
 * - Transiciones por `roles` requieren que el solicitante tenga al menos un rol permitido.
 */
export declare function actorAutorizado(de: EstadoPedido, a: EstadoPedido, solicitante: ActorTransicion): boolean;
//# sourceMappingURL=state-machine.d.ts.map