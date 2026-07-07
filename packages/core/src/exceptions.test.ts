import { describe, expect, it } from 'vitest';
import type { UmbralesConfig } from './types.js';
import {
  cotizacionIncompleta,
  cotizacionVencida,
  devolucionExcedeInventario,
  diferenciaMontoSignificativa,
  diferenciaRecepcion,
  excedioRepreguntas,
  extraccionBajaConfianza,
  horasEntre,
  pedidoAtascado,
  pedidoAtascadoDesde,
  transicionInvalida,
  UMBRALES_DEFAULT,
} from './exceptions.js';

const U = UMBRALES_DEFAULT;
/** Un instante base fijo para las pruebas dependientes del tiempo (deterministico). */
const T0 = new Date('2026-07-07T00:00:00.000Z');
const enHoras = (base: Date, horas: number): Date =>
  new Date(base.getTime() + horas * 3_600_000);

describe('UMBRALES_DEFAULT (exceptions.md §3)', () => {
  it('tiene los valores iniciales de la spec', () => {
    expect(U.confianzaMinCotizacion).toBe(0.8);
    expect(U.maxRepreguntasProveedor).toBe(2);
    expect(U.confianzaMinFactura).toBe(0.85);
    expect(U.difMontoRelMax).toBe(0.01);
    expect(U.difMontoAbsMinCRC).toBe(10000);
    expect(U.difCantidadMenor).toBe(0);
    expect(U.plazoCotizacionHorasDefault).toBe(24);
    expect(U.horasAtascoEnRevision).toBe(24);
    expect(U.horasAtascoAprobado).toBe(48);
  });
});

describe('horasEntre', () => {
  it('calcula horas fraccionarias y negativas', () => {
    expect(horasEntre(T0, enHoras(T0, 1.5))).toBeCloseTo(1.5);
    expect(horasEntre(T0, T0)).toBe(0);
    expect(horasEntre(enHoras(T0, 2), T0)).toBeCloseTo(-2);
  });
});

describe('E1 cotizacionVencida', () => {
  const plazo = enHoras(T0, 24);
  it('con respuesta nunca esta vencida', () => {
    expect(cotizacionVencida(plazo, enHoras(plazo, 100), true)).toBe(false);
  });
  it('justo antes del plazo no esta vencida', () => {
    expect(cotizacionVencida(plazo, new Date(plazo.getTime() - 1), false)).toBe(false);
  });
  it('en el instante exacto del plazo esta vencida', () => {
    expect(cotizacionVencida(plazo, new Date(plazo.getTime()), false)).toBe(true);
  });
  it('despues del plazo esta vencida', () => {
    expect(cotizacionVencida(plazo, new Date(plazo.getTime() + 1), false)).toBe(true);
  });
});

describe('E2 cotizacionIncompleta', () => {
  const itemOk = { precioUnitario: 1000, cantidad: 5 };
  it('completa: items validos y confianza en el umbral', () => {
    expect(cotizacionIncompleta([itemOk], 0.8, U)).toBe(false);
    expect(cotizacionIncompleta([itemOk], 0.81, U)).toBe(false);
  });
  it('incompleta por confianza justo bajo el umbral', () => {
    expect(cotizacionIncompleta([itemOk], 0.79, U)).toBe(true);
  });
  it('incompleta si falta precio o cantidad en algun item', () => {
    expect(cotizacionIncompleta([{ precioUnitario: null, cantidad: 5 }], 0.95, U)).toBe(true);
    expect(cotizacionIncompleta([{ precioUnitario: 1000, cantidad: null }], 0.95, U)).toBe(true);
    expect(cotizacionIncompleta([itemOk, { precioUnitario: null, cantidad: null }], 0.95, U)).toBe(true);
  });
  it('incompleta si precio o cantidad no son positivos', () => {
    expect(cotizacionIncompleta([{ precioUnitario: 0, cantidad: 5 }], 0.95, U)).toBe(true);
    expect(cotizacionIncompleta([{ precioUnitario: 1000, cantidad: 0 }], 0.95, U)).toBe(true);
    expect(cotizacionIncompleta([{ precioUnitario: -1, cantidad: 5 }], 0.95, U)).toBe(true);
  });
  it('incompleta si no hay items', () => {
    expect(cotizacionIncompleta([], 0.99, U)).toBe(true);
  });
});

describe('E2 excedioRepreguntas', () => {
  it('por debajo del maximo permite repreguntar', () => {
    expect(excedioRepreguntas(0, U)).toBe(false);
    expect(excedioRepreguntas(1, U)).toBe(false);
  });
  it('en el maximo (2) ya corresponde escalar', () => {
    expect(excedioRepreguntas(2, U)).toBe(true);
  });
  it('por encima del maximo escala', () => {
    expect(excedioRepreguntas(3, U)).toBe(true);
  });
});

describe('E4 diferenciaMontoSignificativa', () => {
  it('OC grande: domina el 1% relativo', () => {
    // montoOC = 5.000.000 -> umbral = max(50.000, 10.000) = 50.000
    expect(diferenciaMontoSignificativa(5_050_000, 5_000_000, U)).toBe(false); // == umbral
    expect(diferenciaMontoSignificativa(5_050_001, 5_000_000, U)).toBe(true); // > umbral
    expect(diferenciaMontoSignificativa(5_049_999, 5_000_000, U)).toBe(false); // < umbral
  });
  it('OC pequena: domina el piso absoluto de 10.000', () => {
    // montoOC = 100.000 -> umbral = max(1.000, 10.000) = 10.000
    expect(diferenciaMontoSignificativa(110_000, 100_000, U)).toBe(false); // == umbral
    expect(diferenciaMontoSignificativa(110_001, 100_000, U)).toBe(true);
    expect(diferenciaMontoSignificativa(90_000, 100_000, U)).toBe(false);
    expect(diferenciaMontoSignificativa(89_999, 100_000, U)).toBe(true);
  });
  it('montos iguales no son significativos', () => {
    expect(diferenciaMontoSignificativa(100_000, 100_000, U)).toBe(false);
  });
});

describe('E9 extraccionBajaConfianza', () => {
  it('en el umbral no es baja', () => {
    expect(extraccionBajaConfianza(0.85, U)).toBe(false);
  });
  it('justo bajo el umbral es baja', () => {
    expect(extraccionBajaConfianza(0.8499, U)).toBe(true);
  });
  it('sobre el umbral no es baja', () => {
    expect(extraccionBajaConfianza(0.86, U)).toBe(false);
  });
});

describe('E10 devolucionExcedeInventario', () => {
  it('devolver menos que lo activo no excede', () => {
    expect(devolucionExcedeInventario(3, 5)).toBe(false);
  });
  it('devolver exactamente lo activo no excede', () => {
    expect(devolucionExcedeInventario(5, 5)).toBe(false);
  });
  it('devolver mas que lo activo excede', () => {
    expect(devolucionExcedeInventario(6, 5)).toBe(true);
  });
});

describe('E5 diferenciaRecepcion', () => {
  it('sin diferencia cuando ordenado == recibido', () => {
    expect(diferenciaRecepcion(10, 10, U)).toEqual({ hayDiferencia: false, esMenor: false });
  });
  it('con el default (0) cualquier diferencia bloquea (no es menor)', () => {
    expect(diferenciaRecepcion(10, 9, U)).toEqual({ hayDiferencia: true, esMenor: false });
    expect(diferenciaRecepcion(10, 11, U)).toEqual({ hayDiferencia: true, esMenor: false });
  });
  it('con tolerancia configurada distingue diferencias menores', () => {
    const conTolerancia: UmbralesConfig = { ...U, difCantidadMenor: 5 };
    expect(diferenciaRecepcion(100, 100, conTolerancia)).toEqual({ hayDiferencia: false, esMenor: false });
    expect(diferenciaRecepcion(100, 96, conTolerancia)).toEqual({ hayDiferencia: true, esMenor: true }); // 4 <= 5
    expect(diferenciaRecepcion(100, 95, conTolerancia)).toEqual({ hayDiferencia: true, esMenor: true }); // 5 <= 5
    expect(diferenciaRecepcion(100, 94, conTolerancia)).toEqual({ hayDiferencia: true, esMenor: false }); // 6 > 5
  });
});

describe('E13 pedidoAtascado', () => {
  it('en_revision: >24h esta atascado, en 24h no', () => {
    expect(pedidoAtascado('en_revision', 23, U)).toBe(false);
    expect(pedidoAtascado('en_revision', 24, U)).toBe(false);
    expect(pedidoAtascado('en_revision', 24.01, U)).toBe(true);
    expect(pedidoAtascado('en_revision', 25, U)).toBe(true);
  });
  it('aprobado: >48h esta atascado, en 48h no', () => {
    expect(pedidoAtascado('aprobado', 47, U)).toBe(false);
    expect(pedidoAtascado('aprobado', 48, U)).toBe(false);
    expect(pedidoAtascado('aprobado', 48.01, U)).toBe(true);
    expect(pedidoAtascado('aprobado', 49, U)).toBe(true);
  });
  it('otros estados nunca estan atascados (E13 no aplica)', () => {
    for (const e of ['borrador', 'cotizando', 'ordenado', 'recepcion_parcial', 'recepcion_total', 'cerrado', 'cancelado'] as const) {
      expect(pedidoAtascado(e, 1000, U)).toBe(false);
    }
  });
});

describe('E13 pedidoAtascadoDesde', () => {
  it('deriva las horas de los instantes', () => {
    expect(pedidoAtascadoDesde('en_revision', T0, enHoras(T0, 24), U)).toBe(false);
    expect(pedidoAtascadoDesde('en_revision', T0, enHoras(T0, 25), U)).toBe(true);
    expect(pedidoAtascadoDesde('aprobado', T0, enHoras(T0, 49), U)).toBe(true);
  });
});

describe('E12 transicionInvalida', () => {
  it('true para una transicion inexistente', () => {
    expect(transicionInvalida('borrador', 'aprobado')).toBe(true);
    expect(transicionInvalida('cerrado', 'cotizando')).toBe(true);
    expect(transicionInvalida('ordenado', 'cancelado')).toBe(true);
  });
  it('false para una transicion valida', () => {
    expect(transicionInvalida('borrador', 'cotizando')).toBe(false);
    expect(transicionInvalida('recepcion_total', 'cerrado')).toBe(false);
  });
});
