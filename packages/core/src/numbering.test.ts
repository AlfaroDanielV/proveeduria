import { describe, expect, it } from 'vitest';
import { formatNumero, parseNumero, siguienteCorrelativo } from './numbering.js';

describe('formatNumero', () => {
  it('formatea con relleno de 3 digitos', () => {
    expect(formatNumero('PED', 2026, 1)).toBe('PED-2026-001');
    expect(formatNumero('PED', 2026, 42)).toBe('PED-2026-042');
    expect(formatNumero('OC', 2026, 7)).toBe('OC-2026-007');
  });

  it('en el limite 999 -> 1000 conserva el ancho natural', () => {
    expect(formatNumero('PED', 2026, 999)).toBe('PED-2026-999');
    expect(formatNumero('PED', 2026, 1000)).toBe('PED-2026-1000');
    expect(formatNumero('OC', 2026, 12345)).toBe('OC-2026-12345');
  });

  it('respeta el cambio de anio', () => {
    expect(formatNumero('PED', 2025, 3)).toBe('PED-2025-003');
    expect(formatNumero('PED', 2027, 3)).toBe('PED-2027-003');
  });

  it('lanza ante correlativo no positivo o no entero (bug/invariante)', () => {
    expect(() => formatNumero('PED', 2026, 0)).toThrow(RangeError);
    expect(() => formatNumero('PED', 2026, -1)).toThrow(RangeError);
    expect(() => formatNumero('PED', 2026, 1.5)).toThrow(RangeError);
  });

  it('lanza ante anio fuera de rango', () => {
    expect(() => formatNumero('PED', 999, 1)).toThrow(RangeError);
    expect(() => formatNumero('PED', 10000, 1)).toThrow(RangeError);
    expect(() => formatNumero('PED', 2026.5, 1)).toThrow(RangeError);
  });
});

describe('parseNumero', () => {
  it('parsea un numero valido', () => {
    const r = parseNumero('PED-2026-001');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ prefijo: 'PED', anio: 2026, correlativo: 1 });
    }
  });

  it('parsea correlativos de mas de 3 digitos', () => {
    const r = parseNumero('OC-2026-1000');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ prefijo: 'OC', anio: 2026, correlativo: 1000 });
    }
  });

  it('es inverso de formatNumero (round-trip)', () => {
    const s = formatNumero('OC', 2030, 512);
    const r = parseNumero(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(formatNumero(r.value.prefijo, r.value.anio, r.value.correlativo)).toBe(s);
    }
  });

  it.each([
    'FAC-2026-001', // prefijo no permitido
    'PED-2026-01', // menos de 3 digitos
    'PED-26-001', // anio de 2 digitos
    'PED-2026-000', // correlativo 0
    'PED-2026-abc', // correlativo no numerico
    'PED_2026_001', // separador incorrecto
    ' PED-2026-001', // espacio inicial
    'PED-2026-001 ', // espacio final
    'ped-2026-001', // minusculas
    '',
  ])('rechaza el formato invalido %s', (s) => {
    const r = parseNumero(s);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('formato_invalido');
    }
  });
});

describe('siguienteCorrelativo', () => {
  it('null -> 1 (primer numero del anio o reinicio de anio)', () => {
    expect(siguienteCorrelativo(null)).toBe(1);
  });

  it('incrementa el ultimo', () => {
    expect(siguienteCorrelativo(1)).toBe(2);
    expect(siguienteCorrelativo(999)).toBe(1000);
    expect(siguienteCorrelativo(1000)).toBe(1001);
  });

  it('lanza ante un correlativo previo invalido', () => {
    expect(() => siguienteCorrelativo(0)).toThrow(RangeError);
    expect(() => siguienteCorrelativo(-3)).toThrow(RangeError);
    expect(() => siguienteCorrelativo(2.5)).toThrow(RangeError);
  });
});
