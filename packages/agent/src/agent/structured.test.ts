import { describe, expect, it } from 'vitest';
import { extraerToolCallEstructurado } from './structured.js';

describe('extraerToolCallEstructurado', () => {
  it('lee tool_call directo', () => {
    expect(extraerToolCallEstructurado({
      tool_call: {
        name: 'crear_pedido',
        input: { projectId: 'p1', items: [] },
      },
    })).toEqual({
      name: 'crear_pedido',
      input: { projectId: 'p1', items: [] },
    });
  });

  it('lee JSON estricto desde texto de payload Meta', () => {
    expect(extraerToolCallEstructurado({
      text: {
        body: JSON.stringify({
          tool_call: {
            name: 'confirmar_pedido',
            input: { pedidoId: 'pedido-1' },
          },
        }),
      },
    })).toEqual({
      name: 'confirmar_pedido',
      input: { pedidoId: 'pedido-1' },
    });
  });

  it('rechaza tools fuera del whitelist Fase 2a', () => {
    // registrar_factura es Fase 2b (aun no whitelisted); emitir_oc paso a estar en el
    // whitelist de Fase 2a, por lo que este caso se reubico a otra tool fuera de alcance.
    expect(extraerToolCallEstructurado({
      tool_call: {
        name: 'registrar_factura',
        input: {},
      },
    })).toBeNull();
  });

  it('devuelve null si el texto no es JSON de tool_call', () => {
    expect(extraerToolCallEstructurado({ text: { body: 'hola' } })).toBeNull();
  });
});
