/**
 * Extractor de cotizaciones de proveedor (docs/specs/agente-conversacional.md §A6).
 *
 * Contrato unico `ExtractorCotizacion`: recibe el material de un proveedor (texto libre, foto,
 * PDF o audio) mas los items del pedido y construye un `RegistrarCotizacionInput` ESTRICTO con
 * `confianzaExtraccion`. El LLM SOLO extrae/mapea; la tool `registrar_cotizacion` valida todo
 * (E2, repreguntas, review, transicion) — el extractor nunca escribe estado.
 *
 * Mecanismo (spec §A6 + EXECUTION_PLAN §5, extraccion barata):
 *  - Texto -> SDK Anthropic con tool FORZADA (`tool_choice`) cuyo `input_schema` es el shape
 *    estricto; el prompt lleva los items del pedido (id + descripcion + cantidad + unidad) para
 *    que el modelo mapee cada linea a `pedidoItemId` directamente (o `null` si no calza).
 *  - Imagen/PDF -> mismo mecanismo con un content block `image` (base64) o `document` (PDF
 *    base64); los bytes vienen del attachment del pipeline de media (media.ts del worker).
 *  - Audio -> si hay `OPENAI_API_KEY`, se transcribe con Whisper (multipart via `fetch`
 *    inyectable, SIN instalar el SDK de OpenAI) y se sigue por el camino de texto; sin key ->
 *    `{ tipo: 'no_procesable' }` para que el engine repregunte (el conteo de intentos E2 lo
 *    maneja el engine con un audit propio, NO se crea `quote_response`).
 *
 * El cliente Anthropic y el `fetch` de Whisper son inyectables para tests sin red. NO se
 * extiende el adapter conversacional (`agent/anthropic.ts`): esta es una funcion de extraccion
 * propia con schema estricto, como recomienda la spec.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { FuenteExtraccion } from '@proveeduria/core';
import type { ClienteAnthropicMinimo } from '../agent/anthropic.js';
import type {
  RegistrarCotizacionInput,
  RegistrarCotizacionItemInput,
} from '../tools/pedido.js';

/** Item del pedido que se le pasa al modelo para mapear cada linea cotizada a su `pedidoItemId`. */
export interface ItemPedidoParaExtraccion {
  readonly pedidoItemId: string;
  readonly descripcion: string;
  readonly cantidad: number;
  readonly unidad: string;
}

/** Material crudo del proveedor a extraer. `bytes` vienen del attachment persistido (media.ts). */
export type MaterialCotizacion =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'imagen'; readonly bytes: Buffer; readonly mimeType: string }
  | { readonly tipo: 'pdf'; readonly bytes: Buffer; readonly mimeType: string }
  | { readonly tipo: 'audio'; readonly bytes: Buffer; readonly mimeType: string };

export interface EntradaExtraccion {
  readonly quoteRequestId: string;
  readonly material: MaterialCotizacion;
  readonly itemsPedido: readonly ItemPedidoParaExtraccion[];
}

/**
 * Resultado del extractor: `ok` con el input para la tool, o `no_procesable` (audio sin key,
 * o material que el modelo no pudo leer en absoluto) para que el engine repregunte.
 */
export type ResultadoExtraccion =
  | { readonly tipo: 'ok'; readonly input: RegistrarCotizacionInput }
  | { readonly tipo: 'no_procesable'; readonly motivo: string };

export interface ExtractorCotizacion {
  extraer(entrada: EntradaExtraccion): Promise<ResultadoExtraccion>;
}

/** Modelo de extraccion por defecto (barato — EXECUTION_PLAN §5). Full id de Haiku 4.5. */
export const MODELO_EXTRACT_DEFAULT = 'claude-haiku-4-5-20251001';
/** Tope de tokens de salida del extractor. */
export const MAX_TOKENS_EXTRACT_DEFAULT = 2048;
/** Modelo de transcripcion de OpenAI (Whisper). */
const WHISPER_MODEL = 'whisper-1';
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

const NOMBRE_TOOL = 'registrar_cotizacion_extraida';

/** Shape ESTRICTO de la extraccion (tool forzada). `additionalProperties: false` en todo objeto. */
const INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['confianza', 'items'],
  properties: {
    condiciones: { type: ['string', 'null'] },
    plazoEntrega: { type: ['string', 'null'] },
    confianza: { type: 'number', minimum: 0, maximum: 1 },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pedidoItemId', 'precioUnitario', 'cantidad', 'disponible', 'notas'],
        properties: {
          pedidoItemId: { type: ['string', 'null'] },
          precioUnitario: { type: ['number', 'null'] },
          cantidad: { type: ['number', 'null'] },
          disponible: { type: ['boolean', 'null'] },
          notas: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const SISTEMA_EXTRACTOR =
  'Sos un extractor de cotizaciones de proveedores para una empresa constructora en Costa ' +
  'Rica. Recibis una cotizacion (texto, foto o PDF) y llamas la herramienta ' +
  `${NOMBRE_TOOL} con los datos de cada item. NO inventes precios ni cantidades: si un dato ` +
  'no aparece, dejalo en null. Si el material no parece una cotizacion, devolve confianza baja ' +
  'e items vacios.';

export interface CrearExtractorCotizacionOptions {
  /** API key de Anthropic; si se omite y no hay `client`, el SDK la lee de `ANTHROPIC_API_KEY`. */
  readonly apiKey?: string;
  /** Cliente Anthropic inyectable (tests). Si se omite, se construye uno real. */
  readonly client?: ClienteAnthropicMinimo;
  /** Modelo de extraccion (default `MODELO_EXTRACT_DEFAULT`). */
  readonly model?: string;
  /** Tope de tokens de salida (default `MAX_TOKENS_EXTRACT_DEFAULT`). */
  readonly maxTokens?: number;
  /** API key de OpenAI (opcional) para transcribir audio con Whisper. Sin ella, audio -> no_procesable. */
  readonly openaiApiKey?: string;
  /** `fetch` inyectable para Whisper (tests sin red); default: `fetch` global. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Transcriptor de audio inyectable (tests): reemplaza el camino Whisper. Si se define, se usa
   * aunque no haya `openaiApiKey`.
   */
  readonly transcribir?: (bytes: Buffer, mimeType: string) => Promise<string>;
}

export function crearExtractorCotizacion(
  opciones: CrearExtractorCotizacionOptions = {},
): ExtractorCotizacion {
  const model = opciones.model ?? MODELO_EXTRACT_DEFAULT;
  const maxTokens = opciones.maxTokens ?? MAX_TOKENS_EXTRACT_DEFAULT;
  const client = opciones.client ?? clientePorDefecto(opciones.apiKey);
  const fetchImpl = opciones.fetchImpl ?? fetch;
  const openaiApiKey = opciones.openaiApiKey;
  const transcribir = opciones.transcribir
    ?? (openaiApiKey !== undefined
      ? (bytes: Buffer, mimeType: string): Promise<string> =>
          transcribirWhisper(bytes, mimeType, openaiApiKey, fetchImpl)
      : undefined);

  async function ejecutar(
    bloques: readonly Anthropic.Messages.ContentBlockParam[],
    entrada: EntradaExtraccion,
    fuente: FuenteExtraccion,
    textoUsuario: string,
  ): Promise<ResultadoExtraccion> {
    const respuesta = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // Extraccion estructurada corta: sin thinking (compatible con `tool_choice` forzado en
      // Haiku/Sonnet/Opus; mismo criterio que el adapter conversacional).
      thinking: { type: 'disabled' },
      system: SISTEMA_EXTRACTOR,
      messages: [
        {
          role: 'user',
          content: [...bloques, { type: 'text', text: textoUsuario }],
        },
      ],
      tools: [
        {
          name: NOMBRE_TOOL,
          description:
            'Registra los datos extraidos de la cotizacion del proveedor, mapeando cada linea ' +
            'a un pedidoItemId cuando calza.',
          input_schema: INPUT_SCHEMA as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: NOMBRE_TOOL },
    });

    const toolInput = extraerToolInput(respuesta);
    if (toolInput === null) {
      return { tipo: 'no_procesable', motivo: 'el modelo no devolvio la extraccion' };
    }
    return {
      tipo: 'ok',
      input: construirInput(toolInput, entrada.quoteRequestId, fuente, entrada.itemsPedido),
    };
  }

  return {
    async extraer(entrada: EntradaExtraccion): Promise<ResultadoExtraccion> {
      const material = entrada.material;
      const promptItems = construirPromptItems(entrada.itemsPedido);

      if (material.tipo === 'texto') {
        return ejecutar([], entrada, 'texto', `${promptItems}\n\nTexto de la cotizacion:\n${material.texto}`);
      }

      if (material.tipo === 'imagen') {
        const bloque: Anthropic.Messages.ImageBlockParam = {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaTypeImagen(material.mimeType),
            data: material.bytes.toString('base64'),
          },
        };
        return ejecutar([bloque], entrada, 'imagen', promptItems);
      }

      if (material.tipo === 'pdf') {
        const bloque: Anthropic.Messages.DocumentBlockParam = {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: material.bytes.toString('base64'),
          },
        };
        return ejecutar([bloque], entrada, 'pdf', promptItems);
      }

      // Audio: sin transcriptor (no hay OPENAI_API_KEY) -> no_procesable (el engine repregunta).
      if (transcribir === undefined) {
        return { tipo: 'no_procesable', motivo: 'audio sin OPENAI_API_KEY' };
      }
      let texto: string;
      try {
        texto = await transcribir(material.bytes, material.mimeType);
      } catch (error) {
        return {
          tipo: 'no_procesable',
          motivo: `fallo al transcribir el audio: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      // La fuente sigue siendo 'audio' aunque se extraiga sobre el transcripto (data-model.md).
      return ejecutar([], entrada, 'audio', `${promptItems}\n\nTranscripcion del audio:\n${texto}`);
    },
  };
}

function clientePorDefecto(apiKey?: string): ClienteAnthropicMinimo {
  const sdk = new Anthropic(apiKey !== undefined ? { apiKey } : {});
  return { messages: { create: (body) => sdk.messages.create(body) } };
}

function construirPromptItems(items: readonly ItemPedidoParaExtraccion[]): string {
  const lineas = items
    .map((item) => `- [pedidoItemId: ${item.pedidoItemId}] ${item.descripcion} — ${item.cantidad} ${item.unidad}`)
    .join('\n');
  return (
    'Items del pedido (mapea cada linea cotizada a uno por su pedidoItemId; si una linea no ' +
    'calza con ninguno, usa pedidoItemId: null):\n' +
    (lineas === '' ? '(sin items)' : lineas)
  );
}

/** Extrae el `input` del primer bloque `tool_use` con el nombre esperado; `null` si no hay. */
function extraerToolInput(respuesta: Anthropic.Messages.Message): unknown {
  for (const bloque of respuesta.content) {
    if (bloque.type === 'tool_use' && bloque.name === NOMBRE_TOOL) {
      return bloque.input;
    }
  }
  return null;
}

function construirInput(
  raw: unknown,
  quoteRequestId: string,
  fuente: FuenteExtraccion,
  itemsPedido: readonly ItemPedidoParaExtraccion[],
): RegistrarCotizacionInput {
  const rec = isRecord(raw) ? raw : {};
  const idsValidos = new Set(itemsPedido.map((item) => item.pedidoItemId));
  const itemsRaw = Array.isArray(rec.items) ? rec.items : [];
  const items: RegistrarCotizacionItemInput[] = itemsRaw.map((itemRaw) =>
    construirItem(itemRaw, idsValidos),
  );

  const input: {
    quoteRequestId: string;
    fuente: FuenteExtraccion;
    confianzaExtraccion: number;
    items: readonly RegistrarCotizacionItemInput[];
    condiciones?: string;
    plazoEntrega?: string;
  } = {
    quoteRequestId,
    fuente,
    confianzaExtraccion: clamp01(typeof rec.confianza === 'number' ? rec.confianza : 0),
    items,
  };
  if (typeof rec.condiciones === 'string' && rec.condiciones.trim() !== '') {
    input.condiciones = rec.condiciones;
  }
  if (typeof rec.plazoEntrega === 'string' && rec.plazoEntrega.trim() !== '') {
    input.plazoEntrega = rec.plazoEntrega;
  }
  return input;
}

function construirItem(
  raw: unknown,
  idsValidos: ReadonlySet<string>,
): RegistrarCotizacionItemInput {
  const rec = isRecord(raw) ? raw : {};
  const item: {
    pedidoItemId?: string;
    precioUnitario?: number | null;
    cantidad?: number | null;
    disponible?: boolean | null;
    notas?: string;
  } = {};
  // Mapeo linea->pedido_item_id del modelo. Un id que el modelo alucine (no pertenece al
  // pedido) se degrada a "no mapeable" (undefined) en vez de romper la tool: registrarCotizacion
  // ya soporta pedidoItemId ausente/null.
  if (typeof rec.pedidoItemId === 'string' && idsValidos.has(rec.pedidoItemId)) {
    item.pedidoItemId = rec.pedidoItemId;
  }
  if (typeof rec.precioUnitario === 'number' && Number.isFinite(rec.precioUnitario)) {
    item.precioUnitario = rec.precioUnitario;
  } else if (rec.precioUnitario === null) {
    item.precioUnitario = null;
  }
  if (typeof rec.cantidad === 'number' && Number.isFinite(rec.cantidad)) {
    item.cantidad = rec.cantidad;
  } else if (rec.cantidad === null) {
    item.cantidad = null;
  }
  if (typeof rec.disponible === 'boolean') {
    item.disponible = rec.disponible;
  } else if (rec.disponible === null) {
    item.disponible = null;
  }
  if (typeof rec.notas === 'string' && rec.notas.trim() !== '') {
    item.notas = rec.notas;
  }
  return item;
}

/** Multipart a Whisper (`fetch` inyectable). Devuelve el texto transcrito; lanza si el API falla. */
async function transcribirWhisper(
  bytes: Buffer,
  mimeType: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const form = new FormData();
  form.append('model', WHISPER_MODEL);
  form.append('file', new Blob([bytes], { type: mimeType || 'audio/ogg' }), nombreArchivoAudio(mimeType));
  const respuesta = await fetchImpl(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!respuesta.ok) {
    throw new Error(`Whisper respondio HTTP ${respuesta.status}`);
  }
  const json = (await respuesta.json()) as { text?: unknown };
  if (typeof json.text !== 'string') {
    throw new Error('Whisper no devolvio `text`');
  }
  return json.text;
}

function nombreArchivoAudio(mimeType: string): string {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'audio.mp3';
  if (mimeType.includes('wav')) return 'audio.wav';
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'audio.m4a';
  return 'audio.ogg';
}

const MEDIA_TYPES_IMAGEN: ReadonlySet<Anthropic.Messages.Base64ImageSource['media_type']> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** Normaliza el mime del attachment al enum que acepta el content block `image`; default jpeg. */
function mediaTypeImagen(mimeType: string): Anthropic.Messages.Base64ImageSource['media_type'] {
  const normal = mimeType.trim().toLowerCase();
  return MEDIA_TYPES_IMAGEN.has(normal as Anthropic.Messages.Base64ImageSource['media_type'])
    ? (normal as Anthropic.Messages.Base64ImageSource['media_type'])
    : 'image/jpeg';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
