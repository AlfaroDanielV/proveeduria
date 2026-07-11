import type { Ctx, QuoteRequest } from '../runtime/types.js';
import { notificarAdmins, transicionarAEnRevisionConComparativo } from './pedido.js';

export interface ResultadoVencimientos {
  /** RFQs `enviada` con `plazo_at <= ahora` que pasaron a `vencida`. */
  readonly vencidas: number;
  /** Pedidos que, sin RFQs `enviada` restantes, transicionaron `cotizando -> en_revision`. */
  readonly pedidosTransicionados: number;
}

/**
 * Cron E1 (spec agente-conversacional.md §A7; exceptions.md): vencimiento de plazos de
 * cotizacion.
 *
 * 1. `marcarVencidas(now)` (repo B2): toda `quote_request` `enviada` con `plazo_at <= now`
 *    pasa a `vencida`; se agrupan las afectadas por pedido.
 * 2. Por cada pedido afectado que siga `cotizando` y sin RFQs `enviada` restantes:
 *    `transicionarAEnRevisionConComparativo` (misma transicion + comparativo con
 *    throw-to-rollback que ejecuta `registrar_cotizacion` al entrar la ultima cotizacion).
 * 3. Notificacion E1 a Proveeduria (outbox `notificacion_interna`) con los proveedores
 *    vencidos del pedido y las opciones humanas (extender plazo / continuar con lo recibido).
 * 4. `audit_event('e1_vencimiento')` por pedido con los `quote_request_ids` vencidos.
 *
 * Es una operacion de SISTEMA: la invoca el cron (no un usuario), por eso NO valida rol via
 * `puedeUsarTool`. Corre siempre dentro de un `Ctx` de sistema (`crearCtxSistema`,
 * `actor_sistema=true` / `actor_user_id=null` en la auditoria). Si el comparativo de algun
 * pedido no se puede generar, `transicionarAEnRevisionConComparativo` lanza y toda la tx del
 * ciclo se revierte (nunca deja un pedido en `en_revision` sin comparativo).
 */
export async function procesarVencimientos(
  ctx: Ctx,
  ahora?: Date,
): Promise<ResultadoVencimientos> {
  const now = ahora ?? ctx.ahora;
  const vencidas = await ctx.repos.quoteRequests.marcarVencidas(now);
  if (vencidas.length === 0) {
    return { vencidas: 0, pedidosTransicionados: 0 };
  }

  const porPedido = new Map<string, QuoteRequest[]>();
  for (const qr of vencidas) {
    const grupo = porPedido.get(qr.pedidoId) ?? [];
    grupo.push(qr);
    porPedido.set(qr.pedidoId, grupo);
  }

  let pedidosTransicionados = 0;

  for (const [pedidoId, rfqsVencidas] of porPedido) {
    const pedido = await ctx.repos.pedidos.bloquearPorId(pedidoId);
    // Solo pedidos que sigan `cotizando`: si ya paso a `en_revision`+ su comparativo ya se
    // genero por otra via (p.ej. la ultima cotizacion completa) y el aviso E1 no aplica.
    if (pedido === null || pedido.estado !== 'cotizando') continue;

    const pendientes = await ctx.repos.quoteRequests.contarPendientesPorPedido(pedidoId);
    let transiciono = false;
    if (pendientes === 0) {
      await transicionarAEnRevisionConComparativo(ctx, pedido);
      transiciono = true;
      pedidosTransicionados += 1;
    }

    const supplierIdsVencidos = rfqsVencidas.map((qr) => qr.supplierId);
    const proveedores = await ctx.repos.proveedores.porIdsConContactoOptIn(supplierIdsVencidos);
    const nombrePorId = new Map(
      proveedores.map((proveedor): [string, string] => [proveedor.id, proveedor.nombre]),
    );
    const nombresVencidos = supplierIdsVencidos
      .map((id) => nombrePorId.get(id) ?? id)
      .join(', ');
    const resumen =
      `E1 pedido ${pedido.numero}: vencio el plazo de cotizacion de ${nombresVencidos}. ` +
      'Opciones: extender plazo (reenviar RFQ) o continuar con lo recibido.';

    await notificarAdmins(ctx, pedido.id, resumen);

    await ctx.audit({
      accion: 'e1_vencimiento',
      entidad: 'pedido',
      entidadId: pedido.id,
      pedidoId: pedido.id,
      antes: null,
      despues: {
        pedido_id: pedido.id,
        quote_request_ids_vencidos: rfqsVencidas.map((qr) => qr.id),
        supplier_ids_vencidos: supplierIdsVencidos,
        transiciono_a_en_revision: transiciono,
      },
    });
  }

  return { vencidas: vencidas.length, pedidosTransicionados };
}
