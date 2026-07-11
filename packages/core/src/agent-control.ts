/**
 * Predicado de pausa del agente (dominio puro).
 *
 * FUENTE DE VERDAD: docs/specs/control-center.md §"Pausa del agente" (tabla `agent_control`,
 * migracion 008): filas `(alcance: global | telefono | pedido, referencia, pausado_por,
 * motivo, pausado_at, reanudado_at)`. "El worker consulta la pausa vigente ANTES de delegar
 * al engine: mensaje entrante bajo pausa se persiste y notifica a Proveeduria, no ejecuta
 * tools. El predicado es determinista (core/worker), jamas del LLM."
 *
 * VIGENCIA: esta funcion NO filtra por `reanudado_at`. Asume que `pausasVigentes` ya llega
 * filtrado por el caller (SQL: `WHERE reanudado_at IS NULL`); aqui solo se decide si alguna
 * de esas pausas ya-vigentes aplica al contexto del mensaje/accion entrante.
 */

export type AlcancePausa = 'global' | 'telefono' | 'pedido';

/** Una fila de `agent_control` ya filtrada como vigente por el caller (ver docstring). */
export interface PausaVigente {
  readonly alcance: AlcancePausa;
  readonly referencia: string | null;
}

/** Contexto del mensaje/accion entrante contra el que se evalua la pausa. */
export interface ContextoPausa {
  readonly telefono?: string;
  readonly pedidoId?: string;
}

/**
 * `true` si alguna pausa vigente aplica al contexto dado:
 * - alcance `'global'`: aplica siempre (su `referencia` no se usa para decidir).
 * - alcance `'telefono'`: aplica si `referencia === contexto.telefono`.
 * - alcance `'pedido'`: aplica si `referencia === contexto.pedidoId`.
 *
 * Si el contexto no trae `telefono`/`pedidoId`, una pausa de ese alcance nunca aplica (no hay
 * nada contra que comparar). `referencia === null` tampoco aplica salvo que el contexto
 * tambien fuera `null`/`undefined` — lo cual esta cubierto por la regla anterior.
 */
export function pausaAplicable(
  pausasVigentes: readonly PausaVigente[],
  contexto: ContextoPausa,
): boolean {
  return pausasVigentes.some((pausa) => {
    if (pausa.alcance === 'global') return true;
    if (pausa.alcance === 'telefono') {
      return contexto.telefono !== undefined && pausa.referencia === contexto.telefono;
    }
    return contexto.pedidoId !== undefined && pausa.referencia === contexto.pedidoId;
  });
}
