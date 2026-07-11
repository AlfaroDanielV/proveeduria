import {
  ejecutarToolCallFase2a,
  extraerToolCallEstructurado,
} from '@proveeduria/agent';
import type { ErrorTool, ResultadoToolCall } from '@proveeduria/agent';
import type { DomainEngine, DomainEngineInput } from './types.js';

interface ToolResultPayload {
  readonly ok: boolean;
  readonly tool?: string;
  readonly value?: unknown;
  readonly error?: ErrorTool;
}

function resultPayload(result: ResultadoToolCall): ToolResultPayload {
  if (result.ok) {
    return { ok: true, tool: result.tool, value: result.value };
  }
  return { ok: false, tool: result.tool, error: result.error };
}

/**
 * Extrae `pedidoId` del input de la tool si viene como string no vacio, para poblar
 * `audit_events.pedido_id`. Tools como `crear_pedido` (que aun no tienen pedido) devuelven
 * `null` y la fila se audita sin pedido asociado.
 */
function extraerPedidoIdDeInput(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const rec = input as Record<string, unknown>;
  return typeof rec.pedidoId === 'string' && rec.pedidoId.trim() !== '' ? rec.pedidoId : null;
}

export function crearStructuredToolEngine(): DomainEngine {
  return {
    async procesar(input: DomainEngineInput): Promise<void> {
      const call = extraerToolCallEstructurado(input.mensaje.payload);
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

      const resultado = input.ctx === undefined
        ? {
          ok: false,
          tool: call.name,
          error: {
            codigo: 'rol_insuficiente',
            mensaje: 'Solo remitentes internos pueden ejecutar tools estructuradas en este bloque.',
          },
        } satisfies ToolResultPayload
        : resultPayload(await ejecutarToolCallFase2a(call, input.ctx));
      const pedidoId = extraerPedidoIdDeInput(call.input);
      await input.tx.query(
        'INSERT INTO audit_events ' +
          '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
          'VALUES ($1, $2, $3, $4, $5, $6, null, $7::jsonb, $8, $9)',
        [
          input.ctx?.actor.userId ?? null,
          input.ctx === undefined,
          'worker_tool_call',
          'inbound_message',
          input.mensaje.id,
          pedidoId,
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
