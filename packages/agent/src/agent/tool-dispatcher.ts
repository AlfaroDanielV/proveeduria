import type { ResultadoTool } from '../runtime/types.js';
import {
  confirmarPedido,
  crearPedido,
  enviarRfq,
  generarComparativo,
  registrarCotizacion,
  sugerirProveedores,
} from '../tools/pedido.js';
import type { Ctx } from '../runtime/types.js';
import type { ResultadoToolCall, ToolCallEstructurado, ToolFase2a } from './types.js';

export const TOOLS_FASE_2A: readonly ToolFase2a[] = [
  'crear_pedido',
  'confirmar_pedido',
  'sugerir_proveedores',
  'enviar_rfq',
  'registrar_cotizacion',
  'generar_comparativo',
] as const;

export async function ejecutarToolFase2a(
  call: ToolCallEstructurado,
  ctx: Ctx,
): Promise<ResultadoTool<unknown>> {
  switch (call.name) {
    case 'crear_pedido':
      return crearPedido(call.input, ctx);
    case 'confirmar_pedido':
      return confirmarPedido(call.input, ctx);
    case 'sugerir_proveedores':
      return sugerirProveedores(call.input, ctx);
    case 'enviar_rfq':
      return enviarRfq(call.input, ctx);
    case 'registrar_cotizacion':
      return registrarCotizacion(call.input, ctx);
    case 'generar_comparativo':
      return generarComparativo(call.input, ctx);
  }
}

export async function ejecutarToolCallFase2a(
  call: ToolCallEstructurado,
  ctx: Ctx,
): Promise<ResultadoToolCall> {
  const result = await ejecutarToolFase2a(call, ctx);
  if (result.ok) {
    return {
      ok: true,
      tool: call.name,
      value: result.value,
    };
  }
  return {
    ok: false,
    tool: call.name,
    error: result.error,
  };
}
