/**
 * Numeracion correlativa PED/OC (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/data-model.md (regla dura 4) y types.ts (`PREFIJOS_NUMERACION`).
 * Formato `PREFIJO-AAAA-NNN` con relleno minimo de 3 digitos. El `SELECT ... FOR UPDATE`
 * transaccional por anio vive en packages/db; aqui solo hay formato + calculo puro.
 */
import type { PrefijoNumeracion, Result } from './types.js';
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
export declare function formatNumero(prefijo: PrefijoNumeracion, anio: number, correlativo: number): string;
/** Parsea un numero `PREFIJO-AAAA-NNN`. Devuelve `Result` (no lanza para input externo). */
export declare function parseNumero(s: string): Result<NumeroParseado, ErrorNumeracion>;
/**
 * Siguiente correlativo dado el ultimo emitido (por prefijo y anio): `null` -> 1.
 * El reinicio por cambio de anio lo decide el llamador consultando el ultimo del anio nuevo
 * (que sera `null` -> 1).
 */
export declare function siguienteCorrelativo(ultimo: number | null): number;
//# sourceMappingURL=numbering.d.ts.map