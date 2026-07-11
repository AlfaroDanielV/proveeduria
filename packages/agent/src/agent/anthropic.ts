/**
 * Adapter de produccion de `ModeloConversacional` sobre `@anthropic-ai/sdk`
 * (docs/specs/agente-conversacional.md §A5, "Adapter Anthropic").
 *
 * - Modelo por config (`AGENT_MODEL`, default `claude-sonnet-5`), `max_tokens` acotado (1024).
 * - `system` + `messages` + `tools` (derivados de `HerramientaModelo`).
 * - Mapea `stop_reason` tool_use/end_turn a `DecisionModelo` (extraccion guiada por el
 *   contenido: bloque `text` -> texto, bloque `tool_use` -> toolUse).
 * - Los errores del SDK se RELANZAN: el handler/nack del worker los trata como transitorios
 *   (idempotencia por `processed_at`; el broker reintenta con backoff).
 *
 * El cliente es inyectable (constructor `client`) para tests sin red.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ContenidoModelo,
  DecisionModelo,
  HerramientaModelo,
  MensajeModelo,
  ModeloConversacional,
} from './conversacional.js';

/** Superficie minima del cliente Anthropic que usa el adapter (mockeable en tests). */
export interface ClienteAnthropicMinimo {
  readonly messages: {
    create(
      body: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message>;
  };
}

export interface CrearModeloAnthropicOptions {
  /** API key; si se omite, el SDK la lee de `ANTHROPIC_API_KEY`. */
  readonly apiKey?: string;
  /** Modelo Claude (default `claude-sonnet-5`). */
  readonly model?: string;
  /** Tope de tokens de salida (default 1024). */
  readonly maxTokens?: number;
  /** Cliente inyectable (tests). Si se omite, se construye uno real. */
  readonly client?: ClienteAnthropicMinimo;
}

const MODELO_DEFAULT = 'claude-sonnet-5';
const MAX_TOKENS_DEFAULT = 1024;

export function crearModeloAnthropic(
  opciones: CrearModeloAnthropicOptions = {},
): ModeloConversacional {
  const model = opciones.model ?? MODELO_DEFAULT;
  const maxTokens = opciones.maxTokens ?? MAX_TOKENS_DEFAULT;
  const client = opciones.client ?? clientePorDefecto(opciones.apiKey);

  return {
    async decidir({ sistema, mensajes, herramientas }): Promise<DecisionModelo> {
      const respuesta = await client.messages.create({
        model,
        max_tokens: maxTokens,
        // Presupuesto acotado (1024) para una decision de tool / respuesta corta: se apaga el
        // thinking para no gastar el budget en razonamiento interno (la spec fija max_tokens,
        // no thinking; el dispatch de tools es deterministico en las tools, no en el modelo).
        thinking: { type: 'disabled' },
        system: sistema,
        messages: mensajes.map(aMensajeSdk),
        tools: herramientas.map(aHerramientaSdk),
      });
      return aDecision(respuesta);
    },
  };
}

function clientePorDefecto(apiKey?: string): ClienteAnthropicMinimo {
  const sdk = new Anthropic(apiKey !== undefined ? { apiKey } : {});
  return {
    messages: {
      create: (body) => sdk.messages.create(body),
    },
  };
}

function aMensajeSdk(mensaje: MensajeModelo): Anthropic.Messages.MessageParam {
  return { role: mensaje.rol, content: mensaje.contenido.map(aBloqueSdk) };
}

function aBloqueSdk(bloque: ContenidoModelo): Anthropic.Messages.ContentBlockParam {
  switch (bloque.tipo) {
    case 'texto':
      return { type: 'text', text: bloque.texto };
    case 'tool_use':
      return { type: 'tool_use', id: bloque.id, name: bloque.name, input: bloque.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: bloque.toolUseId,
        content: bloque.contenido,
        is_error: bloque.esError,
      };
  }
}

function aHerramientaSdk(herramienta: HerramientaModelo): Anthropic.Messages.Tool {
  return {
    name: herramienta.name,
    description: herramienta.descripcion,
    input_schema: herramienta.inputSchema as Anthropic.Messages.Tool.InputSchema,
  };
}

/**
 * Mapea la respuesta del SDK a `DecisionModelo`. Extraccion guiada por el contenido, que cubre
 * ambos stop_reason relevantes: con `tool_use` hay un bloque `tool_use` (se toma el primero);
 * con `end_turn` no lo hay y `toolUse` queda `null`. El texto se junta de los bloques `text`.
 */
function aDecision(respuesta: Anthropic.Messages.Message): DecisionModelo {
  const textos: string[] = [];
  let toolUse: DecisionModelo['toolUse'] = null;

  for (const bloque of respuesta.content) {
    if (bloque.type === 'text') {
      textos.push(bloque.text);
    } else if (bloque.type === 'tool_use' && toolUse === null) {
      toolUse = { id: bloque.id, name: bloque.name, input: bloque.input };
    }
  }

  const texto = textos.join('\n').trim();
  return { texto: texto === '' ? null : texto, toolUse };
}
