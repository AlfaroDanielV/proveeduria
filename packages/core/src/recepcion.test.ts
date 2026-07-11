import { describe, expect, it } from 'vitest';
import type { EstadoOC, EstadoPedido } from './types.js';
import { ESTADOS_OC } from './types.js';
import {
  debeSugerirCierre,
  estadoObjetivoOc,
  estadoObjetivoPedido,
  type UmbralesCobertura,
} from './recepcion.js';

const SIN_TOLERANCIA: UmbralesCobertura = { difCantidadMenor: 0 };
const CON_TOLERANCIA: UmbralesCobertura = { difCantidadMenor: 5 };

describe('estadoObjetivoOc', () => {
  it('items vacio -> sin_recepcion (decision documentada)', () => {
    expect(estadoObjetivoOc([], SIN_TOLERANCIA)).toBe('sin_recepcion');
  });

  it('todas las cantidadRecibida en 0 -> sin_recepcion', () => {
    expect(
      estadoObjetivoOc(
        [
          { cantidad: 10, cantidadRecibida: 0 },
          { cantidad: 5, cantidadRecibida: 0 },
        ],
        SIN_TOLERANCIA,
      ),
    ).toBe('sin_recepcion');
  });

  it('un solo item, recepcion parcial', () => {
    expect(estadoObjetivoOc([{ cantidad: 10, cantidadRecibida: 4 }], SIN_TOLERANCIA)).toBe(
      'recibida_parcial',
    );
  });

  it('un solo item, recepcion exacta -> recibida_total', () => {
    expect(estadoObjetivoOc([{ cantidad: 10, cantidadRecibida: 10 }], SIN_TOLERANCIA)).toBe(
      'recibida_total',
    );
  });

  it('sobre-recepcion (cantidadRecibida > cantidad) cuenta como total', () => {
    expect(estadoObjetivoOc([{ cantidad: 10, cantidadRecibida: 12 }], SIN_TOLERANCIA)).toBe(
      'recibida_total',
    );
  });

  it('varios items, uno incompleto -> recibida_parcial', () => {
    expect(
      estadoObjetivoOc(
        [
          { cantidad: 10, cantidadRecibida: 10 },
          { cantidad: 5, cantidadRecibida: 3 },
        ],
        SIN_TOLERANCIA,
      ),
    ).toBe('recibida_parcial');
  });

  it('varios items, todos completos -> recibida_total', () => {
    expect(
      estadoObjetivoOc(
        [
          { cantidad: 10, cantidadRecibida: 10 },
          { cantidad: 5, cantidadRecibida: 5 },
        ],
        SIN_TOLERANCIA,
      ),
    ).toBe('recibida_total');
  });

  it('con tolerancia: diferencia dentro de difCantidadMenor cuenta como total', () => {
    // cantidad 100, recibido 96 -> diff 4 <= 5 -> cubre el umbral (96 >= 100 - 5 = 95)
    expect(estadoObjetivoOc([{ cantidad: 100, cantidadRecibida: 96 }], CON_TOLERANCIA)).toBe(
      'recibida_total',
    );
  });

  it('con tolerancia: en el borde exacto (96 >= 95) es total', () => {
    expect(estadoObjetivoOc([{ cantidad: 100, cantidadRecibida: 95 }], CON_TOLERANCIA)).toBe(
      'recibida_total',
    );
  });

  it('con tolerancia: justo fuera del borde (94 < 95) es parcial', () => {
    expect(estadoObjetivoOc([{ cantidad: 100, cantidadRecibida: 94 }], CON_TOLERANCIA)).toBe(
      'recibida_parcial',
    );
  });

  it('item con cantidad 0 no bloquea el total si ya recibio algo en otro item', () => {
    expect(
      estadoObjetivoOc(
        [
          { cantidad: 0, cantidadRecibida: 0 },
          { cantidad: 5, cantidadRecibida: 5 },
        ],
        SIN_TOLERANCIA,
      ),
    ).toBe('recibida_total');
  });
});

describe('estadoObjetivoPedido', () => {
  const oc = (estado: EstadoOC): { estado: EstadoOC } => ({ estado });

  it('sin OCs -> sin_recepcion', () => {
    expect(estadoObjetivoPedido([])).toBe('sin_recepcion');
  });

  it('todas las OCs anuladas -> sin_recepcion', () => {
    expect(estadoObjetivoPedido([oc('anulada'), oc('anulada')])).toBe('sin_recepcion');
  });

  it('una OC no-anulada sin recepcion (emitida) -> sin_recepcion', () => {
    expect(estadoObjetivoPedido([oc('emitida')])).toBe('sin_recepcion');
  });

  it('una OC no-anulada confirmada (sin recepcion aun) -> sin_recepcion', () => {
    expect(estadoObjetivoPedido([oc('confirmada')])).toBe('sin_recepcion');
  });

  it('una OC recibida_parcial -> recepcion_parcial', () => {
    expect(estadoObjetivoPedido([oc('recibida_parcial')])).toBe('recepcion_parcial');
  });

  it('todas las OCs no-anuladas recibida_total -> recepcion_total', () => {
    expect(estadoObjetivoPedido([oc('recibida_total'), oc('recibida_total')])).toBe(
      'recepcion_total',
    );
  });

  it('una recibida_total y una anulada (ignorada) -> recepcion_total', () => {
    expect(estadoObjetivoPedido([oc('recibida_total'), oc('anulada')])).toBe('recepcion_total');
  });

  it('una recibida_total y una emitida (aun sin recepcion) -> recepcion_parcial', () => {
    expect(estadoObjetivoPedido([oc('recibida_total'), oc('emitida')])).toBe('recepcion_parcial');
  });

  it('mezcla de recibida_parcial y recibida_total -> recepcion_parcial', () => {
    expect(estadoObjetivoPedido([oc('recibida_parcial'), oc('recibida_total')])).toBe(
      'recepcion_parcial',
    );
  });

  it('todos los estados de OC posibles se clasifican (cobertura exhaustiva del enum)', () => {
    for (const estado of ESTADOS_OC) {
      const resultado = estadoObjetivoPedido([oc(estado)]);
      expect(['sin_recepcion', 'recepcion_parcial', 'recepcion_total']).toContain(resultado);
    }
  });
});

describe('debeSugerirCierre', () => {
  const base = { estadoPedido: 'recepcion_total' as EstadoPedido, ncPendientes: 0, revisionesAbiertas: 0 };

  it('recepcion_total sin NC ni revisiones -> sugiere cierre', () => {
    expect(debeSugerirCierre(base)).toBe(true);
  });

  it('con NC pendientes -> no sugiere', () => {
    expect(debeSugerirCierre({ ...base, ncPendientes: 1 })).toBe(false);
  });

  it('con revisiones abiertas -> no sugiere', () => {
    expect(debeSugerirCierre({ ...base, revisionesAbiertas: 1 })).toBe(false);
  });

  it('con ambos pendientes -> no sugiere', () => {
    expect(debeSugerirCierre({ ...base, ncPendientes: 2, revisionesAbiertas: 3 })).toBe(false);
  });

  it('en cualquier otro estado de pedido -> no sugiere, aunque no haya pendientes', () => {
    const estados: readonly EstadoPedido[] = [
      'borrador',
      'cotizando',
      'en_revision',
      'aprobado',
      'ordenado',
      'recepcion_parcial',
      'cerrado',
      'cancelado',
    ];
    for (const estadoPedido of estados) {
      expect(debeSugerirCierre({ estadoPedido, ncPendientes: 0, revisionesAbiertas: 0 })).toBe(
        false,
      );
    }
  });
});
