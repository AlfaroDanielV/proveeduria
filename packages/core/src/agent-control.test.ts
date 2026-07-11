import { describe, expect, it } from 'vitest';
import { pausaAplicable, type PausaVigente } from './agent-control.js';

describe('pausaAplicable', () => {
  it('sin pausas vigentes -> false', () => {
    expect(pausaAplicable([], { telefono: '50688887777' })).toBe(false);
    expect(pausaAplicable([], {})).toBe(false);
  });

  it('pausa global aplica siempre, con o sin contexto', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'global', referencia: null }];
    expect(pausaAplicable(pausas, {})).toBe(true);
    expect(pausaAplicable(pausas, { telefono: '50688887777' })).toBe(true);
    expect(pausaAplicable(pausas, { pedidoId: 'ped-1' })).toBe(true);
  });

  it('pausa global aplica sin importar el valor de referencia', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'global', referencia: 'lo-que-sea' }];
    expect(pausaAplicable(pausas, {})).toBe(true);
  });

  it('pausa de telefono aplica solo si la referencia coincide', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'telefono', referencia: '50688887777' }];
    expect(pausaAplicable(pausas, { telefono: '50688887777' })).toBe(true);
    expect(pausaAplicable(pausas, { telefono: '50699998888' })).toBe(false);
  });

  it('pausa de telefono no aplica si el contexto no trae telefono', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'telefono', referencia: '50688887777' }];
    expect(pausaAplicable(pausas, {})).toBe(false);
    expect(pausaAplicable(pausas, { pedidoId: 'ped-1' })).toBe(false);
  });

  it('pausa de telefono no aplica si su referencia es null', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'telefono', referencia: null }];
    expect(pausaAplicable(pausas, { telefono: '50688887777' })).toBe(false);
  });

  it('pausa de pedido aplica solo si la referencia coincide', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'pedido', referencia: 'ped-1' }];
    expect(pausaAplicable(pausas, { pedidoId: 'ped-1' })).toBe(true);
    expect(pausaAplicable(pausas, { pedidoId: 'ped-2' })).toBe(false);
  });

  it('pausa de pedido no aplica si el contexto no trae pedidoId', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'pedido', referencia: 'ped-1' }];
    expect(pausaAplicable(pausas, {})).toBe(false);
    expect(pausaAplicable(pausas, { telefono: '50688887777' })).toBe(false);
  });

  it('pausa de pedido no aplica si su referencia es null', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'pedido', referencia: null }];
    expect(pausaAplicable(pausas, { pedidoId: 'ped-1' })).toBe(false);
  });

  it('una pausa de telefono no aplica a un contexto de pedido y viceversa', () => {
    const pausaTelefono: readonly PausaVigente[] = [{ alcance: 'telefono', referencia: 'ped-1' }];
    expect(pausaAplicable(pausaTelefono, { pedidoId: 'ped-1' })).toBe(false);

    const pausaPedido: readonly PausaVigente[] = [{ alcance: 'pedido', referencia: '50688887777' }];
    expect(pausaAplicable(pausaPedido, { telefono: '50688887777' })).toBe(false);
  });

  it('varias pausas: aplica si CUALQUIERA matchea (OR)', () => {
    const pausas: readonly PausaVigente[] = [
      { alcance: 'telefono', referencia: '50699998888' },
      { alcance: 'pedido', referencia: 'ped-1' },
    ];
    expect(pausaAplicable(pausas, { telefono: '50688887777', pedidoId: 'ped-1' })).toBe(true);
    expect(pausaAplicable(pausas, { telefono: '50688887777', pedidoId: 'ped-2' })).toBe(false);
  });

  it('varias pausas sin ninguna coincidencia -> false', () => {
    const pausas: readonly PausaVigente[] = [
      { alcance: 'telefono', referencia: '50699998888' },
      { alcance: 'pedido', referencia: 'ped-9' },
    ];
    expect(pausaAplicable(pausas, { telefono: '50688887777', pedidoId: 'ped-1' })).toBe(false);
  });

  it('contexto con telefono y pedidoId simultaneos evalua ambos alcances', () => {
    const pausas: readonly PausaVigente[] = [{ alcance: 'pedido', referencia: 'ped-1' }];
    expect(pausaAplicable(pausas, { telefono: '50688887777', pedidoId: 'ped-1' })).toBe(true);
  });
});
