import { useCallback, useEffect, useState } from 'react';
import { listarPedidos } from '../../api/cliente';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ESTADOS_PEDIDO } from '../../types';
import type { PedidoResumen, Usuario } from '../../types';
import { claseEstado, formatearEstado } from '../../utils/formato';
import { manejarErrorApi } from '../../utils/manejarError';
import Paginacion from '../Paginacion';
import PedidoDetalle from './PedidoDetalle';

const LIMITE = 25;

export default function PedidosScreen({ usuario }: { usuario: Usuario }) {
  const auth = useAuth();
  const { mostrarToast } = useToast();

  const [estado, setEstado] = useState('');
  const [projectId, setProjectId] = useState('');
  const [offset, setOffset] = useState(0);
  const [pedidos, setPedidos] = useState<readonly PedidoResumen[]>([]);
  const [total, setTotal] = useState(0);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargarPedidos = useCallback(async () => {
    setCargando(true);
    try {
      const filtro: { estado?: string; projectId?: string; limit: number; offset: number } = {
        limit: LIMITE,
        offset,
      };
      if (estado !== '') filtro.estado = estado;
      if (projectId.trim() !== '') filtro.projectId = projectId.trim();
      const data = await listarPedidos(filtro);
      setPedidos(data.items);
      setTotal(data.total);
      setSeleccionadoId((actual) => {
        if (data.items.length === 0) return null;
        if (actual !== null && data.items.some((p) => p.id === actual)) return actual;
        return data.items[0]?.id ?? null;
      });
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, offset]);

  useEffect(() => {
    void cargarPedidos();
  }, [cargarPedidos]);

  function onCambiarEstado(nuevoEstado: string): void {
    setEstado(nuevoEstado);
    setOffset(0);
  }

  function onRecargar(): void {
    setOffset(0);
    void cargarPedidos();
  }

  return (
    <section className="screen">
      <section className="toolbar" aria-label="Filtros de pedidos">
        <label>
          <span>Estado</span>
          <select value={estado} onChange={(evento) => onCambiarEstado(evento.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_PEDIDO.map((valor) => (
              <option key={valor} value={valor}>
                {formatearEstado(valor)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Proyecto</span>
          <input
            value={projectId}
            onChange={(evento) => setProjectId(evento.target.value)}
            placeholder="UUID opcional"
            autoComplete="off"
          />
        </label>
        <button type="button" onClick={onRecargar} disabled={cargando}>
          Recargar
        </button>
      </section>

      <section className="workspace">
        <aside className="pedido-list" aria-label="Pedidos">
          <div className="panel-title">
            <h2>Pedidos</h2>
            <span>{total}</span>
          </div>
          <div className="rows">
            {pedidos.map((pedido) => (
              <button
                key={pedido.id}
                type="button"
                className={`pedido-row${pedido.id === seleccionadoId ? ' active' : ''}`}
                onClick={() => setSeleccionadoId(pedido.id)}
              >
                <strong>{pedido.numero}</strong>
                <span className={`status ${claseEstado(pedido.estado)}`}>{formatearEstado(pedido.estado)}</span>
                <span className="row-meta">
                  <span>{pedido.proyecto.codigo}</span>
                  <span>{pedido.itemsCount} items</span>
                  <span>
                    {pedido.rfqsRespondidas}/{pedido.rfqsTotal} RFQ
                  </span>
                </span>
              </button>
            ))}
            {pedidos.length === 0 && !cargando && <p className="empty-hint">No hay pedidos para este filtro.</p>}
          </div>
          <Paginacion total={total} limit={LIMITE} offset={offset} onCambiar={setOffset} />
        </aside>

        <section className="detail" aria-label="Detalle del pedido">
          {seleccionadoId === null ? (
            <div className="empty-state">
              <h2>Sin pedido seleccionado</h2>
            </div>
          ) : (
            <PedidoDetalle pedidoId={seleccionadoId} usuario={usuario} />
          )}
        </section>
      </section>
    </section>
  );
}
