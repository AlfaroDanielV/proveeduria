/**
 * Numeracion correlativa PED/OC (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/data-model.md (regla dura 4) y types.ts (`PREFIJOS_NUMERACION`).
 * Formato `PREFIJO-AAAA-NNN` con relleno minimo de 3 digitos. El `SELECT ... FOR UPDATE`
 * transaccional por anio vive en packages/db; aqui solo hay formato + calculo puro.
 */

import type { PrefijoNumeracion, Result } from './types.js';
import { err, ok } from './types.js';

const ANIO_MIN = 1000;
const ANIO_MAX = 9999;
const PAD_MIN = 3;

/** `PREFIJO-AAAA-NNN` (o mas digitos si el correlativo excede 999). */
const PATRON = /^(PED|OC)-(\d{4})-(\d{3,})$/;

export interface NumeroParseado {
  readonly prefijo: PrefijoNumeracion;
  readonly anio: number;
  readonly correlativo: number;
}

export interface ErrorNumeracion {
  readonly codigo: 'formato_invalido';
  readonly mensaje: string;
}

/**
 * Formatea `PED-2026-001`. El correlativo se rellena a >= 3 digitos; a partir de 1000
 * conserva su ancho natural (`PED-2026-1000`).
 *
 * Lanza (invariante imposible / bug) si el anio o el correlativo estan fuera de rango:
 * los valores provienen de la secuencia transaccional de la BD, siempre validos.
 */
export function formatNumero(
  prefijo: PrefijoNumeracion,
  anio: number,
  correlativo: number,
): string {
  if (!Number.isInteger(anio) || anio < ANIO_MIN || anio > ANIO_MAX) {
    throw new RangeError(`Anio invalido para numeracion: ${anio}.`);
  }
  if (!Number.isInteger(correlativo) || correlativo < 1) {
    throw new RangeError(`Correlativo invalido para numeracion: ${correlativo}.`);
  }
  return `${prefijo}-${anio}-${String(correlativo).padStart(PAD_MIN, '0')}`;
}

/** Parsea un numero `PREFIJO-AAAA-NNN`. Devuelve `Result` (no lanza para input externo). */
export function parseNumero(
  s: string,
): Result<NumeroParseado, ErrorNumeracion> {
  const m = PATRON.exec(s);
  if (m === null) {
    return err({
      codigo: 'formato_invalido',
      mensaje: `Numero invalido: "${s}". Formato esperado PREFIJO-AAAA-NNN (PED u OC).`,
    });
  }
  const prefijo = m[1];
  const anioStr = m[2];
  const correlativoStr = m[3];
  // Los tres grupos existen si `m` matcheo; el chequeo satisface noUncheckedIndexedAccess.
  if (prefijo === undefined || anioStr === undefined || correlativoStr === undefined) {
    return err({ codigo: 'formato_invalido', mensaje: `Numero invalido: "${s}".` });
  }
  const anio = Number(anioStr);
  const correlativo = Number(correlativoStr);
  if (correlativo < 1) {
    return err({
      codigo: 'formato_invalido',
      mensaje: `Correlativo debe ser >= 1: "${s}".`,
    });
  }
  return ok({ prefijo: prefijo as PrefijoNumeracion, anio, correlativo });
}

/**
 * Siguiente correlativo dado el ultimo emitido (por prefijo y anio): `null` -> 1.
 * El reinicio por cambio de anio lo decide el llamador consultando el ultimo del anio nuevo
 * (que sera `null` -> 1).
 */
export function siguienteCorrelativo(ultimo: number | null): number {
  if (ultimo === null) return 1;
  if (!Number.isInteger(ultimo) || ultimo < 1) {
    throw new RangeError(`Correlativo previo invalido: ${ultimo}.`);
  }
  return ultimo + 1;
}
