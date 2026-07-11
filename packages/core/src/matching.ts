/**
 * Matching deterministico factura <-> OC (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/exceptions.md fila E3 y regla general 3 (umbral configurable
 * `similitudMinFacturaOc` en `UmbralesConfig`, valor inicial 0.6). El algoritmo es puro y
 * deterministico: normaliza descripciones, calcula similitud de tokens (overlap de Jaccard)
 * y cercania de monto, y decide si hay un candidato unico o si corresponde escalar a
 * `review_queue(factura_sin_oc)` con la mejor propuesta. "El algoritmo exacto vive en
 * `packages/core` (puro) y se calibra con el corpus del piloto antes del go-live" (spec).
 */

import type { UmbralesConfig } from './types.js';

// ---------------------------------------------------------------------------
// Normalizacion y similitud de texto.
// ---------------------------------------------------------------------------

/**
 * Rango Unicode de "Combining Diacritical Marks" (codepoints decimales 768-879, hex 0300-036F
 * en la notación habitual): lo que separa `normalize('NFD')` de un caracter acentuado (ej. la
 * tilde de "a" acentuada o la virgulilla de la "n" con tilde). Construido desde
 * `String.fromCharCode` (en vez de un literal de rango en el codigo fuente) para evitar
 * caracteres combinantes invisibles/ambiguos en el archivo .ts.
 */
const PRIMER_DIACRITICO_COMBINANTE = 768;
const ULTIMO_DIACRITICO_COMBINANTE = 879;
const DIACRITICOS_COMBINANTES = new RegExp(
  `[${String.fromCharCode(PRIMER_DIACRITICO_COMBINANTE)}-${String.fromCharCode(ULTIMO_DIACRITICO_COMBINANTE)}]`,
  'gu',
);

/**
 * Normaliza una descripcion para matching (exceptions.md E3: "minusculas, sin tildes"):
 * minusculas, tildes/diacriticos removidos via NFD (incluye la virgulilla de la `ñ`, que en
 * NFD se descompone en `n` + combining tilde — DECISION documentada: se trata como "sin
 * tildes" en sentido amplio, `ñ` -> `n`, para maximizar recall en el corpus de proveedores),
 * signos de puntuacion removidos (se conservan letras y digitos Unicode) y espacios
 * colapsados/recortados.
 */
export function normalizarDescripcion(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICOS_COMBINANTES, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizar(descripcionNormalizada: string): ReadonlySet<string> {
  if (descripcionNormalizada === '') return new Set();
  return new Set(descripcionNormalizada.split(' ').filter((t) => t.length > 0));
}

/**
 * Similitud de tokens (overlap de Jaccard: `|interseccion| / |union|`) entre dos
 * descripciones, normalizando ambas primero con `normalizarDescripcion`. Rango `[0, 1]`.
 *
 * DECISION documentada: si ambas quedan sin tokens (vacias tras normalizar), la similitud es
 * `0` — el Jaccard de dos conjuntos vacios es matematicamente indefinido (0/0); se resuelve a
 * "sin evidencia de match" en vez de a "match perfecto" (regla general 2 de exceptions.md:
 * "sin escritura especulativa").
 */
export function similitudTokens(a: string, b: string): number {
  const ta = tokenizar(normalizarDescripcion(a));
  const tb = tokenizar(normalizarDescripcion(b));
  if (ta.size === 0 && tb.size === 0) return 0;
  let interseccion = 0;
  for (const t of ta) {
    if (tb.has(t)) interseccion += 1;
  }
  const union = ta.size + tb.size - interseccion;
  return union === 0 ? 0 : interseccion / union;
}

// ---------------------------------------------------------------------------
// Score factura <-> OC.
// ---------------------------------------------------------------------------

/** Item con solo la descripcion relevante para el matching de texto. */
export interface ItemDescripcion {
  readonly descripcion: string;
}

export interface FacturaParaMatch {
  readonly items: readonly ItemDescripcion[];
  readonly montoTotal: number;
}

export interface OcParaMatch {
  readonly items: readonly ItemDescripcion[];
  readonly montoTotal: number;
}

const PESO_SIMILITUD_ITEMS = 0.7;
const PESO_CERCANIA_MONTO = 0.3;

/** Promedio, sobre los items de la factura, del mejor match contra cualquier item de la OC. */
function similitudPromedioItems(
  itemsFactura: readonly ItemDescripcion[],
  itemsOc: readonly ItemDescripcion[],
): number {
  if (itemsFactura.length === 0) return 0;
  const mejorPorItem = itemsFactura.map((itemFactura) => {
    if (itemsOc.length === 0) return 0;
    let mejor = 0;
    for (const itemOc of itemsOc) {
      const s = similitudTokens(itemFactura.descripcion, itemOc.descripcion);
      if (s > mejor) mejor = s;
    }
    return mejor;
  });
  const suma = mejorPorItem.reduce((acc, s) => acc + s, 0);
  return suma / mejorPorItem.length;
}

/** Cercania de monto: `1 - min(1, |montoFactura - montoOc| / max(montoOc, 1))`, en `[0, 1]`. */
function cercaniaDeMonto(montoFactura: number, montoOc: number): number {
  const denominador = Math.max(montoOc, 1);
  return 1 - Math.min(1, Math.abs(montoFactura - montoOc) / denominador);
}

/**
 * Score de match factura <-> OC candidata, en `[0, 1]` (exceptions.md fila E3).
 *
 * CONTRATO (formula normativa):
 * ```
 * score = 0.7 * promedio_i( max_j( similitudTokens(item_factura_i, item_oc_j) ) )
 *       + 0.3 * (1 - min(1, |montoFactura - montoOc| / max(montoOc, 1)))
 * ```
 * Es decir: para cada item de la factura se toma su mejor match contra cualquier item de la
 * OC candidata (0 si la OC no tiene items), se promedia sobre los items de la factura (0 si
 * la factura no tiene items), y se pondera 0.7; se suma la cercania de monto ponderada 0.3.
 *
 * `umbrales` se recibe por paridad de firma con `matchFacturaOc` (que si lo usa, para decidir
 * el candidato unico) y para dejar el punto de calibracion listo ("se calibra con el corpus
 * del piloto antes del go-live", exceptions.md E3); hoy los pesos 0.7/0.3 son fijos por la
 * spec y ningun campo de `umbrales` participa en este calculo.
 */
export function scoreFacturaOc(
  factura: FacturaParaMatch,
  oc: OcParaMatch,
  umbrales: UmbralesConfig,
): number {
  void umbrales;
  const similitudItems = similitudPromedioItems(factura.items, oc.items);
  const cercaniaMonto = cercaniaDeMonto(factura.montoTotal, oc.montoTotal);
  return similitudItems * PESO_SIMILITUD_ITEMS + cercaniaMonto * PESO_CERCANIA_MONTO;
}

// ---------------------------------------------------------------------------
// Decision de match (unico vs. E3).
// ---------------------------------------------------------------------------

/** Una OC candidata a match, identificada por `ocId`. */
export interface CandidataOc extends OcParaMatch {
  readonly ocId: string;
}

export type ResultadoMatchFacturaOc =
  | { readonly tipo: 'unico'; readonly ocId: string; readonly score: number }
  | {
      readonly tipo: 'e3';
      readonly mejorCandidato: { readonly ocId: string; readonly score: number } | null;
    };

/**
 * Decide el match factura <-> OC entre las candidatas (OCs abiertas del proveedor en el
 * proyecto; ese filtro de "abiertas del proveedor en el proyecto" lo aplica el caller antes
 * de llamar aqui — este modulo puro no conoce estado de OC ni proveedor).
 *
 * - `'unico'`: exactamente una candidata alcanza `score >= umbrales.similitudMinFacturaOc`.
 * - `'e3'`: cero candidatas alcanzan el umbral, o dos o mas lo alcanzan (empate/ambiguedad);
 *   se devuelve la de mejor score como propuesta para `review_queue(factura_sin_oc)`
 *   (`mejorCandidato` es `null` solo si `candidatas` esta vacio). En empate de score se
 *   conserva la primera candidata de mayor score segun el orden de entrada — comportamiento
 *   determinista; la spec no fija un criterio de desempate de negocio.
 */
export function matchFacturaOc(
  factura: FacturaParaMatch,
  candidatas: readonly CandidataOc[],
  umbrales: UmbralesConfig,
): ResultadoMatchFacturaOc {
  const puntuadas = candidatas.map((c) => ({
    ocId: c.ocId,
    score: scoreFacturaOc(factura, c, umbrales),
  }));
  const sobreUmbral = puntuadas.filter((p) => p.score >= umbrales.similitudMinFacturaOc);
  if (sobreUmbral.length === 1) {
    const unico = sobreUmbral[0];
    if (unico) return { tipo: 'unico', ocId: unico.ocId, score: unico.score };
  }
  let mejor: { ocId: string; score: number } | null = null;
  for (const p of puntuadas) {
    if (mejor === null || p.score > mejor.score) mejor = p;
  }
  return { tipo: 'e3', mejorCandidato: mejor };
}
