import { err, ok, puedeTransicionar, puedeUsarTool } from '@proveeduria/core';
import type {
  ComparativoCotizacionFila,
  Ctx,
  ErrorTool,
  PedidoItem,
  ResultadoTool,
} from '../runtime/types.js';
import { canalAprobacionDesdeCtx, resumirProveedores } from './pedido.js';
import type { ComparativoProveedorResumen } from './pedido.js';

export interface AsignacionGanadorInput {
  readonly supplierId: string;
  readonly pedidoItemIds: readonly string[];
}

export interface AprobarGanadorInput {
  readonly pedidoId: string;
  readonly asignaciones: readonly AsignacionGanadorInput[];
}

/**
 * Forma normativa de una asignacion dentro de `approval_events.detalle` (tools.md
 * §Adjudicacion y OC, "Forma normativa de detalle"): fija el `quoteResponseId` (la ultima
 * quote_response completa del proveedor, la misma que uso el comparativo) del que
 * `emitir_oc` copiara los precios unitarios a `po_items`.
 */
export interface AsignacionGanadorDetalle {
  readonly supplierId: string;
  readonly pedidoItemIds: readonly string[];
  readonly quoteResponseId: string;
}

/** Snapshot inmutable del comparativo "que vio el aprobador" (tools.md, evidencia de adjudicacion). */
export interface ComparativoSnapshot {
  readonly pedidoId: string;
  readonly numero: string;
  readonly filas: readonly ComparativoCotizacionFila[];
  readonly resumenProveedores: readonly ComparativoProveedorResumen[];
}

export interface ResumenGanadorAprobado {
  readonly pedidoId: string;
  readonly numero: string;
  readonly estado: 'aprobado';
  readonly asignaciones: readonly AsignacionGanadorDetalle[];
  readonly comparativo: ComparativoSnapshot;
}

const errorRol: ErrorTool = {
  codigo: 'rol_insuficiente',
  mensaje: 'No tenes permiso para usar esta herramienta.',
};

function validationError(mensaje: string): ErrorTool {
  return { codigo: 'validacion', mensaje };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseAsignacionGanadorInput(
  value: unknown,
  index: number,
): ResultadoTool<AsignacionGanadorInput> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['supplierId', 'pedidoItemIds'])) {
    return err(validationError(`La asignacion ${index + 1} tiene campos invalidos.`));
  }
  if (typeof value.supplierId !== 'string' || value.supplierId.trim() === '') {
    return err(validationError(`La asignacion ${index + 1} necesita un supplierId valido.`));
  }
  if (!Array.isArray(value.pedidoItemIds) || value.pedidoItemIds.length === 0) {
    return err(validationError(
      `La asignacion ${index + 1} debe incluir al menos un pedidoItemId.`,
    ));
  }

  const pedidoItemIds: string[] = [];
  for (const [itemIndex, itemId] of value.pedidoItemIds.entries()) {
    if (typeof itemId !== 'string' || itemId.trim() === '') {
      return err(validationError(
        `El pedidoItemId ${itemIndex + 1} de la asignacion ${index + 1} es invalido.`,
      ));
    }
    pedidoItemIds.push(itemId.trim());
  }
  if (new Set(pedidoItemIds).size !== pedidoItemIds.length) {
    return err(validationError(
      `La asignacion ${index + 1} repite un pedidoItemId dentro de si misma.`,
    ));
  }

  return ok({ supplierId: value.supplierId.trim(), pedidoItemIds });
}

function parseAprobarGanadorInput(input: unknown): ResultadoTool<AprobarGanadorInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pedidoId', 'asignaciones'])) {
    return err(validationError('El input de aprobar_ganador tiene campos invalidos.'));
  }
  if (typeof input.pedidoId !== 'string' || input.pedidoId.trim() === '') {
    return err(validationError('Indicame un pedidoId valido para aprobar el ganador.'));
  }
  if (!Array.isArray(input.asignaciones) || input.asignaciones.length === 0) {
    return err(validationError('Debes indicar al menos una asignacion de proveedor.'));
  }

  const asignaciones: AsignacionGanadorInput[] = [];
  for (const [index, value] of input.asignaciones.entries()) {
    const parsedAsignacion = parseAsignacionGanadorInput(value, index);
    if (!parsedAsignacion.ok) return parsedAsignacion;
    asignaciones.push(parsedAsignacion.value);
  }

  const supplierIds = asignaciones.map((asignacion) => asignacion.supplierId);
  if (new Set(supplierIds).size !== supplierIds.length) {
    return err(validationError('Un proveedor no puede tener mas de una asignacion.'));
  }

  const todosLosItemIds = asignaciones.flatMap((asignacion) => asignacion.pedidoItemIds);
  if (new Set(todosLosItemIds).size !== todosLosItemIds.length) {
    return err(validationError('Un item no puede asignarse a mas de un proveedor.'));
  }

  return ok({ pedidoId: input.pedidoId.trim(), asignaciones });
}

export async function aprobarGanador(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenGanadorAprobado>> {
  if (!puedeUsarTool('aprobar_ganador', ctx.actor.roles)) return err(errorRol);

  const parsed = parseAprobarGanadorInput(input);
  if (!parsed.ok) return parsed;

  const pedido = await ctx.repos.pedidos.bloquearPorId(parsed.value.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre ese pedido para aprobar ganador.',
    });
  }

  const transicion = puedeTransicionar(pedido.estado, 'aprobado');
  if (!transicion.ok) return err(transicion.error);

  const items = await ctx.repos.pedidoItems.porPedido(pedido.id);
  if (items.length === 0) {
    return err(validationError('El pedido no tiene items para adjudicar.'));
  }
  const itemsPorId = new Map<string, PedidoItem>(items.map((item) => [item.id, item]));

  // Cobertura exacta: cada item del pedido asignado exactamente una vez (tools.md
  // aprobar_ganador guard). Duplicados dentro/entre asignaciones ya los rechazo el parser;
  // aqui valido pertenencia al pedido y que no quede ningun item sin asignar.
  const itemsAsignados = new Set<string>();
  for (const asignacion of parsed.value.asignaciones) {
    for (const pedidoItemId of asignacion.pedidoItemIds) {
      if (!itemsPorId.has(pedidoItemId)) {
        return err(validationError(`El item ${pedidoItemId} no pertenece al pedido.`));
      }
      itemsAsignados.add(pedidoItemId);
    }
  }
  const sinAsignar = items.filter((item) => !itemsAsignados.has(item.id));
  if (sinAsignar.length > 0) {
    return err(validationError(
      `Faltan items por asignar: ${sinAsignar.map((item) => item.descripcion).join(', ')}.`,
    ));
  }

  // Comparativo determinista: mismo repo que usa generar_comparativo (comparativos.porPedido)
  // + el mismo agregado por proveedor (resumirProveedores, reutilizado de pedido.ts). No se
  // reimplementa el SQL/calculo aqui (tools.md aprobar_ganador).
  const filas = await ctx.repos.comparativos.porPedido(pedido.id);
  if (filas.length === 0) {
    return err(validationError('El pedido no tiene cotizaciones registradas para adjudicar.'));
  }
  const resumenProveedores = resumirProveedores(filas);
  const nombrePorSupplier = new Map(
    resumenProveedores.map((resumen) => [resumen.supplierId, resumen.nombre]),
  );

  const asignacionesConQuote: AsignacionGanadorDetalle[] = [];
  for (const asignacion of parsed.value.asignaciones) {
    const filasProveedor = filas.filter((fila) => fila.supplierId === asignacion.supplierId);
    const nombreProveedor = nombrePorSupplier.get(asignacion.supplierId) ?? asignacion.supplierId;

    if (filasProveedor.length === 0) {
      return err(validationError(
        `El proveedor ${nombreProveedor} no tiene solicitud de cotizacion para este pedido.`,
      ));
    }

    // Todas las filas de un mismo proveedor comparten la misma ultima quote_response
    // completa (una RFQ por proveedor y pedido, tools.md enviar_rfq); si no hay respuesta
    // completa, el comparativo la deja en null para todas.
    const quoteResponseId = filasProveedor[0]?.quoteResponseId ?? null;
    if (quoteResponseId === null) {
      return err(validationError(
        `El proveedor ${nombreProveedor} no tiene una cotizacion completa registrada para este pedido.`,
      ));
    }

    for (const pedidoItemId of asignacion.pedidoItemIds) {
      const fila = filasProveedor.find((f) => f.pedidoItemId === pedidoItemId);
      if (fila === undefined || fila.precioUnitario === null || fila.cantidadCotizada === null) {
        const item = itemsPorId.get(pedidoItemId);
        return err(validationError(
          `El proveedor ${nombreProveedor} no cotizo el item ${item?.descripcion ?? pedidoItemId}.`,
        ));
      }
    }

    asignacionesConQuote.push({
      supplierId: asignacion.supplierId,
      pedidoItemIds: asignacion.pedidoItemIds,
      quoteResponseId,
    });
  }

  const comparativo: ComparativoSnapshot = {
    pedidoId: pedido.id,
    numero: pedido.numero,
    filas,
    resumenProveedores,
  };

  // Forma normativa de tools.md §Adjudicacion y OC ("Forma normativa de detalle"): la lee
  // emitir_oc para fijar proveedores, items y precios (via quoteResponseId) de forma
  // deterministica, sin volver a preguntarle nada al LLM.
  await ctx.approval({
    tipo: 'ganador',
    pedidoId: pedido.id,
    canal: canalAprobacionDesdeCtx(ctx),
    detalle: {
      asignaciones: asignacionesConQuote,
      comparativo,
    },
  });

  const actualizado = await ctx.repos.pedidos.marcarAprobado(pedido.id);

  await ctx.audit({
    accion: 'aprobar_ganador',
    entidad: 'pedido',
    entidadId: pedido.id,
    pedidoId: pedido.id,
    antes: pedido,
    despues: {
      pedido: actualizado,
      asignaciones: asignacionesConQuote,
    },
  });

  return ok({
    pedidoId: actualizado.id,
    numero: actualizado.numero,
    estado: 'aprobado',
    asignaciones: asignacionesConQuote,
    comparativo,
  });
}
