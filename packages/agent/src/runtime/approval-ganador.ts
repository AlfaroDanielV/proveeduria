import type { AsignacionGanadorAprobada } from './types.js';

/**
 * Parseo defensivo de `approval_events.detalle` para `tipo='ganador'`, forma normativa
 * fijada por `aprobar_ganador` (tools/adjudicacion.ts, ver docstring de
 * `AsignacionGanadorDetalle`): `{ asignaciones: [{ supplierId, pedidoItemIds, quoteResponseId }], comparativo }`.
 * Solo necesitamos `asignaciones` para `emitir_oc` (fija proveedores/items/quoteResponseId).
 * `null` si el jsonb persistido no calza: `emitir_oc` nunca emite una OC "de memoria".
 * Compartido por `PgApprovalRepo` (repos.ts) y `FakeApprovalRepo` (fakes.ts).
 */
export function parseAsignacionesGanador(
  detalle: unknown,
): readonly AsignacionGanadorAprobada[] | null {
  if (!isRecord(detalle) || !Array.isArray(detalle.asignaciones)) return null;

  const asignaciones: AsignacionGanadorAprobada[] = [];
  for (const raw of detalle.asignaciones) {
    if (!isRecord(raw)) return null;
    if (typeof raw.supplierId !== 'string' || raw.supplierId === '') return null;
    if (typeof raw.quoteResponseId !== 'string' || raw.quoteResponseId === '') return null;
    if (!Array.isArray(raw.pedidoItemIds) || raw.pedidoItemIds.length === 0) return null;

    const pedidoItemIds: string[] = [];
    for (const itemId of raw.pedidoItemIds) {
      if (typeof itemId !== 'string' || itemId === '') return null;
      pedidoItemIds.push(itemId);
    }

    asignaciones.push({
      supplierId: raw.supplierId,
      pedidoItemIds,
      quoteResponseId: raw.quoteResponseId,
    });
  }

  return asignaciones;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
