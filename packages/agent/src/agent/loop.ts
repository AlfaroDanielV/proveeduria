import type { Ctx } from '../runtime/types.js';
import {
  ejecutarToolCallFase2a,
  TOOLS_FASE_2A,
} from './tool-dispatcher.js';
import { extraerToolCallEstructurado } from './structured.js';
import type {
  MensajeAgente,
  ModeloToolUse,
  ResultadoLoopAgente,
  ToolCallEstructurado,
} from './types.js';

export interface EjecutarTurnoOptions {
  readonly mensaje: MensajeAgente;
  readonly ctx: Ctx;
  readonly modelo?: ModeloToolUse;
}

export async function ejecutarTurnoAgente({
  mensaje,
  ctx,
  modelo,
}: EjecutarTurnoOptions): Promise<ResultadoLoopAgente> {
  const call = extraerToolCallEstructurado(mensaje.payload) ??
    (modelo === undefined
      ? null
      : await modelo.decidirTool({
        mensaje,
        ctx,
        toolsDisponibles: TOOLS_FASE_2A,
      }));

  if (call === null) {
    await ctx.audit({
      accion: 'agent_turn_sin_tool',
      entidad: 'inbound_message',
      antes: null,
      despues: {
        texto: mensaje.texto ?? null,
      },
    });
    return { tipo: 'sin_tool' };
  }

  return ejecutarToolCall(call, ctx);
}

async function ejecutarToolCall(
  call: ToolCallEstructurado,
  ctx: Ctx,
): Promise<ResultadoLoopAgente> {
  const resultado = await ejecutarToolCallFase2a(call, ctx);
  return {
    tipo: 'tool',
    resultado,
  };
}
