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

import type {
  ActorTransicion,
  EstadoPedido,
  Result,
  Rol,
  TipoAprobacion,
} from './types.js';
import { ESTADOS_TERMINALES, err, ok } from './types.js';

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

// ---------------------------------------------------------------------------
// Actores. "Proveeduria" == admin_materiales; su superset "Gerencia" == superadmin.
// Cancelacion la puede hacer "Proveeduria o Gerencia" -> mismo conjunto.
// ---------------------------------------------------------------------------

const PROVEEDURIA: readonly Rol[] = ['admin_materiales', 'superadmin'];

const sistema: ActorTransicion = { tipo: 'sistema' };
const proveeduria: ActorTransicion = { tipo: 'roles', roles: PROVEEDURIA };

// ---------------------------------------------------------------------------
// Tabla de transiciones (state-machine.md §"Transiciones validas").
// ---------------------------------------------------------------------------

export const TRANSICIONES: readonly Transicion[] = [
  {
    de: 'borrador',
    a: 'cotizando',
    actor: proveeduria,
    requiresApproval: 'lista_proveedores',
    descripcion: 'Proveeduria aprueba lista de proveedores y se envian RFQs (enviar_rfq).',
  },
  {
    de: 'cotizando',
    a: 'en_revision',
    actor: sistema,
    descripcion: 'Sistema: todas las cotizaciones recibidas O plazo vencido.',
  },
  {
    de: 'en_revision',
    a: 'cotizando',
    actor: proveeduria,
    descripcion: 'Proveeduria extiende plazo o invita mas proveedores.',
  },
  {
    de: 'en_revision',
    a: 'aprobado',
    actor: proveeduria,
    requiresApproval: 'ganador',
    descripcion: 'Proveeduria selecciona ganador unico o division (aprobar_ganador).',
  },
  {
    de: 'aprobado',
    a: 'ordenado',
    actor: sistema,
    requiresApproval: 'emision_oc',
    descripcion: 'Sistema: todas las OCs generadas y enviadas via outbox (emitir_oc).',
  },
  {
    de: 'ordenado',
    a: 'recepcion_parcial',
    actor: sistema,
    requiresApproval: 'recepcion',
    descripcion: 'Sistema: primera factura conciliada y recepcion confirmada, quedan pendientes.',
  },
  {
    de: 'ordenado',
    a: 'recepcion_total',
    actor: sistema,
    requiresApproval: 'recepcion',
    descripcion: 'Sistema: recepcion confirmada cubre todas las OCs del pedido.',
  },
  {
    de: 'recepcion_parcial',
    a: 'recepcion_parcial',
    actor: sistema,
    requiresApproval: 'recepcion',
    descripcion: 'Sistema: facturas adicionales que aun no completan.',
  },
  {
    de: 'recepcion_parcial',
    a: 'recepcion_total',
    actor: sistema,
    requiresApproval: 'recepcion',
    descripcion: 'Sistema: ultima recepcion cubre todas las OCs.',
  },
  {
    de: 'recepcion_total',
    a: 'cerrado',
    actor: proveeduria,
    requiresApproval: 'cierre',
    descripcion: 'Proveeduria confirma cierre; el agente lo sugiere, nunca cierra solo (cerrar_pedido).',
  },
  {
    de: 'borrador',
    a: 'cancelado',
    actor: proveeduria,
    requiereMotivo: true,
    descripcion: 'Proveeduria o Gerencia descartan el pedido con motivo obligatorio.',
  },
  {
    de: 'cotizando',
    a: 'cancelado',
    actor: proveeduria,
    requiereMotivo: true,
    descripcion: 'Proveeduria o Gerencia descartan el pedido con motivo obligatorio.',
  },
  {
    de: 'en_revision',
    a: 'cancelado',
    actor: proveeduria,
    requiereMotivo: true,
    descripcion: 'Proveeduria o Gerencia descartan el pedido con motivo obligatorio.',
  },
  {
    de: 'aprobado',
    a: 'cancelado',
    actor: proveeduria,
    requiereMotivo: true,
    descripcion: 'Proveeduria o Gerencia descartan el pedido con motivo obligatorio.',
  },
];

// ---------------------------------------------------------------------------
// Consultas puras sobre la tabla.
// ---------------------------------------------------------------------------

/** Devuelve la transicion `de -> a` si existe. */
export function buscarTransicion(
  de: EstadoPedido,
  a: EstadoPedido,
): Transicion | undefined {
  return TRANSICIONES.find((t) => t.de === de && t.a === a);
}

/**
 * E12: valida que la transicion `de -> a` exista en la maquina de estados.
 * Regla dura: `cerrado`/`cancelado` son terminales e inmutables (no tienen salida).
 * `ordenado`+ no admite `cancelado` (no esta en la tabla).
 */
export function puedeTransicionar(
  de: EstadoPedido,
  a: EstadoPedido,
): ResultadoTransicion {
  if (buscarTransicion(de, a)) return ok(undefined);
  const mensaje = esTerminal(de)
    ? `El pedido en estado "${de}" es terminal e inmutable; no admite transiciones (solicitada: "${a}").`
    : `Transicion invalida: no se permite pasar de "${de}" a "${a}".`;
  return err({ codigo: 'E12', mensaje });
}

/** Estados alcanzables desde `estado` en un paso. */
export function transicionesValidasDesde(
  estado: EstadoPedido,
): readonly EstadoPedido[] {
  return TRANSICIONES.filter((t) => t.de === estado).map((t) => t.a);
}

/** `true` si el estado es terminal (sin transiciones de salida): cerrado o cancelado. */
export function esTerminal(estado: EstadoPedido): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/** `true` si la transicion existe y exige motivo (cancelaciones). */
export function transicionRequiereMotivo(
  de: EstadoPedido,
  a: EstadoPedido,
): boolean {
  return buscarTransicion(de, a)?.requiereMotivo === true;
}

/** Aprobacion humana obligatoria de la transicion, o `null` si no requiere. */
export function aprobacionDeTransicion(
  de: EstadoPedido,
  a: EstadoPedido,
): TipoAprobacion | null {
  return buscarTransicion(de, a)?.requiresApproval ?? null;
}

/**
 * `true` si `solicitante` esta autorizado a disparar la transicion `de -> a`.
 *
 * - Transiciones `sistema` (automaticas, via cron/worker/outbox) solo las dispara el
 *   sistema; el LLM/humano no las "fuerza" (state-machine.md regla 5).
 * - Transiciones por `roles` requieren que el solicitante tenga al menos un rol permitido.
 */
export function actorAutorizado(
  de: EstadoPedido,
  a: EstadoPedido,
  solicitante: ActorTransicion,
): boolean {
  const t = buscarTransicion(de, a);
  if (!t) return false;
  const requerido = t.actor;
  if (requerido.tipo === 'sistema') {
    return solicitante.tipo === 'sistema';
  }
  if (solicitante.tipo !== 'roles') return false;
  return solicitante.roles.some((r) => requerido.roles.includes(r));
}
