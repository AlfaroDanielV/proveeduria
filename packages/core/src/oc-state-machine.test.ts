import { describe, expect, it } from 'vitest';
import type { EstadoOC } from './types.js';
import { ESTADOS_OC } from './types.js';
import {
  buscarTransicionOc,
  esTerminalOc,
  puedeTransicionarOc,
  transicionesOcValidasDesde,
  TRANSICIONES_OC,
} from './oc-state-machine.js';

/** Todas las transiciones validas segun state-machine.md §Ciclo de la OC, como pares `de->a`. */
const VALIDAS: ReadonlyArray<readonly [EstadoOC, EstadoOC]> = [
  ['emitida', 'confirmada'],
  ['emitida', 'recibida_parcial'],
  ['confirmada', 'recibida_parcial'],
  ['emitida', 'recibida_total'],
  ['confirmada', 'recibida_total'],
  ['recibida_parcial', 'recibida_parcial'],
  ['recibida_parcial', 'recibida_total'],
  ['emitida', 'anulada'],
  ['confirmada', 'anulada'],
];

const clave = (de: EstadoOC, a: EstadoOC): string => `${de}->${a}`;
const VALIDAS_SET = new Set(VALIDAS.map(([de, a]) => clave(de, a)));

describe('TRANSICIONES_OC (tabla)', () => {
  it('contiene exactamente las 9 transiciones de la spec', () => {
    expect(TRANSICIONES_OC).toHaveLength(VALIDAS.length);
    expect(TRANSICIONES_OC).toHaveLength(9);
  });

  it('no tiene duplicados de->a', () => {
    const claves = TRANSICIONES_OC.map((t) => clave(t.de, t.a));
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('cada entrada de la tabla es una transicion valida esperada', () => {
    for (const t of TRANSICIONES_OC) {
      expect(VALIDAS_SET.has(clave(t.de, t.a))).toBe(true);
    }
  });

  it('anulada solo es alcanzable desde emitida o confirmada', () => {
    const haciaAnulada = TRANSICIONES_OC.filter((t) => t.a === 'anulada').map((t) => t.de);
    expect(new Set(haciaAnulada)).toEqual(new Set<EstadoOC>(['emitida', 'confirmada']));
  });
});

describe('puedeTransicionarOc', () => {
  it.each(VALIDAS)('permite la transicion valida %s -> %s', (de, a) => {
    const r = puedeTransicionarOc(de, a);
    expect(r.ok).toBe(true);
  });

  // Producto cartesiano completo: todo par que NO este en VALIDAS debe rechazarse con E12.
  const TODOS: Array<readonly [EstadoOC, EstadoOC]> = [];
  for (const de of ESTADOS_OC) {
    for (const a of ESTADOS_OC) {
      TODOS.push([de, a]);
    }
  }
  const INVALIDAS = TODOS.filter(([de, a]) => !VALIDAS_SET.has(clave(de, a)));

  it('cubre 25 pares en total (5x5) y 16 invalidos', () => {
    expect(TODOS).toHaveLength(25);
    expect(INVALIDAS).toHaveLength(25 - VALIDAS.length);
    expect(INVALIDAS).toHaveLength(16);
  });

  it.each(INVALIDAS)('rechaza la transicion invalida %s -> %s con E12', (de, a) => {
    const r = puedeTransicionarOc(de, a);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('E12');
      expect(r.error.mensaje).toBeTruthy();
    }
  });

  it('reglas duras: recibida_total y anulada son terminales (sin salida)', () => {
    for (const a of ESTADOS_OC) {
      expect(puedeTransicionarOc('recibida_total', a).ok).toBe(false);
      expect(puedeTransicionarOc('anulada', a).ok).toBe(false);
    }
  });

  it('el mensaje de estado terminal es distinto del de transicion comun', () => {
    const term = puedeTransicionarOc('anulada', 'confirmada');
    const comun = puedeTransicionarOc('emitida', 'emitida');
    expect(term.ok).toBe(false);
    expect(comun.ok).toBe(false);
    if (!term.ok && !comun.ok) {
      expect(term.error.mensaje).toContain('terminal');
      expect(comun.error.mensaje).not.toContain('terminal');
    }
  });
});

describe('transicionesOcValidasDesde', () => {
  it('emitida -> [confirmada, recibida_parcial, recibida_total, anulada]', () => {
    expect(new Set(transicionesOcValidasDesde('emitida'))).toEqual(
      new Set<EstadoOC>(['confirmada', 'recibida_parcial', 'recibida_total', 'anulada']),
    );
  });
  it('confirmada -> [recibida_parcial, recibida_total, anulada]', () => {
    expect(new Set(transicionesOcValidasDesde('confirmada'))).toEqual(
      new Set<EstadoOC>(['recibida_parcial', 'recibida_total', 'anulada']),
    );
  });
  it('recibida_parcial -> [recibida_parcial, recibida_total]', () => {
    expect(new Set(transicionesOcValidasDesde('recibida_parcial'))).toEqual(
      new Set<EstadoOC>(['recibida_parcial', 'recibida_total']),
    );
  });
  it('recibida_total y anulada no tienen salidas', () => {
    expect(transicionesOcValidasDesde('recibida_total')).toEqual([]);
    expect(transicionesOcValidasDesde('anulada')).toEqual([]);
  });
});

describe('esTerminalOc', () => {
  it('recibida_total y anulada son terminales', () => {
    expect(esTerminalOc('recibida_total')).toBe(true);
    expect(esTerminalOc('anulada')).toBe(true);
  });
  it('los demas no son terminales', () => {
    for (const e of ESTADOS_OC) {
      if (e === 'recibida_total' || e === 'anulada') continue;
      expect(esTerminalOc(e)).toBe(false);
    }
  });
});

describe('buscarTransicionOc', () => {
  it('devuelve la transicion para un par valido', () => {
    const t = buscarTransicionOc('emitida', 'confirmada');
    expect(t?.de).toBe('emitida');
    expect(t?.a).toBe('confirmada');
    expect(t?.descripcion).toBeTruthy();
  });
  it('devuelve undefined para un par invalido', () => {
    expect(buscarTransicionOc('anulada', 'confirmada')).toBeUndefined();
  });
});
