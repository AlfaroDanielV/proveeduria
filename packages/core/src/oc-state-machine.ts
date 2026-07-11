/**
 * Maquina de estados de la Orden de Compra (OC) — dominio puro.
 *
 * FUENTE DE VERDAD: docs/specs/state-machine.md §"Ciclo de la Orden de Compra (OC)". Espejo
 * del patron de `state-machine.ts` (pedido) para la maquina de estados de la OC: tabla de
 * transiciones + validacion + consultas puras. Se verifica tambien por trigger de DB
 * (migracion 009) como segunda barrera (defensa en profundidad).
 *
 * FUERA DE ALCANCE DE ESTE MODULO: la guardia de negocio "una OC con al menos una recepcion
 * registrada no es anulable" (regla dura 1 de la spec, "anulada solo sin recepciones") NO se
 * valida aqui. Esta funcion solo conoce la tabla de transiciones (estado -> estado); no
 * conoce el historial de recepciones de la OC (eso requiere datos de `receipt_confirmations`/
 * `invoice_po_links`). Esa guardia depende de datos y por tanto vive en la tool que ejecute
 * la anulacion (packages/agent), que debe consultar el dato y rechazar ANTES/ADEMAS de
 * `puedeTransicionarOc`. Hoy no existe tool de anular OC en Modulo 1 (regla dura 3 de la
 * spec: "pregunta abierta de negocio"); este modulo deja la maquina de estados lista para
 * cuando se especifique.
 */

import type { EstadoOC, Result } from './types.js';
import { err, ok } from './types.js';
import type { ErrorTransicion } from './state-machine.js';

/** Una transicion valida de la maquina de estados de la OC. */
export interface TransicionOc {
  readonly de: EstadoOC;
  readonly a: EstadoOC;
  readonly descripcion: string;
}

/** Reutiliza el mismo shape de error E12 que la maquina de estados del pedido. */
export type ResultadoTransicionOc = Result<void, ErrorTransicion>;

/** Estados terminales de la OC: sin transiciones de salida (state-machine.md regla dura 2). */
const ESTADOS_OC_TERMINALES: readonly EstadoOC[] = ['recibida_total', 'anulada'];

// ---------------------------------------------------------------------------
// Tabla de transiciones (state-machine.md §"Ciclo de la Orden de Compra (OC)").
// ---------------------------------------------------------------------------

export const TRANSICIONES_OC: readonly TransicionOc[] = [
  {
    de: 'emitida',
    a: 'confirmada',
    descripcion: 'Proveedor confirma recepcion de la OC; fija confirmada_por_proveedor_at.',
  },
  {
    de: 'emitida',
    a: 'recibida_parcial',
    descripcion:
      'Sistema: primera recepcion conciliada; la confirmacion del proveedor NO es prerequisito para recibir.',
  },
  {
    de: 'confirmada',
    a: 'recibida_parcial',
    descripcion: 'Sistema: primera recepcion que no cubre todos los po_items.',
  },
  {
    de: 'emitida',
    a: 'recibida_total',
    descripcion: 'Sistema: la recepcion cubre todos los po_items.',
  },
  {
    de: 'confirmada',
    a: 'recibida_total',
    descripcion: 'Sistema: la recepcion cubre todos los po_items.',
  },
  {
    de: 'recibida_parcial',
    a: 'recibida_parcial',
    descripcion: 'Sistema: recepciones adicionales que aun no completan.',
  },
  {
    de: 'recibida_parcial',
    a: 'recibida_total',
    descripcion: 'Sistema: la ultima recepcion cubre todo.',
  },
  {
    de: 'emitida',
    a: 'anulada',
    descripcion:
      'Flujo manual de Gerencia, con motivo; fuera del happy path del Modulo 1. Guardia ' +
      '"sin recepciones" fuera de este modulo (ver docstring del archivo).',
  },
  {
    de: 'confirmada',
    a: 'anulada',
    descripcion:
      'Flujo manual de Gerencia, con motivo; fuera del happy path del Modulo 1 (idem; ' +
      'guardia "sin recepciones" fuera de este modulo).',
  },
];

// ---------------------------------------------------------------------------
// Consultas puras sobre la tabla.
// ---------------------------------------------------------------------------

/** Devuelve la transicion `desde -> hacia` si existe. */
export function buscarTransicionOc(
  desde: EstadoOC,
  hacia: EstadoOC,
): TransicionOc | undefined {
  return TRANSICIONES_OC.find((t) => t.de === desde && t.a === hacia);
}

/**
 * Valida que la transicion `desde -> hacia` exista en la maquina de estados de la OC.
 * Error E12-estilo (mismo codigo/shape que `puedeTransicionar` del pedido): transicion de
 * estado invalida solicitada (exceptions.md fila E12).
 */
export function puedeTransicionarOc(
  desde: EstadoOC,
  hacia: EstadoOC,
): ResultadoTransicionOc {
  if (buscarTransicionOc(desde, hacia)) return ok(undefined);
  const mensaje = esTerminalOc(desde)
    ? `La OC en estado "${desde}" es terminal e inmutable; no admite transiciones (solicitada: "${hacia}").`
    : `Transicion de OC invalida: no se permite pasar de "${desde}" a "${hacia}".`;
  return err({ codigo: 'E12', mensaje });
}

/** Estados de OC alcanzables desde `estado` en un paso. */
export function transicionesOcValidasDesde(
  estado: EstadoOC,
): readonly EstadoOC[] {
  return TRANSICIONES_OC.filter((t) => t.de === estado).map((t) => t.a);
}

/**
 * `true` si el estado de OC es terminal (sin transiciones de salida): `recibida_total` o
 * `anulada` (state-machine.md regla dura 2, extendida al ciclo de la OC).
 */
export function esTerminalOc(estado: EstadoOC): boolean {
  return ESTADOS_OC_TERMINALES.includes(estado);
}
