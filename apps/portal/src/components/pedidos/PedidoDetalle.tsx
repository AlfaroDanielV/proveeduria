import { useCallback, useEffect, useState } from 'react';
import { adjudicar, emitirOcs, enviarRfqs, obtenerComparativo, obtenerPedido } from '../../api/cliente';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ROLES_APROBAR_PEDIDOS, tieneAlgunRol } from '../../permisos';
import type { AdjudicacionAsignacion, Comparativo, OcEmitida, PedidoDetalle as PedidoDetalleTipo, Usuario } from '../../types';
import { claseEstado, formatearColones, formatearEstado, formatearNumero } from '../../utils/formato';
import { manejarErrorApi } from '../../utils/manejarError';
import AdjudicacionPanel from './AdjudicacionPanel';
import EmitirOcPanel from './EmitirOcPanel';
import EnviarRfqsPanel from './EnviarRfqsPanel';
import HistorialAprobaciones from './HistorialAprobaciones';

export default function PedidoDetalle({ pedidoId, usuario }: { pedidoId: string; usuario: Usuario }) {
  const auth = useAuth();
  const { mostrarToast } = useToast();
  const [detalle, setDetalle] = useState<PedidoDetalleTipo | null>(null);
  const [comparativo, setComparativo] = useState<Comparativo | null>(null);
  const [recargarTrigger, setRecargarTrigger] = useState(0);

  const puedeAprobar = tieneAlgunRol(usuario, ROLES_APROBAR_PEDIDOS);

  const cargarDatos = useCallback(async (): Promise<{ detalle: PedidoDetalleTipo; comparativo: Comparativo } | null> => {
    try {
      const [d, c] = await Promise.all([obtenerPedido(pedidoId), obtenerComparativo(pedidoId)]);
      return { detalle: d, comparativo: c };
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId]);

  useEffect(() => {
    let activo = true;
    setDetalle(null);
    setComparativo(null);
    (async () => {
      const resultado = await cargarDatos();
      if (activo && resultado !== null) {
        setDetalle(resultado.detalle);
        setComparativo(resultado.comparativo);
      }
    })();
    return () => {
      activo = false;
    };
  }, [cargarDatos]);

  async function recargar(): Promise<void> {
    const resultado = await cargarDatos();
    if (resultado !== null) {
      setDetalle(resultado.detalle);
      setComparativo(resultado.comparativo);
    }
  }

  async function despuesDeAccion(mensaje: string): Promise<void> {
    mostrarToast(mensaje);
    await recargar();
    setRecargarTrigger((v) => v + 1);
  }

  async function onEnviarRfqsConfirmado(supplierIds: readonly string[], plazoHoras: number): Promise<void> {
    try {
      const resultado = await enviarRfqs(pedidoId, { supplierIds, plazoHoras });
      await despuesDeAccion(`RFQs enviadas: ${resultado.rfqs}.`);
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      throw err;
    }
  }

  async function onAdjudicarConfirmado(asignaciones: readonly AdjudicacionAsignacion[]): Promise<void> {
    try {
      await adjudicar(pedidoId, { asignaciones });
      await despuesDeAccion('Adjudicacion registrada.');
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      throw err;
    }
  }

  async function onEmitirOcsConfirmado(): Promise<readonly OcEmitida[]> {
    try {
      const resultado = await emitirOcs(pedidoId);
      await despuesDeAccion(`OC(s) emitida(s): ${resultado.ocs.map((oc) => oc.numero).join(', ')}.`);
      return resultado.ocs;
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      throw err;
    }
  }

  if (detalle === null || comparativo === null) {
    return (
      <div className="empty-state">
        <h2>Cargando...</h2>
      </div>
    );
  }

  const { pedido } = detalle;

  return (
    <div className="detail-content">
      <div className="detail-head">
        <div>
          <p className="eyebrow">
            {pedido.proyecto.codigo} · {pedido.proyecto.nombre}
          </p>
          <h2>{pedido.numero}</h2>
        </div>
        <span className={`status ${claseEstado(pedido.estado)}`}>{formatearEstado(pedido.estado)}</span>
      </div>

      <div className="metrics">
        <div>
          <span>Items</span>
          <strong>{pedido.itemsCount}</strong>
        </div>
        <div>
          <span>RFQs</span>
          <strong>{pedido.rfqsTotal}</strong>
        </div>
        <div>
          <span>Respondidas</span>
          <strong>{pedido.rfqsRespondidas}</strong>
        </div>
        <div>
          <span>Revision</span>
          <strong>{pedido.revisionesPendientes}</strong>
        </div>
      </div>

      <div className="split">
        <section>
          <div className="panel-title compact">
            <h3>Items</h3>
          </div>
          <div className="compact-list">
            {detalle.items.map((item, indice) => (
              <div className="compact-item" key={indice}>
                <strong>{item.descripcion}</strong>
                <span>
                  {formatearNumero(item.cantidad)} {item.unidad}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="panel-title compact">
            <h3>Cotizaciones</h3>
          </div>
          <div className="compact-list">
            {detalle.quoteRequests.map((quote, indice) => {
              const respuesta = quote.ultimaRespuesta
                ? `${quote.ultimaRespuesta.fuente ?? 'respuesta'} · ${quote.ultimaRespuesta.confianzaExtraccion ?? '-'}`
                : 'sin respuesta';
              return (
                <div className="compact-item" key={indice}>
                  <strong>{quote.proveedor}</strong>
                  <span>
                    {formatearEstado(quote.estado)} · {respuesta}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {pedido.estado === 'borrador' && puedeAprobar && <EnviarRfqsPanel onConfirmar={onEnviarRfqsConfirmado} />}

      <section className="comparativo-section">
        <div className="panel-title">
          <h3>Comparativo</h3>
          <span>{comparativo.filas.length}</span>
        </div>
        <div className="supplier-summary">
          {comparativo.resumenProveedores.map((proveedor) => (
            <div className="supplier" key={proveedor.quoteRequestId}>
              <strong>{proveedor.nombre}</strong>
              <span>
                {formatearColones(proveedor.total)} · {proveedor.itemsCotizados} cotizados ·{' '}
                {proveedor.itemsFaltantes} faltantes
              </span>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Proveedor</th>
                <th>Precio</th>
                <th>Cantidad</th>
                <th>Subtotal</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {comparativo.filas.map((fila, indice) => (
                <tr key={indice}>
                  <td>{fila.descripcion}</td>
                  <td>{fila.proveedor}</td>
                  <td className="numeric">{formatearColones(fila.precioUnitario)}</td>
                  <td className="numeric">
                    {formatearNumero(fila.cantidadCotizada)} / {formatearNumero(fila.cantidadSolicitada)}
                  </td>
                  <td className="numeric">{formatearColones(fila.subtotal)}</td>
                  <td>
                    <span className={`chip ${fila.faltante ? 'missing' : 'ok'}`}>
                      {fila.faltante ? 'faltante' : 'completo'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pedido.estado === 'en_revision' && puedeAprobar && (
        <AdjudicacionPanel comparativo={comparativo} onConfirmar={onAdjudicarConfirmado} />
      )}

      {pedido.estado === 'aprobado' && puedeAprobar && <EmitirOcPanel onConfirmar={onEmitirOcsConfirmado} />}

      <HistorialAprobaciones pedidoId={pedidoId} recargarTrigger={recargarTrigger} />
    </div>
  );
}
