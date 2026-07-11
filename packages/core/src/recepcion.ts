/**
 * Computo de cobertura de recepcion de OC/pedido (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/state-machine.md §"Computo de cobertura de recepcion (regla
 * dura 3, determinista)" y regla dura 4 ("Sugerencia de cierre"). Entrada: cantidades pedidas
 * y recibidas ya agregadas (el agregado SQL sobre `receipt_confirmations`/`invoice_po_links`
 * vive en packages/agent, "tests cruzados core<->SQL obligatorios" segun la spec); salida:
 * estado objetivo de OC/pedido, puro y determinista.
 */

import type { EstadoOC, EstadoPedido } from './types.js';

// ---------------------------------------------------------------------------
// Cobertura de OC.
// ---------------------------------------------------------------------------

/** Item de OC con cantidad ordenada y cantidad recibida ya agregada (confirmada, conciliada). */
export interface ItemCobertura {
  readonly cantidad: number;
  readonly cantidadRecibida: number;
}

/** Umbrales relevantes para el computo de cobertura (subconjunto de `UmbralesConfig`). */
export interface UmbralesCobertura {
  /** E5: diferencia de cantidad recibida considerada "menor" (no bloquea el estado total). */
  readonly difCantidadMenor: number;
}

export type EstadoObjetivoOc = 'sin_recepcion' | 'recibida_parcial' | 'recibida_total';
export type EstadoObjetivoPedido = 'sin_recepcion' | 'recepcion_parcial' | 'recepcion_total';

/**
 * Estado objetivo de una OC segun la cobertura de sus items (state-machine.md §Computo de
 * cobertura, regla dura 3):
 * - `recibida_total` ⟺ TODO item tiene `cantidadRecibida >= cantidad - difCantidadMenor`.
 * - `recibida_parcial` ⟺ alguna `cantidadRecibida > 0` y no es total.
 * - `sin_recepcion` ⟺ ninguna cantidad recibida (cero recibido).
 *
 * DECISION documentada: `items` vacio se trata como `sin_recepcion` (no hay nada que
 * computar). Asume `cantidad >= 0` y `cantidadRecibida >= 0` (garantizado aguas arriba por
 * los CHECK de la base de datos); esta funcion no valida negativos porque es un computo, no
 * una validacion de entrada de usuario.
 */
export function estadoObjetivoOc(
  items: readonly ItemCobertura[],
  umbrales: UmbralesCobertura,
): EstadoObjetivoOc {
  if (items.length === 0) return 'sin_recepcion';
  const hayRecepcion = items.some((it) => it.cantidadRecibida > 0);
  if (!hayRecepcion) return 'sin_recepcion';
  const esTotal = items.every(
    (it) => it.cantidadRecibida >= it.cantidad - umbrales.difCantidadMenor,
  );
  return esTotal ? 'recibida_total' : 'recibida_parcial';
}

// ---------------------------------------------------------------------------
// Cobertura de pedido (agregado de sus OCs).
// ---------------------------------------------------------------------------

/** OC reducida a su estado, para el computo de cobertura del pedido. */
export interface OcParaCobertura {
  readonly estado: EstadoOC;
}

/**
 * Estado objetivo de un pedido segun el estado de sus OCs no-anuladas (state-machine.md
 * §Computo de cobertura, regla dura 3):
 * - `recepcion_total` ⟺ TODAS las OCs no-anuladas estan `recibida_total` y hay al menos una
 *   OC no-anulada.
 * - `recepcion_parcial` ⟺ existe alguna OC no-anulada `recibida_parcial` o `recibida_total`
 *   y no es total.
 * - `sin_recepcion` ⟺ ninguna OC no-anulada tiene recepcion.
 *
 * DECISION documentada: si `ocs` esta vacio o TODAS estan `anulada`, el resultado es
 * `sin_recepcion` (sin OCs vigentes no hay base para afirmar cobertura total ni parcial).
 */
export function estadoObjetivoPedido(
  ocs: readonly OcParaCobertura[],
): EstadoObjetivoPedido {
  const noAnuladas = ocs.filter((oc) => oc.estado !== 'anulada');
  if (noAnuladas.length === 0) return 'sin_recepcion';
  const esTotal = noAnuladas.every((oc) => oc.estado === 'recibida_total');
  if (esTotal) return 'recepcion_total';
  const hayRecepcion = noAnuladas.some(
    (oc) => oc.estado === 'recibida_total' || oc.estado === 'recibida_parcial',
  );
  return hayRecepcion ? 'recepcion_parcial' : 'sin_recepcion';
}

// ---------------------------------------------------------------------------
// Sugerencia de cierre (regla dura 4).
// ---------------------------------------------------------------------------

/**
 * Regla dura 4 (state-machine.md): "cuando el pedido llega a `recepcion_total` y no hay NC
 * pendientes ni items en `review_queue`, el sistema notifica a Proveeduria sugiriendo
 * cierre". El agente SOLO sugiere; nunca cierra el pedido por su cuenta — Proveeduria
 * confirma via la tool `cerrar_pedido` (`approval_events(cierre)`).
 */
export function debeSugerirCierre(input: {
  readonly estadoPedido: EstadoPedido;
  readonly ncPendientes: number;
  readonly revisionesAbiertas: number;
}): boolean {
  return (
    input.estadoPedido === 'recepcion_total' &&
    input.ncPendientes === 0 &&
    input.revisionesAbiertas === 0
  );
}
