import type { Ctx, ErrorTool, ResultadoTool } from '../runtime/types.js';
import { TOOLS_REGISTRY } from './registry.js';

/**
 * Nombres de las tools conversacionales, DERIVADOS del registro unico (`registry.ts`). Antes
 * era una union hardcodeada duplicada en `structured.ts` y `tool-dispatcher.ts`; ahora la
 * fuente unica es `TOOLS_REGISTRY` (agente-conversacional.md §A5, "fin del triple mantenimiento").
 */
export type ToolFase2a = (typeof TOOLS_REGISTRY)[number]['name'];

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
