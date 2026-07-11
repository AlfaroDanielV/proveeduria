import { describe, expect, it } from 'vitest';
import type { Actor, MensajeHistorial } from '../runtime/types.js';
import { crearFakeCtx, FakeToolStore } from '../runtime/fakes.js';
import {
  ejecutarTurnoConversacional,
  RESPUESTA_MAX_PASOS,
} from './conversacional.js';
import type {
  ContenidoModelo,
  DecisionModelo,
  HerramientaModelo,
  MensajeModelo,
  ModeloConversacional,
} from './conversacional.js';

const AHORA = new Date('2026-07-10T12:00:00.000Z');

const actor: Actor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

interface Llamada {
  readonly sistema: string;
  readonly mensajes: readonly MensajeModelo[];
  readonly herramientas: readonly HerramientaModelo[];
}

/** Modelo fake scripted: devuelve una secuencia de decisiones y graba cada `decidir`. */
class ModeloScripted implements ModeloConversacional {
  private indice = 0;
  readonly llamadas: Llamada[] = [];

  constructor(private readonly decisiones: readonly DecisionModelo[]) {}

  async decidir(input: {
    readonly sistema: string;
    readonly mensajes: readonly MensajeModelo[];
    readonly herramientas: readonly HerramientaModelo[];
  }): Promise<DecisionModelo> {
    this.llamadas.push({
      sistema: input.sistema,
      mensajes: input.mensajes,
      herramientas: input.herramientas,
    });
    const decision = this.decisiones[this.indice];
    this.indice += 1;
    return decision ?? { texto: null, toolUse: null };
  }
}

function esToolResult(
  bloque: ContenidoModelo,
): bloque is Extract<ContenidoModelo, { tipo: 'tool_result' }> {
  return bloque.tipo === 'tool_result';
}

function bloquesDeLlamada(llamada: Llamada | undefined): readonly ContenidoModelo[] {
  return (llamada?.mensajes ?? []).flatMap((m) => m.contenido);
}

describe('ejecutarTurnoConversacional', () => {
  it('llama crear_pedido, devuelve el resumen al modelo y responde texto', async () => {
    const store = new FakeToolStore();
    store.agregarProyecto({ id: 'proj-1', nombre: 'Torre Lopez', codigo: 'LOP', activo: true });
    const ctx = crearFakeCtx(store, actor, AHORA);

    const modelo = new ModeloScripted([
      {
        texto: null,
        toolUse: {
          id: 'tu-1',
          name: 'crear_pedido',
          input: {
            projectId: 'proj-1',
            items: [{ descripcion: 'cemento', cantidad: 20, unidad: 'sacos' }],
          },
        },
      },
      { texto: 'Listo, cree el pedido con 20 sacos de cemento.', toolUse: null },
    ]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema: 'sys',
      historial: [],
      mensajeUsuario: 'ocupo 20 sacos de cemento para Lopez',
    });

    expect(resultado.respuesta).toBe('Listo, cree el pedido con 20 sacos de cemento.');
    expect(resultado.toolsEjecutadas).toEqual([{ name: 'crear_pedido', ok: true }]);
    expect(store.pedidos.size).toBe(1);

    // El modelo recibio el tool_result (ok) antes de responder texto.
    const toolResult = bloquesDeLlamada(modelo.llamadas[1]).find(esToolResult);
    expect(toolResult).toBeDefined();
    expect(toolResult?.esError).toBe(false);
    expect(JSON.parse(toolResult?.contenido ?? '{}')).toMatchObject({ ok: true });
  });

  it('propaga el error de una tool como tool_result y el modelo lo explica', async () => {
    const store = new FakeToolStore();
    const ctx = crearFakeCtx(store, actor, AHORA);

    const modelo = new ModeloScripted([
      {
        texto: null,
        toolUse: {
          id: 'tu-1',
          name: 'crear_pedido',
          input: {
            projectId: 'no-existe',
            items: [{ descripcion: 'varilla', cantidad: 1, unidad: 'unidad' }],
          },
        },
      },
      { texto: 'No encontre ese proyecto, ¿me confirmas cual es?', toolUse: null },
    ]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema: 'sys',
      historial: [],
      mensajeUsuario: 'ocupo varilla',
    });

    expect(resultado.respuesta).toBe('No encontre ese proyecto, ¿me confirmas cual es?');
    expect(resultado.toolsEjecutadas).toEqual([{ name: 'crear_pedido', ok: false }]);
    expect(store.pedidos.size).toBe(0);

    const toolResult = bloquesDeLlamada(modelo.llamadas[1]).find(esToolResult);
    expect(toolResult?.esError).toBe(true);
    expect(JSON.parse(toolResult?.contenido ?? '{}')).toMatchObject({ ok: false });
  });

  it('devuelve disculpa fija y audita agente_max_pasos al agotar los pasos', async () => {
    const store = new FakeToolStore();
    const ctx = crearFakeCtx(store, actor, AHORA);

    const modelo = new ModeloScripted([
      { texto: null, toolUse: { id: 'a', name: 'generar_comparativo', input: { pedidoId: 'nope' } } },
      { texto: null, toolUse: { id: 'b', name: 'generar_comparativo', input: { pedidoId: 'nope' } } },
    ]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema: 'sys',
      historial: [],
      mensajeUsuario: 'dame el comparativo',
      maxPasos: 2,
    });

    expect(resultado.respuesta).toBe(RESPUESTA_MAX_PASOS);
    expect(resultado.toolsEjecutadas).toHaveLength(2);
    expect(modelo.llamadas).toHaveLength(2);
    expect(store.auditEvents.some((e) => e.accion === 'agente_max_pasos')).toBe(true);
  });

  it('cuando el modelo responde solo texto no ejecuta ninguna tool', async () => {
    const store = new FakeToolStore();
    const ctx = crearFakeCtx(store, actor, AHORA);

    const modelo = new ModeloScripted([{ texto: '¿Para cual proyecto es?', toolUse: null }]);

    const resultado = await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema: 'sys',
      historial: [],
      mensajeUsuario: 'ocupo materiales',
    });

    expect(resultado.respuesta).toBe('¿Para cual proyecto es?');
    expect(resultado.toolsEjecutadas).toEqual([]);
    expect(modelo.llamadas).toHaveLength(1);
  });

  it('mapea el historial A4 a turnos user/assistant y añade el mensaje actual al final', async () => {
    const store = new FakeToolStore();
    const ctx = crearFakeCtx(store, actor, AHORA);

    const historial: MensajeHistorial[] = [
      { direccion: 'entrante', texto: 'hola', at: new Date('2026-07-10T11:00:00.000Z') },
      { direccion: 'saliente', texto: 'buenas, en que te ayudo', at: new Date('2026-07-10T11:00:05.000Z') },
    ];
    const modelo = new ModeloScripted([{ texto: 'dale', toolUse: null }]);

    await ejecutarTurnoConversacional({
      modelo,
      ctx,
      promptSistema: 'sys',
      historial,
      mensajeUsuario: 'ocupo materiales',
    });

    const primera = modelo.llamadas[0];
    expect(primera?.mensajes).toEqual([
      { rol: 'user', contenido: [{ tipo: 'texto', texto: 'hola' }] },
      { rol: 'assistant', contenido: [{ tipo: 'texto', texto: 'buenas, en que te ayudo' }] },
      { rol: 'user', contenido: [{ tipo: 'texto', texto: 'ocupo materiales' }] },
    ]);
    expect(primera?.herramientas.map((h) => h.name)).toContain('crear_pedido');
  });
});
