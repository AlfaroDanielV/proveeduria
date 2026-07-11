import { useCallback, useEffect, useState } from 'react';
import { listarRevisiones, resolverRevision } from '../../api/cliente';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { RevisionCola } from '../../types';
import { formatearDetalle, formatearFecha } from '../../utils/formato';
import { manejarErrorApi } from '../../utils/manejarError';
import Paginacion from '../Paginacion';
import ResolverDialog from './ResolverDialog';

const LIMITE = 25;

export default function RevisionesScreen() {
  const auth = useAuth();
  const { mostrarToast } = useToast();

  const [estado, setEstado] = useState<'pendiente' | 'resuelta'>('pendiente');
  const [tipo, setTipo] = useState('');
  const [offset, setOffset] = useState(0);
  const [revisiones, setRevisiones] = useState<readonly RevisionCola[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [resolviendoId, setResolviendoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const filtro: { estado: string; tipo?: string; limit: number; offset: number } = {
        estado,
        limit: LIMITE,
        offset,
      };
      if (tipo.trim() !== '') filtro.tipo = tipo.trim();
      const data = await listarRevisiones(filtro);
      setRevisiones(data.items);
      setTotal(data.total);
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, offset]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function onCambiarEstado(nuevo: 'pendiente' | 'resuelta'): void {
    setEstado(nuevo);
    setOffset(0);
  }

  function onFiltrar(): void {
    setOffset(0);
    void cargar();
  }

  async function onConfirmarResolucion(resolucion: string): Promise<void> {
    if (resolviendoId === null) return;
    try {
      await resolverRevision(resolviendoId, resolucion);
      mostrarToast('Entrada resuelta.');
      await cargar();
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      throw err;
    }
  }

  return (
    <section className="screen">
      <section className="toolbar" aria-label="Filtros de revisiones">
        <label>
          <span>Estado</span>
          <select value={estado} onChange={(evento) => onCambiarEstado(evento.target.value as 'pendiente' | 'resuelta')}>
            <option value="pendiente">Pendientes</option>
            <option value="resuelta">Resueltas</option>
          </select>
        </label>
        <label>
          <span>Tipo</span>
          <input value={tipo} onChange={(evento) => setTipo(evento.target.value)} placeholder="opcional" />
        </label>
        <button type="button" onClick={onFiltrar} disabled={cargando}>
          Filtrar
        </button>
      </section>

      <div className="panel-title">
        <h2>Cola de revision</h2>
        <span>{total}</span>
      </div>

      <div className="compact-list revisiones-list">
        {revisiones.map((revision) => (
          <div className="compact-item revision-fila" key={revision.id}>
            <div>
              <strong>{revision.tipo}</strong>
              <span>{formatearDetalle(revision.detalle)}</span>
              <span>{revision.pedido !== null ? `Pedido ${revision.pedido.numero}` : 'Sin pedido asociado'}</span>
              <span>{formatearFecha(revision.createdAt)}</span>
              {revision.estado === 'resuelta' && (
                <span>
                  Resuelta por {revision.resueltaPor ?? '-'}: {revision.resolucion ?? '-'}
                </span>
              )}
            </div>
            {revision.estado === 'pendiente' && (
              <button type="button" onClick={() => setResolviendoId(revision.id)}>
                Resolver
              </button>
            )}
          </div>
        ))}
        {revisiones.length === 0 && !cargando && <p className="empty-hint">No hay entradas para este filtro.</p>}
      </div>

      <Paginacion total={total} limit={LIMITE} offset={offset} onCambiar={setOffset} />

      <ResolverDialog
        abierto={resolviendoId !== null}
        onCerrar={() => setResolviendoId(null)}
        onConfirmar={onConfirmarResolucion}
      />
    </section>
  );
}
