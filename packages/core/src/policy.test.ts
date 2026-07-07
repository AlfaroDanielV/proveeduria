import { describe, expect, it } from 'vitest';
import {
  agentePuedeAdjudicarSolo,
  agentePuedeEmitirOcSolo,
  requiereAprobacion,
  requiereAprobacionHumana,
} from './policy.js';
import { TOOLS } from './roles.js';

describe('requiereAprobacion', () => {
  it('mapea cada accion a su tipo de aprobacion (tools.md)', () => {
    expect(requiereAprobacion('enviar_rfq')).toBe('lista_proveedores');
    expect(requiereAprobacion('aprobar_ganador')).toBe('ganador');
    expect(requiereAprobacion('emitir_oc')).toBe('emision_oc');
    expect(requiereAprobacion('confirmar_recepcion')).toBe('recepcion');
    expect(requiereAprobacion('asociar_nota_credito')).toBe('nc');
    expect(requiereAprobacion('cerrar_pedido')).toBe('cierre');
  });

  it('devuelve null para acciones sin aprobacion obligatoria', () => {
    const sinAprobacion = [
      'crear_pedido',
      'confirmar_pedido',
      'sugerir_proveedores',
      'registrar_cotizacion',
      'generar_comparativo',
      'registrar_factura',
      'registrar_equipo',
      'registrar_devolucion',
      'consultar_inventario_equipos',
      'consultar_datos',
      'generar_link_dashboard',
      'exportar_datos',
      'registrar_retroalimentacion',
    ] as const;
    for (const accion of sinAprobacion) {
      expect(requiereAprobacion(accion)).toBeNull();
    }
  });

  it('exactamente 6 acciones requieren aprobacion', () => {
    const conAprobacion = TOOLS.filter((t) => requiereAprobacion(t) !== null);
    expect(conAprobacion).toHaveLength(6);
  });
});

describe('requiereAprobacionHumana', () => {
  it('es true justo para las acciones con aprobacion', () => {
    expect(requiereAprobacionHumana('aprobar_ganador')).toBe(true);
    expect(requiereAprobacionHumana('emitir_oc')).toBe(true);
    expect(requiereAprobacionHumana('crear_pedido')).toBe(false);
    expect(requiereAprobacionHumana('consultar_datos')).toBe(false);
  });
});

describe('politica de decision del agente', () => {
  it('el agente NUNCA adjudica un ganador solo', () => {
    expect(agentePuedeAdjudicarSolo()).toBe(false);
  });
  it('el agente NUNCA emite una OC solo', () => {
    expect(agentePuedeEmitirOcSolo()).toBe(false);
  });
});
