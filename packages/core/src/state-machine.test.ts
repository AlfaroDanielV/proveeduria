import { describe, expect, it } from 'vitest';
import type { ActorTransicion, EstadoPedido, Rol } from './types.js';
import { ESTADOS_PEDIDO } from './types.js';
import {
  actorAutorizado,
  aprobacionDeTransicion,
  buscarTransicion,
  esTerminal,
  puedeTransicionar,
  transicionRequiereMotivo,
  transicionesValidasDesde,
  TRANSICIONES,
} from './state-machine.js';

/** Todas las transiciones validas segun state-machine.md, como pares `de->a`. */
const VALIDAS: ReadonlyArray<readonly [EstadoPedido, EstadoPedido]> = [
  ['borrador', 'cotizando'],
  ['cotizando', 'en_revision'],
  ['en_revision', 'cotizando'],
  ['en_revision', 'aprobado'],
  ['aprobado', 'ordenado'],
  ['ordenado', 'recepcion_parcial'],
  ['ordenado', 'recepcion_total'],
  ['recepcion_parcial', 'recepcion_parcial'],
  ['recepcion_parcial', 'recepcion_total'],
  ['recepcion_total', 'cerrado'],
  ['borrador', 'cancelado'],
  ['cotizando', 'cancelado'],
  ['en_revision', 'cancelado'],
  ['aprobado', 'cancelado'],
];

const clave = (de: EstadoPedido, a: EstadoPedido): string => `${de}->${a}`;
const VALIDAS_SET = new Set(VALIDAS.map(([de, a]) => clave(de, a)));

const roles = (...rs: Rol[]): ActorTransicion => ({ tipo: 'roles', roles: rs });
const SISTEMA: ActorTransicion = { tipo: 'sistema' };

describe('TRANSICIONES (tabla)', () => {
  it('contiene exactamente las 14 transiciones de la spec', () => {
    expect(TRANSICIONES).toHaveLength(VALIDAS.length);
  });

  it('no tiene duplicados de->a', () => {
    const claves = TRANSICIONES.map((t) => clave(t.de, t.a));
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('cada entrada de la tabla es una transicion valida esperada', () => {
    for (const t of TRANSICIONES) {
      expect(VALIDAS_SET.has(clave(t.de, t.a))).toBe(true);
    }
  });
});

describe('puedeTransicionar', () => {
  it.each(VALIDAS)('permite la transicion valida %s -> %s', (de, a) => {
    const r = puedeTransicionar(de, a);
    expect(r.ok).toBe(true);
  });

  // Producto cartesiano completo: todo par que NO este en VALIDAS debe rechazarse con E12.
  const TODOS: Array<readonly [EstadoPedido, EstadoPedido]> = [];
  for (const de of ESTADOS_PEDIDO) {
    for (const a of ESTADOS_PEDIDO) {
      TODOS.push([de, a]);
    }
  }
  const INVALIDAS = TODOS.filter(([de, a]) => !VALIDAS_SET.has(clave(de, a)));

  it('cubre 81 pares en total (9x9) y 67 invalidos', () => {
    expect(TODOS).toHaveLength(81);
    expect(INVALIDAS).toHaveLength(81 - VALIDAS.length);
  });

  it.each(INVALIDAS)('rechaza la transicion invalida %s -> %s con E12', (de, a) => {
    const r = puedeTransicionar(de, a);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe('E12');
      expect(r.error.mensaje).toBeTruthy();
    }
  });

  it('reglas duras: ordenado+ no admite cancelado', () => {
    for (const de of ['ordenado', 'recepcion_parcial', 'recepcion_total', 'cerrado'] as const) {
      expect(puedeTransicionar(de, 'cancelado').ok).toBe(false);
    }
  });

  it('reglas duras: cerrado y cancelado son terminales (sin salida)', () => {
    for (const a of ESTADOS_PEDIDO) {
      expect(puedeTransicionar('cerrado', a).ok).toBe(false);
      expect(puedeTransicionar('cancelado', a).ok).toBe(false);
    }
  });

  it('el mensaje de estado terminal es distinto del de transicion comun', () => {
    const term = puedeTransicionar('cerrado', 'cotizando');
    const comun = puedeTransicionar('borrador', 'aprobado');
    expect(term.ok).toBe(false);
    expect(comun.ok).toBe(false);
    if (!term.ok && !comun.ok) {
      expect(term.error.mensaje).toContain('terminal');
      expect(comun.error.mensaje).not.toContain('terminal');
    }
  });
});

describe('transicionesValidasDesde', () => {
  it('borrador -> [cotizando, cancelado]', () => {
    expect(new Set(transicionesValidasDesde('borrador'))).toEqual(
      new Set<EstadoPedido>(['cotizando', 'cancelado']),
    );
  });
  it('cotizando -> [en_revision, cancelado]', () => {
    expect(new Set(transicionesValidasDesde('cotizando'))).toEqual(
      new Set<EstadoPedido>(['en_revision', 'cancelado']),
    );
  });
  it('en_revision -> [cotizando, aprobado, cancelado]', () => {
    expect(new Set(transicionesValidasDesde('en_revision'))).toEqual(
      new Set<EstadoPedido>(['cotizando', 'aprobado', 'cancelado']),
    );
  });
  it('aprobado -> [ordenado, cancelado]', () => {
    expect(new Set(transicionesValidasDesde('aprobado'))).toEqual(
      new Set<EstadoPedido>(['ordenado', 'cancelado']),
    );
  });
  it('ordenado -> [recepcion_parcial, recepcion_total]', () => {
    expect(new Set(transicionesValidasDesde('ordenado'))).toEqual(
      new Set<EstadoPedido>(['recepcion_parcial', 'recepcion_total']),
    );
  });
  it('recepcion_parcial -> [recepcion_parcial, recepcion_total]', () => {
    expect(new Set(transicionesValidasDesde('recepcion_parcial'))).toEqual(
      new Set<EstadoPedido>(['recepcion_parcial', 'recepcion_total']),
    );
  });
  it('recepcion_total -> [cerrado]', () => {
    expect(transicionesValidasDesde('recepcion_total')).toEqual(['cerrado']);
  });
  it('cerrado y cancelado no tienen salidas', () => {
    expect(transicionesValidasDesde('cerrado')).toEqual([]);
    expect(transicionesValidasDesde('cancelado')).toEqual([]);
  });
});

describe('esTerminal', () => {
  it('cerrado y cancelado son terminales', () => {
    expect(esTerminal('cerrado')).toBe(true);
    expect(esTerminal('cancelado')).toBe(true);
  });
  it('los demas no son terminales', () => {
    for (const e of ESTADOS_PEDIDO) {
      if (e === 'cerrado' || e === 'cancelado') continue;
      expect(esTerminal(e)).toBe(false);
    }
  });
});

describe('transicionRequiereMotivo', () => {
  it('las cancelaciones exigen motivo', () => {
    for (const de of ['borrador', 'cotizando', 'en_revision', 'aprobado'] as const) {
      expect(transicionRequiereMotivo(de, 'cancelado')).toBe(true);
    }
  });
  it('las demas transiciones no exigen motivo', () => {
    for (const [de, a] of VALIDAS) {
      if (a === 'cancelado') continue;
      expect(transicionRequiereMotivo(de, a)).toBe(false);
    }
  });
  it('una transicion inexistente no requiere motivo', () => {
    expect(transicionRequiereMotivo('borrador', 'aprobado')).toBe(false);
  });
});

describe('aprobacionDeTransicion', () => {
  it('mapea las aprobaciones obligatorias', () => {
    expect(aprobacionDeTransicion('borrador', 'cotizando')).toBe('lista_proveedores');
    expect(aprobacionDeTransicion('en_revision', 'aprobado')).toBe('ganador');
    expect(aprobacionDeTransicion('aprobado', 'ordenado')).toBe('emision_oc');
    expect(aprobacionDeTransicion('ordenado', 'recepcion_parcial')).toBe('recepcion');
    expect(aprobacionDeTransicion('ordenado', 'recepcion_total')).toBe('recepcion');
    expect(aprobacionDeTransicion('recepcion_parcial', 'recepcion_parcial')).toBe('recepcion');
    expect(aprobacionDeTransicion('recepcion_parcial', 'recepcion_total')).toBe('recepcion');
    expect(aprobacionDeTransicion('recepcion_total', 'cerrado')).toBe('cierre');
  });
  it('transiciones sin aprobacion devuelven null', () => {
    expect(aprobacionDeTransicion('cotizando', 'en_revision')).toBeNull();
    expect(aprobacionDeTransicion('en_revision', 'cotizando')).toBeNull();
    expect(aprobacionDeTransicion('borrador', 'cancelado')).toBeNull();
  });
  it('transicion inexistente devuelve null', () => {
    expect(aprobacionDeTransicion('borrador', 'ordenado')).toBeNull();
  });
});

describe('buscarTransicion', () => {
  it('devuelve la transicion para un par valido', () => {
    const t = buscarTransicion('borrador', 'cotizando');
    expect(t?.de).toBe('borrador');
    expect(t?.a).toBe('cotizando');
    expect(t?.actor).toEqual({ tipo: 'roles', roles: ['admin_materiales', 'superadmin'] });
  });
  it('devuelve undefined para un par invalido', () => {
    expect(buscarTransicion('cerrado', 'cotizando')).toBeUndefined();
  });
});

describe('actorAutorizado', () => {
  it('transiciones de Proveeduria: admin_materiales y superadmin autorizados', () => {
    for (const [de, a] of [
      ['borrador', 'cotizando'],
      ['en_revision', 'cotizando'],
      ['en_revision', 'aprobado'],
      ['recepcion_total', 'cerrado'],
    ] as const) {
      expect(actorAutorizado(de, a, roles('admin_materiales'))).toBe(true);
      expect(actorAutorizado(de, a, roles('superadmin'))).toBe(true);
      expect(actorAutorizado(de, a, roles('ingeniero'))).toBe(false);
      expect(actorAutorizado(de, a, roles('bodeguero'))).toBe(false);
      expect(actorAutorizado(de, a, roles('admin_equipos'))).toBe(false);
      expect(actorAutorizado(de, a, SISTEMA)).toBe(false);
    }
  });

  it('cancelacion: solo Proveeduria/Gerencia (admin_materiales/superadmin)', () => {
    for (const de of ['borrador', 'cotizando', 'en_revision', 'aprobado'] as const) {
      expect(actorAutorizado(de, 'cancelado', roles('admin_materiales'))).toBe(true);
      expect(actorAutorizado(de, 'cancelado', roles('superadmin'))).toBe(true);
      expect(actorAutorizado(de, 'cancelado', roles('ingeniero'))).toBe(false);
      expect(actorAutorizado(de, 'cancelado', SISTEMA)).toBe(false);
    }
  });

  it('transiciones de Sistema: solo el sistema, ni siquiera superadmin', () => {
    for (const [de, a] of [
      ['cotizando', 'en_revision'],
      ['aprobado', 'ordenado'],
      ['ordenado', 'recepcion_parcial'],
      ['ordenado', 'recepcion_total'],
      ['recepcion_parcial', 'recepcion_parcial'],
      ['recepcion_parcial', 'recepcion_total'],
    ] as const) {
      expect(actorAutorizado(de, a, SISTEMA)).toBe(true);
      expect(actorAutorizado(de, a, roles('superadmin'))).toBe(false);
      expect(actorAutorizado(de, a, roles('admin_materiales'))).toBe(false);
      expect(actorAutorizado(de, a, roles('bodeguero'))).toBe(false);
    }
  });

  it('un actor con varios roles pasa si alguno esta permitido', () => {
    expect(actorAutorizado('borrador', 'cotizando', roles('ingeniero', 'admin_materiales'))).toBe(true);
  });

  it('un actor sin roles no esta autorizado', () => {
    expect(actorAutorizado('borrador', 'cotizando', roles())).toBe(false);
  });

  it('transicion inexistente: nadie autorizado', () => {
    expect(actorAutorizado('borrador', 'ordenado', roles('superadmin'))).toBe(false);
    expect(actorAutorizado('borrador', 'ordenado', SISTEMA)).toBe(false);
  });
});
