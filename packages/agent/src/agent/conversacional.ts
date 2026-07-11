/**
 * Contrato del modelo conversacional y loop de turno (docs/specs/agente-conversacional.md §A5).
 *
 * El LLM SOLO decide QUE tool llamar y QUE responder; permisos, estados y excepciones los
 * validan las tools (via el registro unico). Este modulo NO depende de `@anthropic-ai/sdk`:
 * el adapter real vive en `anthropic.ts` e implementa `ModeloConversacional`.
 */

import type { Ctx, MensajeHistorial, ResultadoTool } from '../runtime/types.js';
import { esToolFase2a } from './structured.js';
import { ejecutarToolCallFase2a } from './tool-dispatcher.js';
import { TOOLS_REGISTRY } from './registry.js';

/** Bloque de contenido de un turno del modelo (lo minimo que necesita el loop). */
export type ContenidoModelo =
  | { readonly tipo: 'texto'; readonly texto: string }
  | { readonly tipo: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly tipo: 'tool_result'; readonly toolUseId: string; readonly contenido: string; readonly esError: boolean };

export interface MensajeModelo {
  readonly rol: 'user' | 'assistant';
  readonly contenido: readonly ContenidoModelo[];
}

/** Herramienta expuesta al modelo (nombre, descripcion y JSON Schema de entrada). */
export interface HerramientaModelo {
  readonly name: string;
  readonly descripcion: string;
  readonly inputSchema: unknown;
}

/** Decision de un paso: texto final y/o un tool_use a ejecutar. */
export interface DecisionModelo {
  readonly texto: string | null;
  readonly toolUse: {
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
  } | null;
}

export interface ModeloConversacional {
  decidir(input: {
    readonly sistema: string;
    readonly mensajes: readonly MensajeModelo[];
    readonly herramientas: readonly HerramientaModelo[];
  }): Promise<DecisionModelo>;
}

/** Herramientas conversacionales expuestas al modelo, derivadas del registro unico. */
export const HERRAMIENTAS_CONVERSACIONALES: readonly HerramientaModelo[] = TOOLS_REGISTRY.map(
  (t) => ({ name: t.name, descripcion: t.descripcion, inputSchema: t.inputSchema }),
);

/** Maximo de pasos por mensaje (guarda de costo/loop — EXECUTION_PLAN §5; spec §A5). */
export const MAX_PASOS_DEFAULT = 5;

/**
 * Respuesta fija cuando se agota `maxPasos` (no la produce el modelo). Tono vos costarricense.
 */
export const RESPUESTA_MAX_PASOS =
  'Perdon, no logre resolver tu solicitud en este momento. ¿Me la reformulas o la intentas de nuevo en un rato?';

export interface EjecutarTurnoConversacionalOptions {
  readonly modelo: ModeloConversacional;
  readonly ctx: Ctx;
  readonly promptSistema: string;
  /** Historial de la conversacion ANTES del mensaje actual (ConversacionRepo A4). */
  readonly historial: readonly MensajeHistorial[];
  /** Texto del mensaje que se esta procesando. */
  readonly mensajeUsuario: string;
  readonly maxPasos?: number;
}

export interface ToolEjecutada {
  readonly name: string;
  readonly ok: boolean;
}

export interface ResultadoTurnoConversacional {
  /** Texto final para el usuario (el engine del worker lo encola; aca NO se envia). */
  readonly respuesta: string | null;
  readonly toolsEjecutadas: readonly ToolEjecutada[];
}

/**
 * Mapea el historial A4 a turnos del modelo. `entrante` -> user, `saliente` -> assistant.
 * Descarta salientes iniciales para que la primera fila sea siempre `user` (el API rechaza un
 * historial que arranca en `assistant`); las tools/API ya toleran turnos consecutivos del
 * mismo rol.
 */
function historialAMensajes(historial: readonly MensajeHistorial[]): MensajeModelo[] {
  let inicio = 0;
  while (inicio < historial.length && historial[inicio]?.direccion === 'saliente') {
    inicio += 1;
  }
  return historial.slice(inicio).map((m) => ({
    rol: m.direccion === 'entrante' ? ('user' as const) : ('assistant' as const),
    contenido: [{ tipo: 'texto' as const, texto: m.texto }],
  }));
}

function serializarResultado(resultado: ResultadoTool<unknown>): string {
  return resultado.ok
    ? JSON.stringify({ ok: true, value: resultado.value })
    : JSON.stringify({ ok: false, error: resultado.error });
}

/**
 * Loop de un turno conversacional (spec §A5):
 *   1. Llama al modelo con historial + mensaje + herramientas.
 *   2. Si devuelve `toolUse`: ejecuta via el registro (validacion completa en la tool),
 *      agrega el `tool_result` (ok o error explicable, serializado JSON) al historial del turno
 *      y vuelve a llamar.
 *   3. Si devuelve texto sin tool: ese es el texto final.
 *   4. Si se agota `maxPasos` (todo el tiempo pidiendo tools): respuesta fija de disculpa +
 *      `audit_event('agente_max_pasos')`.
 *
 * El texto final NO se encola aca: lo hace el engine del worker (destino = telefono del actor).
 */
export async function ejecutarTurnoConversacional(
  opciones: EjecutarTurnoConversacionalOptions,
): Promise<ResultadoTurnoConversacional> {
  const { modelo, ctx, promptSistema, historial, mensajeUsuario } = opciones;
  const maxPasos = opciones.maxPasos ?? MAX_PASOS_DEFAULT;

  let mensajes: MensajeModelo[] = [
    ...historialAMensajes(historial),
    { rol: 'user', contenido: [{ tipo: 'texto', texto: mensajeUsuario }] },
  ];
  const toolsEjecutadas: ToolEjecutada[] = [];

  for (let paso = 0; paso < maxPasos; paso += 1) {
    const decision = await modelo.decidir({
      sistema: promptSistema,
      mensajes,
      herramientas: HERRAMIENTAS_CONVERSACIONALES,
    });

    if (decision.toolUse === null) {
      // Texto final (puede ser null: el engine del worker resuelve el fallback de alcance E8).
      return { respuesta: decision.texto, toolsEjecutadas };
    }

    const toolUse = decision.toolUse;

    // Turno del asistente: texto opcional + el tool_use pedido.
    const contenidoAsistente: ContenidoModelo[] = [];
    if (decision.texto !== null && decision.texto.trim() !== '') {
      contenidoAsistente.push({ tipo: 'texto', texto: decision.texto });
    }
    contenidoAsistente.push({ tipo: 'tool_use', id: toolUse.id, name: toolUse.name, input: toolUse.input });
    mensajes = [...mensajes, { rol: 'assistant', contenido: contenidoAsistente }];

    // Ejecuta via el registro (o error explicable si el nombre no esta whitelisteado).
    let ok: boolean;
    let serializado: string;
    if (esToolFase2a(toolUse.name)) {
      const resultado = await ejecutarToolCallFase2a({ name: toolUse.name, input: toolUse.input }, ctx);
      ok = resultado.ok;
      serializado = resultado.ok
        ? serializarResultado({ ok: true, value: resultado.value })
        : serializarResultado({ ok: false, error: resultado.error });
    } else {
      ok = false;
      serializado = JSON.stringify({
        ok: false,
        error: { codigo: 'validacion', mensaje: `Herramienta desconocida: ${toolUse.name}.` },
      });
    }
    toolsEjecutadas.push({ name: toolUse.name, ok });

    mensajes = [
      ...mensajes,
      {
        rol: 'user',
        contenido: [{ tipo: 'tool_result', toolUseId: toolUse.id, contenido: serializado, esError: !ok }],
      },
    ];
  }

  await ctx.audit({
    accion: 'agente_max_pasos',
    entidad: 'inbound_message',
    antes: null,
    despues: { max_pasos: maxPasos, tools_ejecutadas: toolsEjecutadas },
  });

  return { respuesta: RESPUESTA_MAX_PASOS, toolsEjecutadas };
}

// `serializarResultado` queda disponible para reutilizacion futura (extractores A6) sin duplicar
// el formato del `tool_result`; el loop usa la version inline por claridad de tipos.
export { serializarResultado };
