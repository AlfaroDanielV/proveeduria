import { useEffect, useState } from 'react';
import Dialog from '../Dialog';
import type { AdjudicacionAsignacion, Comparativo } from '../../types';
import { formatearColones, formatearNumero } from '../../utils/formato';

interface OpcionProveedor {
  readonly supplierId: string;
  readonly nombre: string;
  readonly precioUnitario: number | null;
  readonly subtotal: number | null;
}

interface ItemAdjudicable {
  readonly pedidoItemId: string;
  readonly descripcion: string;
  readonly cantidadSolicitada: number;
  readonly opciones: readonly OpcionProveedor[];
}

interface ResumenProveedor {
  readonly supplierId: string;
  readonly nombre: string;
  readonly itemsCount: number;
  readonly total: number;
}

/** Agrupa las filas item x proveedor del comparativo por item; solo ofrece proveedores con precio. */
function agruparItems(comparativo: Comparativo): readonly ItemAdjudicable[] {
  const mapa = new Map<string, ItemAdjudicable>();
  for (const fila of comparativo.filas) {
    const existente = mapa.get(fila.pedidoItemId) ?? {
      pedidoItemId: fila.pedidoItemId,
      descripcion: fila.descripcion,
      cantidadSolicitada: fila.cantidadSolicitada,
      opciones: [],
    };
    const opciones =
      fila.precioUnitario === null
        ? existente.opciones
        : [
            ...existente.opciones,
            { supplierId: fila.supplierId, nombre: fila.proveedor, precioUnitario: fila.precioUnitario, subtotal: fila.subtotal },
          ];
    mapa.set(fila.pedidoItemId, { ...existente, opciones });
  }
  return Array.from(mapa.values());
}

/** Arma el body de `POST .../adjudicacion`: asignaciones agrupadas por proveedor. */
function construirAsignaciones(asignacionPorItem: Readonly<Record<string, string>>): readonly AdjudicacionAsignacion[] {
  const porProveedor = new Map<string, string[]>();
  for (const [pedidoItemId, supplierId] of Object.entries(asignacionPorItem)) {
    if (supplierId === '') continue;
    const lista = porProveedor.get(supplierId) ?? [];
    lista.push(pedidoItemId);
    porProveedor.set(supplierId, lista);
  }
  return Array.from(porProveedor.entries()).map(([supplierId, pedidoItemIds]) => ({ supplierId, pedidoItemIds }));
}

function calcularResumen(
  items: readonly ItemAdjudicable[],
  asignacionPorItem: Readonly<Record<string, string>>,
): readonly ResumenProveedor[] {
  const porProveedor = new Map<string, ResumenProveedor>();
  for (const item of items) {
    const supplierId = asignacionPorItem[item.pedidoItemId];
    if (supplierId === undefined || supplierId === '') continue;
    const opcion = item.opciones.find((o) => o.supplierId === supplierId);
    const actual = porProveedor.get(supplierId) ?? {
      supplierId,
      nombre: opcion?.nombre ?? supplierId,
      itemsCount: 0,
      total: 0,
    };
    porProveedor.set(supplierId, {
      ...actual,
      itemsCount: actual.itemsCount + 1,
      total: actual.total + (opcion?.subtotal ?? 0),
    });
  }
  return Array.from(porProveedor.values());
}

interface AdjudicacionPanelProps {
  readonly comparativo: Comparativo;
  readonly onConfirmar: (asignaciones: readonly AdjudicacionAsignacion[]) => Promise<unknown>;
}

/** Adjudicacion desde el comparativo (estado `en_revision`): un proveedor ganador por item. */
export default function AdjudicacionPanel({ comparativo, onConfirmar }: AdjudicacionPanelProps) {
  const items = agruparItems(comparativo);
  const [asignacionPorItem, setAsignacionPorItem] = useState<Readonly<Record<string, string>>>({});
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setAsignacionPorItem({});
  }, [comparativo.pedido.id]);

  function onSeleccionar(pedidoItemId: string, supplierId: string): void {
    setAsignacionPorItem((actual) => ({ ...actual, [pedidoItemId]: supplierId }));
  }

  function abrirConfirmacion(): void {
    const faltantes = items.filter((item) => (asignacionPorItem[item.pedidoItemId] ?? '') === '');
    if (faltantes.length > 0) {
      setError('Asigna un proveedor ganador para todos los items antes de adjudicar.');
      return;
    }
    setError(null);
    setConfirmando(true);
  }

  function cerrarConfirmacion(): void {
    setConfirmando(false);
    setError(null);
  }

  const asignaciones = construirAsignaciones(asignacionPorItem);
  const resumen = calcularResumen(items, asignacionPorItem);
  const totalGeneral = resumen.reduce((acumulado, r) => acumulado + r.total, 0);

  async function confirmar(): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      await onConfirmar(asignaciones);
      setConfirmando(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos registrar la adjudicacion.');
    } finally {
      setEnviando(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="comparativo-section" aria-label="Adjudicacion">
      <div className="panel-title compact">
        <h3>Adjudicar ganador</h3>
      </div>
      <div className="form-card compact">
        <div className="compact-list">
          {items.map((item) => (
            <label key={item.pedidoItemId}>
              <span>
                {item.descripcion} ({formatearNumero(item.cantidadSolicitada)})
              </span>
              <select
                value={asignacionPorItem[item.pedidoItemId] ?? ''}
                onChange={(evento) => onSeleccionar(item.pedidoItemId, evento.target.value)}
              >
                <option value="">Selecciona proveedor</option>
                {item.opciones.map((opcion) => (
                  <option key={opcion.supplierId} value={opcion.supplierId}>
                    {opcion.nombre} · {formatearColones(opcion.precioUnitario)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={abrirConfirmacion}>
            Adjudicar
          </button>
        </div>
      </div>

      <Dialog titulo="Confirmar adjudicacion" abierto={confirmando} onCerrar={cerrarConfirmacion}>
        <div className="compact-list">
          {resumen.map((r) => (
            <div className="compact-item" key={r.supplierId}>
              <strong>{r.nombre}</strong>
              <span>
                {r.itemsCount} item(s) · {formatearColones(r.total)}
              </span>
            </div>
          ))}
        </div>
        <p>
          Total general: <strong>{formatearColones(totalGeneral)}</strong>
        </p>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={() => void confirmar()} disabled={enviando}>
            {enviando ? 'Adjudicando...' : 'Confirmar adjudicacion'}
          </button>
          <button type="button" className="secondary" onClick={cerrarConfirmacion} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </Dialog>
    </section>
  );
}
