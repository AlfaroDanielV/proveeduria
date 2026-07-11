import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { crearModeloAnthropic } from './anthropic.js';
import type { ClienteAnthropicMinimo } from './anthropic.js';
import type { HerramientaModelo, MensajeModelo } from './conversacional.js';

type BodySdk = Anthropic.Messages.MessageCreateParamsNonStreaming;

/** Construye una `Message` del SDK a partir del contenido (el adapter solo lee `.content`). */
function mensajeConContenido(content: readonly unknown[]): Anthropic.Messages.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    container: null,
    content,
    usage: {},
  } as unknown as Anthropic.Messages.Message;
}

function clienteFake(respuesta: Anthropic.Messages.Message): {
  readonly cliente: ClienteAnthropicMinimo;
  readonly bodies: BodySdk[];
} {
  const bodies: BodySdk[] = [];
  const cliente: ClienteAnthropicMinimo = {
    messages: {
      create: async (body: BodySdk): Promise<Anthropic.Messages.Message> => {
        bodies.push(body);
        return respuesta;
      },
    },
  };
  return { cliente, bodies };
}

const HERRAMIENTAS: readonly HerramientaModelo[] = [
  {
    name: 'crear_pedido',
    descripcion: 'crea pedido',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

const MENSAJES: readonly MensajeModelo[] = [
  { rol: 'user', contenido: [{ tipo: 'texto', texto: 'ocupo cemento' }] },
];

describe('crearModeloAnthropic (cliente inyectado)', () => {
  it('mapea sistema/mensajes/herramientas al body del SDK', async () => {
    const { cliente, bodies } = clienteFake(
      mensajeConContenido([{ type: 'text', text: 'ok', citations: null }]),
    );
    const modelo = crearModeloAnthropic({ client: cliente });

    await modelo.decidir({ sistema: 'sys', mensajes: MENSAJES, herramientas: HERRAMIENTAS });

    const body = bodies[0];
    expect(body?.model).toBe('claude-sonnet-5');
    expect(body?.max_tokens).toBe(1024);
    expect(body?.system).toBe('sys');
    expect(body?.tools).toHaveLength(1);
    expect(body?.tools?.[0]).toMatchObject({
      name: 'crear_pedido',
      description: 'crea pedido',
      input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    });
    expect(body?.messages?.[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'ocupo cemento' }],
    });
  });

  it('mapea un bloque tool_use a DecisionModelo.toolUse', async () => {
    const { cliente } = clienteFake(
      mensajeConContenido([
        { type: 'tool_use', id: 'tu_1', name: 'crear_pedido', input: { projectId: 'p-1' } },
      ]),
    );
    const modelo = crearModeloAnthropic({ client: cliente });

    const decision = await modelo.decidir({
      sistema: 'sys',
      mensajes: MENSAJES,
      herramientas: HERRAMIENTAS,
    });

    expect(decision.toolUse).toEqual({ id: 'tu_1', name: 'crear_pedido', input: { projectId: 'p-1' } });
    expect(decision.texto).toBeNull();
  });

  it('mapea bloques text a DecisionModelo.texto sin toolUse', async () => {
    const { cliente } = clienteFake(
      mensajeConContenido([{ type: 'text', text: 'buenas, en que te ayudo', citations: null }]),
    );
    const modelo = crearModeloAnthropic({ client: cliente });

    const decision = await modelo.decidir({
      sistema: 'sys',
      mensajes: MENSAJES,
      herramientas: HERRAMIENTAS,
    });

    expect(decision.texto).toBe('buenas, en que te ayudo');
    expect(decision.toolUse).toBeNull();
  });

  it('relanza los errores del SDK (el worker los trata como transitorios)', async () => {
    const cliente: ClienteAnthropicMinimo = {
      messages: {
        create: async (): Promise<Anthropic.Messages.Message> => {
          throw new Error('overloaded_error');
        },
      },
    };
    const modelo = crearModeloAnthropic({ client: cliente });

    await expect(
      modelo.decidir({ sistema: 'sys', mensajes: MENSAJES, herramientas: HERRAMIENTAS }),
    ).rejects.toThrow('overloaded_error');
  });
});

// Smoke real: SOLO corre si hay ANTHROPIC_API_KEY (no en CI). Un turno 'hola' -> texto.
const apiKey = process.env.ANTHROPIC_API_KEY;
const itSmoke = apiKey !== undefined && apiKey.trim() !== '' ? it : it.skip;

describe('crearModeloAnthropic (smoke real, gated por ANTHROPIC_API_KEY)', () => {
  itSmoke(
    'responde texto a un saludo simple',
    async () => {
      const modelo = crearModeloAnthropic(apiKey !== undefined ? { apiKey } : {});
      const decision = await modelo.decidir({
        sistema: 'Sos un asistente breve. Respondes en español.',
        mensajes: [{ rol: 'user', contenido: [{ tipo: 'texto', texto: 'hola' }] }],
        herramientas: [],
      });
      expect(decision.toolUse).toBeNull();
      expect(typeof decision.texto).toBe('string');
      expect((decision.texto ?? '').length).toBeGreaterThan(0);
    },
    30000,
  );
});
