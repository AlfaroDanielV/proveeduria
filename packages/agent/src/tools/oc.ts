import { createHash } from 'node:crypto';

import { err, ok, puedeTransicionar, puedeUsarTool } from '@proveeduria/core';
import type {
  Ctx,
  ErrorTool,
  OcItemInput,
  Proveedor,
  QuoteItem,
  QuoteResponse,
  ResultadoTool,
} from '../runtime/types.js';
import type { DatosPdfOcItem } from '../pdf/oc-pdf.js';
import { generarPdfOc } from '../pdf/oc-pdf.js';
import { canalAprobacionDesdeCtx, formatCRC } from './pedido.js';

export interface EmitirOcInput {
  readonly pedidoId: string;
}

export interface OcEmitidaResumen {
  readonly ocId: string;
  readonly numero: string;
  readonly supplierId: string;
  readonly supplierNombre: string;
  readonly montoTotal: number;
  readonly attachmentId: string;
}

export interface ResumenOcEmitida {
  readonly pedidoId: string;
  readonly numero: string;
  readonly estado: 'ordenado';
  readonly ocs: readonly OcEmitidaResumen[];
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

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseEmitirOcInput(input: unknown): ResultadoTool<EmitirOcInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pedidoId'])) {
    return err(validationError('El input de emitir_oc tiene campos invalidos.'));
  }
  if (typeof input.pedidoId !== 'string' || input.pedidoId.trim() === '') {
    return err(validationError('Indicame un pedidoId valido para emitir la OC.'));
  }
  return ok({ pedidoId: input.pedidoId.trim() });
}

/** Asignacion ya resuelta contra quote_items/pedido_items: todo lo que hace falta para crear
 * la OC + su PDF, calculado ANTES de escribir nada (guard "no OC parcial silenciosa"). */
interface AsignacionResuelta {
  readonly supplierId: string;
  readonly proveedor: Proveedor;
  readonly quoteResponse: QuoteResponse;
  readonly ocItems: readonly OcItemInput[];
  readonly pdfItems: readonly DatosPdfOcItem[];
  readonly montoTotal: number;
}

export async function emitirOc(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenOcEmitida>> {
  if (!puedeUsarTool('emitir_oc', ctx.actor.roles)) return err(errorRol);

  const parsed = parseEmitirOcInput(input);
  if (!parsed.ok) return parsed;

  const pedido = await ctx.repos.pedidos.bloquearPorId(parsed.value.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre ese pedido para emitir la OC.',
    });
  }

  // Guard duro de estado (state-machine.md): solo aprobado -> ordenado. Cubre a la vez el
  // caso "pedido no aprobado" del contrato de la tool (E12).
  const transicion = puedeTransicionar(pedido.estado, 'ordenado');
  if (!transicion.ok) return err(transicion.error);

  // Fuente de datos (tools.md emitir_oc): la ULTIMA approval_events(tipo='ganador') del
  // pedido. Sin ella, nunca se emite una OC "de memoria".
  const aprobacion = await ctx.repos.approvals.ultimoGanadorPorPedido(pedido.id);
  if (aprobacion === null) {
    return err(validationError(
      `El pedido ${pedido.numero} no tiene adjudicacion registrada; no se puede emitir la OC.`,
    ));
  }

  const proyecto = await ctx.repos.proyectos.porId(pedido.projectId);
  if (proyecto === null) {
    return err(validationError('El proyecto del pedido ya no existe.'));
  }

  const items = await ctx.repos.pedidoItems.porPedido(pedido.id);
  const itemsPorId = new Map(items.map((item) => [item.id, item]));

  // Guard: TODOS los proveedores adjudicados deben tener contacto opt-in ANTES de escribir
  // nada (tools.md emitir_oc / instrucciones de esta tarea).
  const supplierIds = aprobacion.asignaciones.map((asignacion) => asignacion.supplierId);
  const proveedores = await ctx.repos.proveedores.porIdsConContactoOptIn(supplierIds);
  const proveedorPorId = new Map(proveedores.map((proveedor) => [proveedor.id, proveedor]));
  const sinContactoOptIn = supplierIds.filter((supplierId) => !proveedorPorId.has(supplierId));
  if (sinContactoOptIn.length > 0) {
    return err(validationError(
      `No se puede emitir la OC: proveedor(es) sin contacto opt-in activo: ${sinContactoOptIn.join(', ')}.`,
    ));
  }

  // Resuelve precios/cantidades/PDF de CADA asignacion desde los quote_items del
  // quoteResponseId fijado por aprobar_ganador (tools.md "los precios unitarios de po_items
  // se copian de los quote_items de esa respuesta"). Si falta un item cotizado: error, sin
  // escribir nada (no OC parcial silenciosa).
  const resueltas: AsignacionResuelta[] = [];
  for (const asignacion of aprobacion.asignaciones) {
    const proveedor = proveedorPorId.get(asignacion.supplierId);
    if (proveedor === undefined) {
      // Inalcanzable: ya cubierto por el guard de opt-in de arriba.
      return err(validationError(
        `Proveedor ${asignacion.supplierId} sin contacto opt-in; no se puede emitir la OC.`,
      ));
    }

    const quoteResponse = await ctx.repos.quoteResponses.porId(asignacion.quoteResponseId);
    if (quoteResponse === null) {
      return err(validationError(
        `La cotizacion ganadora del proveedor ${proveedor.nombre} ya no existe; no se puede emitir la OC.`,
      ));
    }

    const quoteItems = await ctx.repos.quoteResponses.itemsPorQuoteResponse(asignacion.quoteResponseId);
    const quoteItemPorPedidoItem = new Map<string, QuoteItem>();
    for (const quoteItem of quoteItems) {
      if (quoteItem.pedidoItemId !== null) quoteItemPorPedidoItem.set(quoteItem.pedidoItemId, quoteItem);
    }

    const ocItems: OcItemInput[] = [];
    const pdfItems: DatosPdfOcItem[] = [];
    let montoTotal = 0;
    for (const pedidoItemId of asignacion.pedidoItemIds) {
      const pedidoItem = itemsPorId.get(pedidoItemId);
      const quoteItem = quoteItemPorPedidoItem.get(pedidoItemId);
      if (
        pedidoItem === undefined ||
        quoteItem === undefined ||
        quoteItem.precioUnitario === null ||
        quoteItem.cantidad === null
      ) {
        return err(validationError(
          `El proveedor ${proveedor.nombre} no tiene precio/cantidad cotizados para el item ` +
            `"${pedidoItem?.descripcion ?? pedidoItemId}"; no se puede emitir la OC.`,
        ));
      }

      const subtotal = quoteItem.precioUnitario * quoteItem.cantidad;
      montoTotal += subtotal;
      ocItems.push({
        pedidoItemId,
        cantidad: quoteItem.cantidad,
        precioUnitario: quoteItem.precioUnitario,
      });
      pdfItems.push({
        descripcion: pedidoItem.descripcion,
        cantidad: quoteItem.cantidad,
        unidad: pedidoItem.unidad,
        precioUnitario: quoteItem.precioUnitario,
        subtotal,
      });
    }

    resueltas.push({
      supplierId: asignacion.supplierId,
      proveedor,
      quoteResponse,
      ocItems,
      pdfItems,
      montoTotal,
    });
  }

  // Todas las validaciones pasaron: de aqui en adelante se escribe (misma Tx del Ctx;
  // rollback total si cualquier OC falla a mitad de camino).
  const ocsEmitidas: OcEmitidaResumen[] = [];
  for (const resuelta of resueltas) {
    const numero = await ctx.repos.ocs.siguienteNumeroOc(ctx.ahora);
    const { oc } = await ctx.repos.ocs.crear({
      numero,
      pedidoId: pedido.id,
      supplierId: resuelta.supplierId,
      montoTotal: resuelta.montoTotal,
      items: resuelta.ocItems,
    });

    const pdfBytes = await generarPdfOc({
      numeroOc: oc.numero,
      fecha: ctx.ahora,
      numeroPedido: pedido.numero,
      proyecto: { nombre: proyecto.nombre, codigo: proyecto.codigo },
      proveedor: {
        nombre: resuelta.proveedor.nombre,
        cedulaJuridica: resuelta.proveedor.cedulaJuridica ?? null,
      },
      items: resuelta.pdfItems,
      montoTotal: resuelta.montoTotal,
      condiciones: resuelta.quoteResponse.condiciones,
      plazoEntrega: resuelta.quoteResponse.plazoEntrega,
    });
    const sha256 = createHash('sha256').update(pdfBytes).digest('hex');

    const attachment = await ctx.repos.attachments.crearConBytes({
      contentType: 'application/pdf',
      sha256,
      origen: null,
      bytes: pdfBytes,
    });
    await ctx.repos.ocs.fijarPdfAttachment(oc.id, attachment.id);

    const contacto = resuelta.proveedor.contactoPrincipal;
    if (contacto === null) {
      // Invariante imposible: el guard de opt-in de arriba ya lo garantiza.
      throw new Error(
        `Proveedor ${resuelta.proveedor.id} sin contacto opt-in al emitir la OC (guard previo deberia haberlo evitado).`,
      );
    }

    await ctx.outbox({
      destino: contacto.telefonoWhatsapp,
      template: 'oc_emitida',
      payload: {
        variables: [
          contacto.nombre ?? resuelta.proveedor.nombre,
          oc.numero,
          proyecto.nombre,
          formatCRC(oc.montoTotal),
        ],
        pedido_id: pedido.id,
        oc_id: oc.id,
        documento_nombre: `${oc.numero}.pdf`,
      },
      attachmentId: attachment.id,
    });

    ocsEmitidas.push({
      ocId: oc.id,
      numero: oc.numero,
      supplierId: oc.supplierId,
      supplierNombre: resuelta.proveedor.nombre,
      montoTotal: oc.montoTotal,
      attachmentId: attachment.id,
    });
  }

  await ctx.approval({
    tipo: 'emision_oc',
    pedidoId: pedido.id,
    canal: canalAprobacionDesdeCtx(ctx),
    detalle: {
      ocs: ocsEmitidas.map((oc) => ({
        ocId: oc.ocId,
        numero: oc.numero,
        supplierId: oc.supplierId,
        montoTotal: oc.montoTotal,
      })),
    },
  });

  const actualizado = await ctx.repos.pedidos.marcarOrdenado(pedido.id);

  await ctx.audit({
    accion: 'emitir_oc',
    entidad: 'pedido',
    entidadId: pedido.id,
    pedidoId: pedido.id,
    antes: pedido,
    despues: {
      pedido: actualizado,
      ocs: ocsEmitidas,
    },
  });

  return ok({
    pedidoId: actualizado.id,
    numero: actualizado.numero,
    estado: 'ordenado',
    ocs: ocsEmitidas,
  });
}
