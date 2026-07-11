import type { Ctx, ErrorTool, ResultadoTool } from '../runtime/types.js';

export type ToolFase2a =
  | 'crear_pedido'
  | 'confirmar_pedido'
  | 'sugerir_proveedores'
  | 'enviar_rfq'
  | 'registrar_cotizacion'
  | 'generar_comparativo'
  | 'aprobar_ganador'
  | 'emitir_oc';

export interface ToolCallEstructurado {
  readonly name: ToolFase2a;
  readonly input: unknown;
}

export type ResultadoToolCall =
  | {
      readonly ok: true;
      readonly tool: ToolFase2a;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly tool: ToolFase2a;
      readonly error: ErrorTool;
    };

export interface MensajeAgente {
  readonly texto?: string;
  readonly payload?: unknown;
}

export interface ModeloToolUse {
  decidirTool(input: {
    readonly mensaje: MensajeAgente;
    readonly ctx: Ctx;
    readonly toolsDisponibles: readonly ToolFase2a[];
  }): Promise<ToolCallEstructurado | null>;
}

export type ResultadoLoopAgente =
  | {
      readonly tipo: 'sin_tool';
    }
  | {
      readonly tipo: 'tool';
      readonly resultado: ResultadoToolCall;
    };

export type ToolExecutor = (
  call: ToolCallEstructurado,
  ctx: Ctx,
) => Promise<ResultadoTool<unknown>>;
