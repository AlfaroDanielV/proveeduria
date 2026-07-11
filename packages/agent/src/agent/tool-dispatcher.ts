import type { Ctx, ResultadoTool } from '../runtime/types.js';
import { TOOLS_REGISTRY } from './registry.js';
import type { RegistroTool } from './registry.js';
import type { ResultadoToolCall, ToolCallEstructurado, ToolFase2a } from './types.js';

/**
 * Lista de nombres whitelisteados, derivada del registro unico (registry.ts). Antes se
 * mantenia a mano aca ademas de en `types.ts` y `structured.ts`; ahora hay una sola fuente
 * (agente-conversacional.md §A5).
 */
export const TOOLS_FASE_2A: readonly ToolFase2a[] = TOOLS_REGISTRY.map((t) => t.name);

/** Indice nombre -> entrada del registro, para despachar en O(1) sin `switch` duplicado. */
const REGISTRO_POR_NOMBRE: ReadonlyMap<ToolFase2a, RegistroTool> = new Map(
  TOOLS_REGISTRY.map((t): readonly [ToolFase2a, RegistroTool] => [t.name, t]),
);

export async function ejecutarToolFase2a(
  call: ToolCallEstructurado,
  ctx: Ctx,
): Promise<ResultadoTool<unknown>> {
  const tool = REGISTRO_POR_NOMBRE.get(call.name);
  if (tool === undefined) {
    // Inalcanzable: `call.name` es `ToolFase2a` y el registro cubre todos los nombres.
    // Defensivo por si el tipo se relaja en el futuro.
    throw new Error(`Tool no registrada en TOOLS_REGISTRY: ${String(call.name)}.`);
  }
  return tool.ejecutar(ctx, call.input);
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
