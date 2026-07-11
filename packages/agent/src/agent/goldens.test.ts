/**
 * Goldens de conversacion (docs/specs/agente-conversacional.md §A5, "Goldens"): fixtures
 * mensaje -> tool esperada / respuesta contra un modelo fake scripted, ejercitando el loop real
 * (`ejecutarTurnoConversacional`) con el prompt de produccion (`construirPromptSistema`) y las
 * tools reales contra fakes. Regresion sin red del CONTRATO del loop y de la politica
 * (recomienda pero jamas adjudica/emite sin instruccion explicita).
 *
 * Si estos goldens se rompen al editar el prompt (revision humana), el cambio de comportamiento
 * fue real (AI_ASSISTED_DEVELOPMENT.md §7).
 */

import { describe, expect, it } from 'vitest';
import type { Actor } from '../runtime/types.js';
import { crearFakeCtx, FakeToolStore } from '../runtime/fakes.js';
import { construirPromptSistema } from './prompt.js';
import type { ProyectoPrompt } from './prompt.js';
import { ejecutarTurnoConversacional } from './conversacional.js';
import type {
  ContenidoModelo,
  DecisionModelo,
  MensajeModelo,
  ModeloConversacional,
} from './conversacional.js';

const AHORA = new Date('2026-07-10T12:00:00.000Z');

const proveeduria: Actor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

class ModeloScripted implements ModeloConversacional {
  private indice = 0;
  readonly llamadas: { readonly sistema: string; readonly mensajes: readonly MensajeModelo[] }[] = [];

  constructor(private readonly decisiones: readonly DecisionModelo[]) {}

  async decidir(input: {
    readonly sistema: string;
    readonly mensajes: readonly MensajeModelo[];
  }): Promise<DecisionModelo> {
    this.llamadas.push({ sistema: input.sistema, mensajes: input.mensajes });
    const decision = this.decisiones[this.indice];
    this.indice += 1;
    return decision ?? { texto: null, toolUse: null };
  }
}

function toolResultsDe(mensajes: readonly MensajeModelo[]): readonly Extract<ContenidoModelo, { tipo: 'tool_result' }>[] {
  return mensajes
    .flatMap((m) => m.contenido)
    .filter((b): b is Extract<ContenidoModelo, { tipo: 'tool_result' }> => b.tipo === 'tool_result');
}

function promptCon(proyectos: readonly ProyectoPrompt[]): string {
  return construirPromptSistema({
    nombreUsuario: proveeduria.nombre,
    roles: proveeduria.roles,
    proyectosActivos: proyectos,
    ahora: AHORA,
  });
}

describe('goldens de conversacion', () => {
  it('golden: crear pedido feliz (20 sacos de cemento para Lopez)', async () => {
    const store = new FakeToolStore();
    store.agregarProyecto({ id: 'PROJ-LOPEZ', nombre: 'Torre Lopez', codigo: 'LOP', activo: true });
    const ctx = crearFakeCtx(store, proveeduria, AHORA);

    const promptSistema = promptCon([{ id: 'PROJ-LOPEZ', nombre: 'Torre Lopez', codigo: 'LOP' }]);
    // El prompt real inyecta los proyectos activos (resolucion E7).
    expect(promptSistema).toContain('Torre Lopez');

    const modelo = new ModeloScripted([
      {
        texto: null,
        toolUse: {
          id: 'tu-1',
          name: 'crear_pedido',
          input: {
            projectId: 'PROJ-LOPEZ',
            items: [{ descripcion: 'cemento', cantidad: 20, unidad: 'sacos' }],
          },
        },
      },
      { texto: 'Cree el pedido PED con 20 sacos de cemento para Torre Lopez. ¿Lo confirmo?', toolUse: null },
    ]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema,
      historial: [],
      mensajeUsuario: 'ocupo 20 sacos de cemento para Lopez',
    });

    // La tool se ejecuto con ese input contra fakes.
    expect(store.pedidos.size).toBe(1);
    const pedido = [...store.pedidos.values()][0];
    expect(pedido?.projectId).toBe('PROJ-LOPEZ');
    expect(resultado.toolsEjecutadas).toEqual([{ name: 'crear_pedido', ok: true }]);

    // El resumen (tool_result ok) volvio al modelo antes de la respuesta.
    const resumenes = toolResultsDe(modelo.llamadas[1]?.mensajes ?? []);
    expect(resumenes).toHaveLength(1);
    expect(JSON.parse(resumenes[0]?.contenido ?? '{}')).toMatchObject({ ok: true });
    expect(resultado.respuesta).toContain('confirmo');
  });

  it('golden: proyecto ambiguo -> sin tool, pregunta cual proyecto', async () => {
    const store = new FakeToolStore();
    store.agregarProyecto({ id: 'PROJ-A', nombre: 'Torre Lopez', codigo: 'LOP', activo: true });
    store.agregarProyecto({ id: 'PROJ-B', nombre: 'Condominio Lopez', codigo: 'CLO', activo: true });
    const ctx = crearFakeCtx(store, proveeduria, AHORA);

    const promptSistema = promptCon([
      { id: 'PROJ-A', nombre: 'Torre Lopez', codigo: 'LOP' },
      { id: 'PROJ-B', nombre: 'Condominio Lopez', codigo: 'CLO' },
    ]);

    const modelo = new ModeloScripted([
      { texto: '¿Es para Torre Lopez o Condominio Lopez? Confirmame el proyecto antes de crear el pedido.', toolUse: null },
    ]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema,
      historial: [],
      mensajeUsuario: 'ocupo 20 sacos de cemento para Lopez',
    });

    expect(resultado.toolsEjecutadas).toEqual([]);
    expect(store.pedidos.size).toBe(0);
    expect(modelo.llamadas).toHaveLength(1);
    expect(resultado.respuesta).toContain('proyecto');
  });

  it('golden: adjudicacion sin instruccion explicita -> recomienda, NO llama aprobar_ganador', async () => {
    const store = new FakeToolStore();
    store.agregarProyecto({ id: 'PROJ-LOPEZ', nombre: 'Torre Lopez', codigo: 'LOP', activo: true });
    const ctx = crearFakeCtx(store, proveeduria, AHORA);

    const promptSistema = promptCon([{ id: 'PROJ-LOPEZ', nombre: 'Torre Lopez', codigo: 'LOP' }]);

    // El usuario pide una opinion, no instruye a quien adjudicar: el modelo recomienda con texto,
    // sin toolUse. El loop NO debe ejecutar aprobar_ganador.
    const modelo = new ModeloScripted([
      {
        texto: 'Segun el comparativo, Ferreteria Sur sale mas barata y completa. Te recomiendo esa, pero decime vos a quien adjudico.',
        toolUse: null,
      },
    ]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema,
      historial: [],
      mensajeUsuario: '¿a quien me conviene comprarle?',
    });

    expect(resultado.toolsEjecutadas).toEqual([]);
    expect(store.approvalEvents).toHaveLength(0);
    expect(store.pedidos.size).toBe(0);
    expect(resultado.respuesta).toContain('recomiendo');
  });
});
