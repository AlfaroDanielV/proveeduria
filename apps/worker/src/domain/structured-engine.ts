import {
  confirmarPedido,
  crearPedido,
  enviarRfq,
  generarComparativo,
  registrarCotizacion,
  sugerirProveedores,
} from '@proveeduria/agent';
import type { ErrorTool, ResultadoTool } from '@proveeduria/agent';
import type { DomainEngine, DomainEngineInput } from './types.js';

type StructuredToolName =
  | 'crear_pedido'
  | 'confirmar_pedido'
  | 'sugerir_proveedores'
  | 'enviar_rfq'
  | 'registrar_cotizacion'
  | 'generar_comparativo';

interface StructuredToolCall {
  readonly name: StructuredToolName;
  readonly input: unknown;
}

interface ToolResultPayload {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: ErrorTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseToolCall(payload: unknown): StructuredToolCall | null {
  if (!isRecord(payload)) return null;
  const raw = isRecord(payload.tool_call)
    ? payload.tool_call
    : isRecord(payload.toolCall)
      ? payload.toolCall
      : null;
  if (raw === null || typeof raw.name !== 'string') return null;
  if (!isStructuredToolName(raw.name)) return null;
  return {
    name: raw.name,
    input: raw.input,
  };
}

function isStructuredToolName(name: string): name is StructuredToolName {
  return (
    name === 'crear_pedido' ||
    name === 'confirmar_pedido' ||
    name === 'sugerir_proveedores' ||
    name === 'enviar_rfq' ||
    name === 'registrar_cotizacion' ||
    name === 'generar_comparativo'
  );
}

function resultPayload<T>(result: ResultadoTool<T>): ToolResultPayload {
  if (result.ok) {
    return { ok: true, value: result.value };
  }
  return { ok: false, error: result.error };
}

async function ejecutarTool(
  call: StructuredToolCall,
  input: DomainEngineInput,
): Promise<ToolResultPayload> {
  if (input.ctx === undefined) {
    return {
      ok: false,
      error: {
        codigo: 'rol_insuficiente',
        mensaje: 'Solo remitentes internos pueden ejecutar tools estructuradas en este bloque.',
      },
    };
  }

  switch (call.name) {
    case 'crear_pedido':
      return resultPayload(await crearPedido(call.input, input.ctx));
    case 'confirmar_pedido':
      return resultPayload(await confirmarPedido(call.input, input.ctx));
    case 'sugerir_proveedores':
      return resultPayload(await sugerirProveedores(call.input, input.ctx));
    case 'enviar_rfq':
      return resultPayload(await enviarRfq(call.input, input.ctx));
    case 'registrar_cotizacion':
      return resultPayload(await registrarCotizacion(call.input, input.ctx));
    case 'generar_comparativo':
      return resultPayload(await generarComparativo(call.input, input.ctx));
  }
}

export function crearStructuredToolEngine(): DomainEngine {
  return {
    async procesar(input: DomainEngineInput): Promise<void> {
      const call = parseToolCall(input.mensaje.payload);
      if (call === null) {
        await input.tx.query(
          'INSERT INTO audit_events ' +
            '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
            'VALUES ($1, $2, $3, $4, $5, null, null, $6::jsonb, $7, $8)',
          [
            input.ctx?.actor.userId ?? null,
            input.ctx === undefined,
            'worker_mensaje_sin_tool_call',
            'inbound_message',
            input.mensaje.id,
            JSON.stringify({
              wamid: input.mensaje.wamid,
              remitente: input.contexto.tipo,
            }),
            'wamid',
            input.ahora,
          ],
        );
        return;
      }

      const resultado = await ejecutarTool(call, input);
      await input.tx.query(
        'INSERT INTO audit_events ' +
          '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
          'VALUES ($1, $2, $3, $4, $5, null, null, $6::jsonb, $7, $8)',
        [
          input.ctx?.actor.userId ?? null,
          input.ctx === undefined,
          'worker_tool_call',
          'inbound_message',
          input.mensaje.id,
          JSON.stringify({
            wamid: input.mensaje.wamid,
            tool: call.name,
            resultado,
          }),
          'wamid',
          input.ahora,
        ],
      );

      if (!resultado.ok) {
        await input.tx.query(
          'INSERT INTO outbox_messages (destino, texto, payload) VALUES ($1, $2, $3::jsonb)',
          [
            input.mensaje.fromPhone,
            resultado.error?.mensaje ?? 'No pude procesar esa solicitud.',
            JSON.stringify({
              wamid: input.mensaje.wamid,
              tool: call.name,
              error: resultado.error ?? null,
            }),
          ],
        );
      }
    },
  };
}
