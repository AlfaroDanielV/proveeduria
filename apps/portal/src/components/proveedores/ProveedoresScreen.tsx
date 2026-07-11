import { useCallback, useEffect, useState } from 'react';
import { crearProveedor, listarProveedores } from '../../api/cliente';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ROLES_ESCRIBIR_PROVEEDORES, tieneAlgunRol } from '../../permisos';
import type { Proveedor, Usuario } from '../../types';
import { manejarErrorApi } from '../../utils/manejarError';
import Paginacion from '../Paginacion';
import ProveedorDetalle from './ProveedorDetalle';
import ProveedorForm from './ProveedorForm';
import type { DatosProveedorForm } from './ProveedorForm';

const LIMITE = 25;

export default function ProveedoresScreen({ usuario }: { usuario: Usuario }) {
  const auth = useAuth();
  const { mostrarToast } = useToast();
  const puedeEscribir = tieneAlgunRol(usuario, ROLES_ESCRIBIR_PROVEEDORES);

  const [q, setQ] = useState('');
  const [activo, setActivo] = useState<'' | 'true' | 'false'>('');
  const [offset, setOffset] = useState(0);
  const [proveedores, setProveedores] = useState<readonly Proveedor[]>([]);
  const [total, setTotal] = useState(0);
  const [seleccionado, setSeleccionado] = useState<Proveedor | null>(null);
  const [mostrandoNuevo, setMostrandoNuevo] = useState(false);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const filtro: { q?: string; activo?: boolean; limit: number; offset: number } = { limit: LIMITE, offset };
      if (q.trim() !== '') filtro.q = q.trim();
      if (activo !== '') filtro.activo = activo === 'true';
      const data = await listarProveedores(filtro);
      setProveedores(data.items);
      setTotal(data.total);
      setSeleccionado((actual) => {
        if (data.items.length === 0) return null;
        if (actual !== null) {
          const encontrado = data.items.find((p) => p.id === actual.id);
          if (encontrado !== undefined) return encontrado;
        }
        return data.items[0] ?? null;
      });
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function onBuscar(): void {
    setOffset(0);
    void cargar();
  }

  async function onCrear(datos: DatosProveedorForm): Promise<void> {
    await crearProveedor({
      nombre: datos.nombre,
      cedulaJuridica: datos.cedulaJuridica ?? undefined,
      categorias: datos.categorias,
      notas: datos.notas ?? undefined,
    });
    mostrarToast('Proveedor creado.');
    setMostrandoNuevo(false);
    setOffset(0);
    await cargar();
  }

  return (
    <section className="screen">
      <section className="toolbar" aria-label="Filtros de proveedores">
        <label>
          <span>Buscar</span>
          <input value={q} onChange={(evento) => setQ(evento.target.value)} placeholder="nombre o cedula" />
        </label>
        <label>
          <span>Estado</span>
          <select value={activo} onChange={(evento) => setActivo(evento.target.value as '' | 'true' | 'false')}>
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </label>
        <button type="button" onClick={onBuscar} disabled={cargando}>
          Buscar
        </button>
        {puedeEscribir && (
          <button type="button" className="secondary" onClick={() => setMostrandoNuevo((v) => !v)}>
            {mostrandoNuevo ? 'Cerrar' : 'Nuevo proveedor'}
          </button>
        )}
      </section>

      {mostrandoNuevo && puedeEscribir && (
        <ProveedorForm onGuardar={onCrear} onCancelar={() => setMostrandoNuevo(false)} />
      )}

      <section className="workspace">
        <aside className="pedido-list" aria-label="Proveedores">
          <div className="panel-title">
            <h2>Proveedores</h2>
            <span>{total}</span>
          </div>
          <div className="rows">
            {proveedores.map((proveedor) => (
              <button
                key={proveedor.id}
                type="button"
                className={`pedido-row${seleccionado?.id === proveedor.id ? ' active' : ''}`}
                onClick={() => setSeleccionado(proveedor)}
              >
                <strong>{proveedor.nombre}</strong>
                <span className={`status ${proveedor.activo ? 'en_revision' : 'cancelado'}`}>
                  {proveedor.activo ? 'activo' : 'inactivo'}
                </span>
                <span className="row-meta">
                  <span>{proveedor.categorias.join(', ') || 'sin categorias'}</span>
                  <span>{proveedor.contactos.length} contactos</span>
                </span>
              </button>
            ))}
            {proveedores.length === 0 && !cargando && <p className="empty-hint">Sin proveedores para este filtro.</p>}
          </div>
          <Paginacion total={total} limit={LIMITE} offset={offset} onCambiar={setOffset} />
        </aside>

        <section className="detail" aria-label="Detalle del proveedor">
          {seleccionado === null ? (
            <div className="empty-state">
              <h2>Sin proveedor seleccionado</h2>
            </div>
          ) : (
            <ProveedorDetalle proveedor={seleccionado} puedeEscribir={puedeEscribir} onActualizado={setSeleccionado} />
          )}
        </section>
      </section>
    </section>
  );
}
