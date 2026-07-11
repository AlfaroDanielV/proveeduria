import { useEffect, useState } from 'react';
import { obtenerAprobaciones } from '../../api/cliente';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { AprobacionEvento } from '../../types';
import { formatearEstado, formatearFecha } from '../../utils/formato';
import { manejarErrorApi } from '../../utils/manejarError';

interface AsignacionResumen {
  readonly supplierId: string;
  readonly nombre: string;
  readonly pedidoItemIds: readonly string[];
}

function esRegistro(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `detalle.asignaciones[].nombre` no existe (la tool `aprobar_ganador` solo fija
 * `supplierId`/`pedidoItemIds`/`quoteResponseId`); el nombre vive en
 * `detalle.comparativo.resumenProveedores[]` (snapshot D5). Se resuelve por supplierId, con
 * fallback al id si el snapshot no trae ese proveedor.
 */
function nombreProveedor(detalle: Record<string, unknown>, supplierId: string): string {
  const comparativo = detalle.comparativo;
  const resumenProveedores = esRegistro(comparativo) ? comparativo.resumenProveedores : undefined;
  if (Array.isArray(resumenProveedores)) {
    for (const proveedor of resumenProveedores) {
      if (esRegistro(proveedor) && proveedor.supplierId === supplierId && typeof proveedor.nombre === 'string') {
        return proveedor.nombre;
      }
    }
  }
  return supplierId;
}

/** Extraccion defensiva: `detalle` de un evento `ganador` trae el snapshot D5 del comparativo. */
function extraerAsignaciones(detalle: unknown): readonly AsignacionResumen[] {
  if (!esRegistro(detalle) || !Array.isArray(detalle.asignaciones)) return [];
  const resultado: AsignacionResumen[] = [];
  for (const entrada of detalle.asignaciones) {
    if (!esRegistro(entrada) || typeof entrada.supplierId !== 'string') continue;
    const { supplierId, pedidoItemIds } = entrada;
    resultado.push({
      supplierId,
      nombre: nombreProveedor(detalle, supplierId),
      pedidoItemIds: Array.isArray(pedidoItemIds) ? pedidoItemIds.filter((v): v is string => typeof v === 'string') : [],
    });
  }
  return resultado;
}

function AsignacionesDetalle({ detalle }: { readonly detalle: unknown }) {
  const [abierto, setAbierto] = useState(false);
  const asignaciones = extraerAsignaciones(detalle);
  if (asignaciones.length === 0) return null;
  return (
    <div>
      <button type="button" className="secondary" onClick={() => setAbierto((v) => !v)}>
        {abierto ? 'Ocultar asignaciones' : 'Ver asignaciones'}
      </button>
      {abierto && (
        <ul>
          {asignaciones.map((asignacion) => (
            <li key={asignacion.supplierId}>
              {asignacion.nombre}: {asignacion.pedidoItemIds.length} item(s)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface HistorialAprobacionesProps {
  readonly pedidoId: string;
  /** Cambia cada vez que una accion (RFQs/adjudicacion/OC) se confirma, para refetch. */
  readonly recargarTrigger: number;
}

/** Historial de `approval_events` del pedido: siempre visible, cualquiera sea el estado. */
export default function HistorialAprobaciones({ pedidoId, recargarTrigger }: HistorialAprobacionesProps) {
  const auth = useAuth();
  const { mostrarToast } = useToast();
  const [eventos, setEventos] = useState<readonly AprobacionEvento[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    setCargando(true);
    obtenerAprobaciones(pedidoId)
      .then((data) => {
        if (activo) setEventos(data.items);
      })
      .catch((err: unknown) => {
        if (activo) manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId, recargarTrigger]);

  return (
    <section className="comparativo-section" aria-label="Historial de aprobaciones">
      <div className="panel-title compact">
        <h3>Historial de aprobaciones</h3>
      </div>
      <div className="compact-list">
        {eventos.map((evento) => (
          <div className="compact-item" key={evento.id}>
            <strong>{formatearEstado(evento.tipo)}</strong>
            <span>
              {evento.aprobadoPor.nombre} · {evento.canal} · {formatearFecha(evento.at)}
            </span>
            {evento.tipo === 'ganador' && <AsignacionesDetalle detalle={evento.detalle} />}
          </div>
        ))}
        {eventos.length === 0 && !cargando && <p className="empty-hint">Sin aprobaciones registradas.</p>}
      </div>
    </section>
  );
}
