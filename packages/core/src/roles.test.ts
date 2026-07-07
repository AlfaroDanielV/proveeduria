import { describe, expect, it } from 'vitest';
import type { Rol, Tool } from './index.js';
import { ROLES } from './types.js';
import { puedeUsarTool, rolesDeTool, TOOL_ROLES, TOOLS } from './roles.js';

/** Roles esperados por tool segun tools.md (Proveeduria=admin_materiales, Gerencia=superadmin). */
const ESPERADO: Record<Tool, readonly Rol[]> = {
  crear_pedido: ['ingeniero', 'admin_materiales', 'superadmin'],
  confirmar_pedido: ['ingeniero', 'admin_materiales', 'superadmin'],
  sugerir_proveedores: ['admin_materiales', 'superadmin'],
  enviar_rfq: ['admin_materiales', 'superadmin'],
  registrar_cotizacion: ['admin_materiales', 'superadmin'],
  generar_comparativo: ['admin_materiales', 'superadmin'],
  aprobar_ganador: ['admin_materiales', 'superadmin'],
  emitir_oc: ['admin_materiales', 'superadmin'],
  registrar_factura: ['bodeguero', 'admin_materiales', 'superadmin'],
  confirmar_recepcion: ['bodeguero', 'admin_materiales'],
  asociar_nota_credito: ['admin_materiales', 'superadmin'],
  cerrar_pedido: ['admin_materiales', 'superadmin'],
  registrar_equipo: ['bodeguero', 'admin_equipos', 'superadmin'],
  registrar_devolucion: ['bodeguero', 'admin_equipos', 'superadmin'],
  consultar_inventario_equipos: ['admin_equipos', 'superadmin'],
  consultar_datos: ['superadmin', 'admin_materiales', 'admin_equipos', 'ingeniero', 'bodeguero'],
  generar_link_dashboard: ['admin_materiales', 'admin_equipos', 'superadmin'],
  exportar_datos: ['admin_materiales', 'superadmin'],
  registrar_retroalimentacion: ['superadmin', 'admin_materiales', 'admin_equipos', 'ingeniero', 'bodeguero'],
};

describe('TOOLS y TOOL_ROLES', () => {
  it('expone las 19 tools del Modulo 1', () => {
    expect(TOOLS).toHaveLength(19);
    expect(new Set(TOOLS).size).toBe(TOOLS.length);
  });

  it('no incluye las tools de contratistas fuera del Modulo 1', () => {
    const fuera = [
      'registrar_contratista',
      'registrar_contrato',
      'registrar_orden_cambio',
      'pago_contratista',
      'consultar_contratistas',
    ];
    for (const t of fuera) {
      expect((TOOLS as readonly string[]).includes(t)).toBe(false);
    }
  });

  it('TOOL_ROLES tiene una entrada por cada tool', () => {
    expect(Object.keys(TOOL_ROLES).sort()).toEqual([...TOOLS].sort());
  });

  it.each(TOOLS)('los roles de %s coinciden con la spec', (tool) => {
    expect(new Set(TOOL_ROLES[tool])).toEqual(new Set(ESPERADO[tool]));
  });

  it('todos los roles referenciados son roles validos del catalogo', () => {
    for (const tool of TOOLS) {
      for (const r of TOOL_ROLES[tool]) {
        expect(ROLES.includes(r)).toBe(true);
      }
    }
  });

  it('ninguna lista de roles esta vacia', () => {
    for (const tool of TOOLS) {
      expect(TOOL_ROLES[tool].length).toBeGreaterThan(0);
    }
  });
});

describe('rolesDeTool', () => {
  it('devuelve la lista permitida de la tool', () => {
    expect(rolesDeTool('enviar_rfq')).toEqual(TOOL_ROLES.enviar_rfq);
  });
});

describe('puedeUsarTool', () => {
  it('autoriza si el solicitante tiene un rol permitido', () => {
    expect(puedeUsarTool('enviar_rfq', ['admin_materiales'])).toBe(true);
    expect(puedeUsarTool('enviar_rfq', ['superadmin'])).toBe(true);
    expect(puedeUsarTool('crear_pedido', ['ingeniero'])).toBe(true);
    expect(puedeUsarTool('registrar_factura', ['bodeguero'])).toBe(true);
    expect(puedeUsarTool('registrar_devolucion', ['admin_equipos'])).toBe(true);
  });

  it('rechaza si ningun rol del solicitante esta permitido', () => {
    expect(puedeUsarTool('enviar_rfq', ['ingeniero'])).toBe(false);
    expect(puedeUsarTool('enviar_rfq', ['bodeguero'])).toBe(false);
    expect(puedeUsarTool('aprobar_ganador', ['ingeniero', 'bodeguero'])).toBe(false);
    expect(puedeUsarTool('confirmar_recepcion', ['ingeniero'])).toBe(false);
    // superadmin NO esta listado en confirmar_recepcion (fiel a la spec).
    expect(puedeUsarTool('confirmar_recepcion', ['superadmin'])).toBe(false);
  });

  it('rechaza con lista de roles vacia', () => {
    expect(puedeUsarTool('crear_pedido', [])).toBe(false);
  });

  it('autoriza si al menos uno de varios roles esta permitido', () => {
    expect(puedeUsarTool('enviar_rfq', ['ingeniero', 'admin_materiales'])).toBe(true);
  });

  it('consultar_datos y registrar_retroalimentacion admiten a todos los roles internos', () => {
    for (const r of ROLES) {
      expect(puedeUsarTool('consultar_datos', [r])).toBe(true);
      expect(puedeUsarTool('registrar_retroalimentacion', [r])).toBe(true);
    }
  });
});
