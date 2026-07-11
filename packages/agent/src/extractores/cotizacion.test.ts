import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClienteAnthropicMinimo } from '../agent/anthropic.js';
import { crearExtractorCotizacion } from './cotizacion.js';
import type { ItemPedidoParaExtraccion } from './cotizacion.js';

const ITEMS_PEDIDO: readonly ItemPedidoParaExtraccion[] = [
  { pedidoItemId: 'item-1', descripcion: 'Cemento gris', cantidad: 10, unidad: 'saco' },
  { pedidoItemId: 'item-2', descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
];

/** Fake del cliente Anthropic: registra los bodies recibidos y devuelve una extraccion canned. */
class ClienteFake implements ClienteAnthropicMinimo {
  readonly bodies: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];

  constructor(private readonly toolInput: unknown) {}

  readonly messages = {
    create: async (
      body: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message> => {
      this.bodies.push(body);
      return {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'registrar_cotizacion_extraida',
            input: this.toolInput,
          },
        ],
      } as unknown as Anthropic.Messages.Message;
    },
  };
}

describe('crearExtractorCotizacion', () => {
  it('texto: mapea cada linea a pedidoItemId y construye el input estricto', async () => {
    const client = new ClienteFake({
      condiciones: 'Credito 30 dias',
      plazoEntrega: '2 dias',
      confianza: 0.95,
      items: [
        { pedidoItemId: 'item-1', precioUnitario: 4500, cantidad: 10, disponible: true, notas: null },
        // id que no pertenece al pedido: se degrada a "no mapeable" (undefined) sin romper.
        { pedidoItemId: 'zzz', precioUnitario: 1200, cantidad: 25, disponible: null, notas: 'parcial' },
      ],
    });
    const extractor = crearExtractorCotizacion({ client });

    const resultado = await extractor.extraer({
      quoteRequestId: 'qr-1',
      material: { tipo: 'texto', texto: 'Cemento 4500 x10, varilla 1200 x25' },
      itemsPedido: ITEMS_PEDIDO,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('esperaba ok');
    expect(resultado.input).toEqual({
      quoteRequestId: 'qr-1',
      fuente: 'texto',
      confianzaExtraccion: 0.95,
      condiciones: 'Credito 30 dias',
      plazoEntrega: '2 dias',
      items: [
        { pedidoItemId: 'item-1', precioUnitario: 4500, cantidad: 10, disponible: true },
        { precioUnitario: 1200, cantidad: 25, disponible: null, notas: 'parcial' },
      ],
    });
    // Forzo la tool y no envio content block de media para texto.
    const body = client.bodies[0];
    expect(body?.tool_choice).toEqual({ type: 'tool', name: 'registrar_cotizacion_extraida' });
    const content = body?.messages[0]?.content as Anthropic.Messages.ContentBlockParam[];
    expect(content.every((b) => b.type === 'text')).toBe(true);
  });

  it('imagen: envia un content block image base64 con el media_type del attachment', async () => {
    const client = new ClienteFake({
      confianza: 0.9,
      items: [{ pedidoItemId: 'item-1', precioUnitario: 4500, cantidad: 10, disponible: true, notas: null }],
    });
    const extractor = crearExtractorCotizacion({ client });
    const bytes = Buffer.from('imagen-fake');

    const resultado = await extractor.extraer({
      quoteRequestId: 'qr-1',
      material: { tipo: 'imagen', bytes, mimeType: 'image/png' },
      itemsPedido: ITEMS_PEDIDO,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('esperaba ok');
    expect(resultado.input.fuente).toBe('imagen');

    const content = client.bodies[0]?.messages[0]?.content as Anthropic.Messages.ContentBlockParam[];
    const imagen = content.find((b) => b.type === 'image');
    expect(imagen).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: bytes.toString('base64') },
    });
  });

  it('propaga baja confianza (E2 lo decide la tool, no el extractor)', async () => {
    const client = new ClienteFake({
      confianza: 0.5,
      items: [{ pedidoItemId: 'item-1', precioUnitario: null, cantidad: null, disponible: null, notas: null }],
    });
    const extractor = crearExtractorCotizacion({ client });

    const resultado = await extractor.extraer({
      quoteRequestId: 'qr-1',
      material: { tipo: 'texto', texto: 'no se entiende' },
      itemsPedido: ITEMS_PEDIDO,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('esperaba ok');
    expect(resultado.input.confianzaExtraccion).toBe(0.5);
  });

  it('audio sin OPENAI_API_KEY ni transcriptor: no_procesable y no llama al modelo', async () => {
    const client = new ClienteFake({ confianza: 0.9, items: [] });
    const extractor = crearExtractorCotizacion({ client });

    const resultado = await extractor.extraer({
      quoteRequestId: 'qr-1',
      material: { tipo: 'audio', bytes: Buffer.from('audio'), mimeType: 'audio/ogg' },
      itemsPedido: ITEMS_PEDIDO,
    });

    expect(resultado.tipo).toBe('no_procesable');
    expect(client.bodies).toHaveLength(0);
  });

  it('audio con transcriptor inyectado: extrae por el camino de texto pero fuente=audio', async () => {
    const client = new ClienteFake({
      confianza: 0.88,
      items: [{ pedidoItemId: 'item-1', precioUnitario: 4500, cantidad: 10, disponible: true, notas: null }],
    });
    const extractor = crearExtractorCotizacion({
      client,
      transcribir: async () => 'cemento a 4500 el saco, 10 sacos',
    });

    const resultado = await extractor.extraer({
      quoteRequestId: 'qr-1',
      material: { tipo: 'audio', bytes: Buffer.from('audio'), mimeType: 'audio/ogg' },
      itemsPedido: ITEMS_PEDIDO,
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('esperaba ok');
    expect(resultado.input.fuente).toBe('audio');
    // El transcripto llega como content block de texto (sin media).
    const content = client.bodies[0]?.messages[0]?.content as Anthropic.Messages.ContentBlockParam[];
    expect(content.every((b) => b.type === 'text')).toBe(true);
  });
});
