/**
 * Registro UNICO de las tools conversacionales de Fase 2a+B (docs/specs/agente-conversacional.md
 * §A5: "Registro unico de tools ... de la que derivan el whitelist estructurado, el dispatcher
 * y los `tools` del API de Anthropic. Fin del triple mantenimiento").
 *
 * Cada entrada declara:
 *  - `name`: nombre de la tool (contrato con `tools.md`; lo usa el modelo y el dispatcher).
 *  - `descripcion`: 1-2 lineas en español para el modelo (cuando llamar la tool).
 *  - `inputSchema`: JSON Schema ESTRICTO (`additionalProperties: false`, `required` correctos)
 *    que CALCA el parser TS de cada tool — el modelo produce ese `input` y la tool lo revalida.
 *  - `ejecutar(ctx, input)`: adapta al contrato `(input, ctx)` de la tool real. La validacion
 *    completa (rol, estado, excepciones) vive en la tool, nunca aca ni en el modelo.
 *
 * De este arreglo derivan: `ToolFase2a` (agent/types.ts), `esToolFase2a` (structured.ts) y el
 * dispatcher (tool-dispatcher.ts). No duplicar la lista de nombres en ningun otro lugar.
 */

import type { Ctx, ResultadoTool } from '../runtime/types.js';
import { FUENTES_EXTRACCION } from '@proveeduria/core';
import {
  confirmarPedido,
  crearPedido,
  enviarRfq,
  generarComparativo,
  registrarCotizacion,
  sugerirProveedores,
} from '../tools/pedido.js';
import { aprobarGanador } from '../tools/adjudicacion.js';
import { emitirOc } from '../tools/oc.js';

/**
 * JSON Schema de entrada de una tool. Se mantiene minimo a proposito (objeto raiz con
 * `additionalProperties: false`); los sub-esquemas anidados son JSON libre (`unknown`).
 */
export interface EsquemaEntrada {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

/** Una entrada del registro unico de tools conversacionales. */
export interface RegistroTool {
  readonly name: string;
  readonly descripcion: string;
  readonly inputSchema: EsquemaEntrada;
  readonly ejecutar: (ctx: Ctx, input: unknown) => Promise<ResultadoTool<unknown>>;
}

/** Sub-esquema de un item de pedido (crear_pedido). Calca `parseCrearPedidoInput`. */
const ITEM_PEDIDO_SCHEMA = {
  type: 'object',
  properties: {
    descripcion: { type: 'string', description: 'Descripcion del material.' },
    cantidad: { type: 'number', description: 'Cantidad solicitada (> 0).' },
    unidad: { type: 'string', description: 'Unidad de medida (ej. sacos, m3, unidades).' },
  },
  required: ['descripcion', 'cantidad', 'unidad'],
  additionalProperties: false,
} as const;

/** Sub-esquema de un item cotizado (registrar_cotizacion). Calca `parseRegistrarCotizacionInput`. */
const ITEM_COTIZADO_SCHEMA = {
  type: 'object',
  properties: {
    pedidoItemId: { type: 'string', description: 'ID del pedido_item que cotiza (null/omitido si no mapea).' },
    precioUnitario: { type: ['number', 'null'], description: 'Precio unitario cotizado.' },
    cantidad: { type: ['number', 'null'], description: 'Cantidad disponible/cotizada.' },
    disponible: { type: ['boolean', 'null'], description: 'Si el proveedor tiene disponibilidad.' },
    notas: { type: 'string', description: 'Notas del proveedor sobre el item.' },
  },
  required: [],
  additionalProperties: false,
} as const;

/** Sub-esquema de una asignacion ganadora (aprobar_ganador). Calca `parseAsignacionGanadorInput`. */
const ASIGNACION_GANADOR_SCHEMA = {
  type: 'object',
  properties: {
    supplierId: { type: 'string', description: 'Proveedor adjudicado.' },
    pedidoItemIds: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Items del pedido que se le adjudican a ese proveedor.',
    },
  },
  required: ['supplierId', 'pedidoItemIds'],
  additionalProperties: false,
} as const;

export const TOOLS_REGISTRY = [
  {
    name: 'crear_pedido',
    descripcion:
      'Crea un pedido de materiales en borrador para un proyecto activo. Usala cuando el usuario ' +
      'pide materiales; requiere proyecto e items (descripcion, cantidad, unidad).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'ID del proyecto activo (de la lista inyectada; nunca inventado).',
        },
        items: { type: 'array', minItems: 1, items: ITEM_PEDIDO_SCHEMA },
        fechaRequerida: { type: 'string', description: 'Fecha requerida en formato YYYY-MM-DD (opcional).' },
        urgencia: { type: 'string', description: 'Urgencia declarada por el usuario (opcional).' },
      },
      required: ['projectId', 'items'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => crearPedido(input, ctx),
  },
  {
    name: 'confirmar_pedido',
    descripcion:
      'Confirma un pedido en borrador. Solo cuando el usuario confirma explicitamente el resumen ' +
      'del pedido (si, dale, confirmo).',
    inputSchema: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID del pedido a confirmar.' },
      },
      required: ['pedidoId'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => confirmarPedido(input, ctx),
  },
  {
    name: 'sugerir_proveedores',
    descripcion:
      'Devuelve un ranking editable de proveedores para un pedido, para que Proveeduria elija a ' +
      'quien pedir cotizacion.',
    inputSchema: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID del pedido.' },
      },
      required: ['pedidoId'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => sugerirProveedores(input, ctx),
  },
  {
    name: 'enviar_rfq',
    descripcion:
      'Envia la solicitud de cotizacion (RFQ) a los proveedores elegidos. Manda mensajes reales: ' +
      'solo con aprobacion humana explicita de la lista de proveedores y el plazo.',
    inputSchema: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID del pedido.' },
        supplierIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Proveedores a los que enviar el RFQ (sin repetir).',
        },
        plazoHoras: { type: 'number', description: 'Plazo de respuesta en horas (opcional, > 0; default 24).' },
      },
      required: ['pedidoId', 'supplierIds'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => enviarRfq(input, ctx),
  },
  {
    name: 'registrar_cotizacion',
    descripcion:
      'Registra manualmente una cotizacion recibida por otro canal (reenvio de Proveeduria). ' +
      'Requiere el quote_request_id, la fuente, la confianza y los items cotizados.',
    inputSchema: {
      type: 'object',
      properties: {
        quoteRequestId: { type: 'string', description: 'ID de la solicitud de cotizacion (RFQ) enviada.' },
        fuente: {
          type: 'string',
          enum: [...FUENTES_EXTRACCION],
          description: 'Origen de la cotizacion: texto, imagen, pdf o audio.',
        },
        condiciones: { type: 'string', description: 'Condiciones comerciales (opcional).' },
        plazoEntrega: { type: 'string', description: 'Plazo de entrega ofrecido (opcional).' },
        confianzaExtraccion: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confianza de la extraccion, entre 0 y 1.',
        },
        items: { type: 'array', items: ITEM_COTIZADO_SCHEMA },
      },
      required: ['quoteRequestId', 'fuente', 'confianzaExtraccion', 'items'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => registrarCotizacion(input, ctx),
  },
  {
    name: 'generar_comparativo',
    descripcion: 'Genera el comparativo item x proveedor de un pedido en revision.',
    inputSchema: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID del pedido.' },
      },
      required: ['pedidoId'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => generarComparativo(input, ctx),
  },
  {
    name: 'aprobar_ganador',
    descripcion:
      'Adjudica el pedido a uno o varios proveedores por item. Solo con instruccion humana ' +
      'explicita de a quien adjudicar; nunca por iniciativa propia aunque parezca obvio.',
    inputSchema: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID del pedido a adjudicar.' },
        asignaciones: {
          type: 'array',
          minItems: 1,
          items: ASIGNACION_GANADOR_SCHEMA,
          description: 'Una asignacion por proveedor; cada item del pedido va exactamente una vez.',
        },
      },
      required: ['pedidoId', 'asignaciones'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => aprobarGanador(input, ctx),
  },
  {
    name: 'emitir_oc',
    descripcion:
      'Emite las ordenes de compra del pedido ya adjudicado (PDF al proveedor). Solo con ' +
      'instruccion humana explicita del turno actual.',
    inputSchema: {
      type: 'object',
      properties: {
        pedidoId: { type: 'string', description: 'ID del pedido adjudicado.' },
      },
      required: ['pedidoId'],
      additionalProperties: false,
    },
    ejecutar: (ctx: Ctx, input: unknown) => emitirOc(input, ctx),
  },
] as const satisfies readonly RegistroTool[];
