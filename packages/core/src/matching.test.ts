import { describe, expect, it } from 'vitest';
import type { UmbralesConfig } from './types.js';
import { UMBRALES_DEFAULT } from './exceptions.js';
import {
  matchFacturaOc,
  normalizarDescripcion,
  scoreFacturaOc,
  similitudTokens,
  type CandidataOc,
  type FacturaParaMatch,
} from './matching.js';

const U = UMBRALES_DEFAULT;

describe('normalizarDescripcion', () => {
  it('convierte a minusculas', () => {
    expect(normalizarDescripcion('CEMENTO GRIS')).toBe('cemento gris');
  });

  it('remueve tildes/diacriticos', () => {
    expect(normalizarDescripcion('varilla número 4')).toBe('varilla numero 4');
    expect(normalizarDescripcion('camión de arena')).toBe('camion de arena');
  });

  it('remueve la virgulilla de la enie (decision documentada: ñ -> n)', () => {
    expect(normalizarDescripcion('peña de bloques')).toBe('pena de bloques');
  });

  it('remueve signos de puntuacion, conserva letras y numeros', () => {
    expect(normalizarDescripcion('cemento, tipo: gp-40 (1 saco)')).toBe('cemento tipo gp 40 1 saco');
  });

  it('colapsa espacios multiples y recorta bordes', () => {
    expect(normalizarDescripcion('  varilla    #4   ')).toBe('varilla 4');
  });

  it('cadena vacia normaliza a cadena vacia', () => {
    expect(normalizarDescripcion('')).toBe('');
  });

  it('cadena solo de signos normaliza a cadena vacia', () => {
    expect(normalizarDescripcion('***---###')).toBe('');
  });
});

describe('similitudTokens', () => {
  it('descripciones identicas -> 1', () => {
    expect(similitudTokens('cemento gris', 'cemento gris')).toBe(1);
  });

  it('descripciones identicas salvo mayusculas/tildes/signos -> 1', () => {
    expect(similitudTokens('Cemento, Gris!', 'cemento   gris')).toBe(1);
  });

  it('sin overlap -> 0', () => {
    expect(similitudTokens('cemento gris', 'varilla numero 4')).toBe(0);
  });

  it('overlap parcial: jaccard = interseccion/union', () => {
    // {cemento, gris, tipo} vs {cemento, gris, portland} -> interseccion 2, union 4 -> 0.5
    expect(similitudTokens('cemento gris tipo', 'cemento gris portland')).toBeCloseTo(0.5);
  });

  it('un subconjunto del otro', () => {
    // {cemento} vs {cemento, gris} -> interseccion 1, union 2 -> 0.5
    expect(similitudTokens('cemento', 'cemento gris')).toBeCloseTo(0.5);
  });

  it('ambas cadenas vacias tras normalizar -> 0 (decision documentada)', () => {
    expect(similitudTokens('', '')).toBe(0);
    expect(similitudTokens('***', '###')).toBe(0);
  });

  it('una vacia y la otra con tokens -> 0', () => {
    expect(similitudTokens('', 'cemento gris')).toBe(0);
  });

  it('es simetrica', () => {
    expect(similitudTokens('cemento gris', 'gris cemento fino')).toBeCloseTo(
      similitudTokens('gris cemento fino', 'cemento gris'),
    );
  });
});

describe('scoreFacturaOc', () => {
  it('match perfecto de items y monto exacto -> score 1', () => {
    const factura: FacturaParaMatch = {
      items: [{ descripcion: 'cemento gris' }, { descripcion: 'varilla numero 4' }],
      montoTotal: 100_000,
    };
    const oc = {
      items: [{ descripcion: 'cemento gris' }, { descripcion: 'varilla numero 4' }],
      montoTotal: 100_000,
    };
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(1);
  });

  it('sin overlap de items y monto muy distinto -> score 0', () => {
    const factura: FacturaParaMatch = { items: [{ descripcion: 'cemento' }], montoTotal: 1_000_000 };
    const oc = { items: [{ descripcion: 'varilla' }], montoTotal: 1 };
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(0, 5);
  });

  it('pondera 0.7 similitud de items + 0.3 cercania de monto', () => {
    // similitud de items = 1 (identicos); cercania de monto: |110000-100000|/100000 = 0.1 -> cercania 0.9
    const factura: FacturaParaMatch = { items: [{ descripcion: 'cemento gris' }], montoTotal: 110_000 };
    const oc = { items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 };
    // score = 0.7*1 + 0.3*0.9 = 0.97
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(0.97);
  });

  it('toma el mejor match por item de factura entre todos los items de la OC', () => {
    const factura: FacturaParaMatch = { items: [{ descripcion: 'varilla numero 4' }], montoTotal: 100 };
    const oc = {
      items: [{ descripcion: 'cemento gris' }, { descripcion: 'varilla numero 4' }],
      montoTotal: 100,
    };
    // el item de factura matchea perfecto contra el 2do item de la OC -> similitud items = 1
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(1);
  });

  it('factura sin items -> similitud de items 0 (solo pesa el monto)', () => {
    const factura: FacturaParaMatch = { items: [], montoTotal: 100_000 };
    const oc = { items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 };
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(0.3);
  });

  it('OC sin items -> similitud de items 0 aunque la factura tenga items', () => {
    const factura: FacturaParaMatch = { items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 };
    const oc = { items: [], montoTotal: 100_000 };
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(0.3);
  });

  it('cercania de monto usa piso de max(montoOc, 1) para evitar division por cero', () => {
    const factura: FacturaParaMatch = { items: [{ descripcion: 'cemento gris' }], montoTotal: 5 };
    const oc = { items: [{ descripcion: 'cemento gris' }], montoTotal: 0 };
    // cercania = 1 - min(1, |5-0|/max(0,1)) = 1 - min(1,5) = 0
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(0.7 * 1 + 0.3 * 0);
  });

  it('diferencia de monto muy grande satura la cercania en 0 (no negativa)', () => {
    const factura: FacturaParaMatch = { items: [{ descripcion: 'cemento gris' }], montoTotal: 1_000_000 };
    const oc = { items: [{ descripcion: 'cemento gris' }], montoTotal: 100 };
    expect(scoreFacturaOc(factura, oc, U)).toBeCloseTo(0.7);
  });
});

describe('matchFacturaOc', () => {
  const facturaBase: FacturaParaMatch = {
    items: [{ descripcion: 'cemento gris' }],
    montoTotal: 100_000,
  };

  it('una sola candidata sobre el umbral -> unico', () => {
    const candidatas: readonly CandidataOc[] = [
      { ocId: 'oc-1', items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 },
    ];
    const r = matchFacturaOc(facturaBase, candidatas, U);
    expect(r).toEqual({ tipo: 'unico', ocId: 'oc-1', score: 1 });
  });

  it('ninguna candidata alcanza el umbral -> e3 con la mejor como propuesta', () => {
    const candidatas: readonly CandidataOc[] = [
      { ocId: 'oc-1', items: [{ descripcion: 'varilla' }], montoTotal: 1 },
      { ocId: 'oc-2', items: [{ descripcion: 'block' }], montoTotal: 2 },
    ];
    const r = matchFacturaOc(facturaBase, candidatas, U);
    expect(r.tipo).toBe('e3');
    if (r.tipo === 'e3') {
      expect(r.mejorCandidato).not.toBeNull();
    }
  });

  it('sin candidatas -> e3 con mejorCandidato null', () => {
    const r = matchFacturaOc(facturaBase, [], U);
    expect(r).toEqual({ tipo: 'e3', mejorCandidato: null });
  });

  it('dos candidatas empatadas sobre el umbral -> e3 (ambiguedad), no unico', () => {
    const candidatas: readonly CandidataOc[] = [
      { ocId: 'oc-1', items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 },
      { ocId: 'oc-2', items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 },
    ];
    const r = matchFacturaOc(facturaBase, candidatas, U);
    expect(r.tipo).toBe('e3');
    if (r.tipo === 'e3') {
      // determinista: se queda con la primera de mayor score en orden de entrada
      expect(r.mejorCandidato).toEqual({ ocId: 'oc-1', score: 1 });
    }
  });

  it('dos candidatas sobre el umbral pero con distinto score -> e3 (no exactamente una)', () => {
    const candidatas: readonly CandidataOc[] = [
      { ocId: 'oc-1', items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 },
      { ocId: 'oc-2', items: [{ descripcion: 'cemento gris' }], montoTotal: 105_000 },
    ];
    const r = matchFacturaOc(facturaBase, candidatas, U);
    expect(r.tipo).toBe('e3');
  });

  it('respeta el umbral configurado en vez de un valor fijo', () => {
    const umbralesEstrictos: UmbralesConfig = { ...U, similitudMinFacturaOc: 0.99 };
    // score = 0.7*1 + 0.3*0.9 = 0.97 < 0.99 -> no alcanza el umbral estricto
    const candidatas: readonly CandidataOc[] = [
      { ocId: 'oc-1', items: [{ descripcion: 'cemento gris' }], montoTotal: 110_000 },
    ];
    const r = matchFacturaOc(facturaBase, candidatas, umbralesEstrictos);
    expect(r.tipo).toBe('e3');
  });

  it('score exactamente en el umbral cuenta como alcanzado (>=)', () => {
    const umbrales: UmbralesConfig = { ...U, similitudMinFacturaOc: 1 };
    const candidatas: readonly CandidataOc[] = [
      { ocId: 'oc-1', items: [{ descripcion: 'cemento gris' }], montoTotal: 100_000 },
    ];
    const r = matchFacturaOc(facturaBase, candidatas, umbrales);
    expect(r).toEqual({ tipo: 'unico', ocId: 'oc-1', score: 1 });
  });
});
