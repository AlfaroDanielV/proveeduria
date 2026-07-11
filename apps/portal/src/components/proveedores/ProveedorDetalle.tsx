import {
  actualizarContacto,
  actualizarProveedor,
  bajaContacto,
  crearContacto,
  obtenerProveedor,
  optInContacto,
} from '../../api/cliente';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { Proveedor } from '../../types';
import { manejarErrorApi } from '../../utils/manejarError';
import ContactoFila from './ContactoFila';
import ContactoForm from './ContactoForm';
import ProveedorForm from './ProveedorForm';
import type { DatosProveedorForm } from './ProveedorForm';

interface ProveedorDetalleProps {
  readonly proveedor: Proveedor;
  readonly puedeEscribir: boolean;
  readonly onActualizado: (proveedor: Proveedor) => void;
}

export default function ProveedorDetalle({ proveedor, puedeEscribir, onActualizado }: ProveedorDetalleProps) {
  const auth = useAuth();
  const { mostrarToast } = useToast();

  async function recargar(): Promise<void> {
    try {
      const fresco = await obtenerProveedor(proveedor.id);
      onActualizado(fresco);
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    }
  }

  async function onGuardarEdicion(datos: DatosProveedorForm): Promise<void> {
    const actualizado = await actualizarProveedor(proveedor.id, datos);
    onActualizado(actualizado);
    mostrarToast('Proveedor actualizado.');
  }

  async function onCrearContacto(datos: { nombre: string; telefonoWhatsapp: string; esPrincipal: boolean }) {
    await crearContacto(proveedor.id, datos);
    mostrarToast('Contacto agregado.');
    await recargar();
  }

  async function onMarcarPrincipal(contactoId: string) {
    try {
      await actualizarContacto(contactoId, { esPrincipal: true });
      await recargar();
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    }
  }

  async function onRenombrar(contactoId: string, nombre: string) {
    try {
      await actualizarContacto(contactoId, { nombre });
      await recargar();
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    }
  }

  async function onOptIn(contactoId: string) {
    try {
      await optInContacto(contactoId);
      mostrarToast('Opt-in registrado.');
      await recargar();
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    }
  }

  async function onBaja(contactoId: string) {
    try {
      await bajaContacto(contactoId);
      mostrarToast('Contacto dado de baja.');
      await recargar();
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
    }
  }

  return (
    <div className="detail-content">
      <div className="detail-head">
        <div>
          <p className="eyebrow">{proveedor.cedulaJuridica ?? 'sin cedula'}</p>
          <h2>{proveedor.nombre}</h2>
        </div>
        <span className={`status ${proveedor.activo ? 'en_revision' : 'cancelado'}`}>
          {proveedor.activo ? 'activo' : 'inactivo'}
        </span>
      </div>

      {puedeEscribir ? (
        <ProveedorForm proveedor={proveedor} onGuardar={onGuardarEdicion} />
      ) : (
        <dl className="detail-readonly">
          <dt>Categorias</dt>
          <dd>{proveedor.categorias.length > 0 ? proveedor.categorias.join(', ') : '-'}</dd>
          <dt>Notas</dt>
          <dd>{proveedor.notas ?? '-'}</dd>
        </dl>
      )}

      <section className="comparativo-section">
        <div className="panel-title">
          <h3>Contactos</h3>
          <span>{proveedor.contactos.length}</span>
        </div>
        <div className="compact-list">
          {proveedor.contactos.map((contacto) => (
            <ContactoFila
              key={contacto.id}
              contacto={contacto}
              puedeEscribir={puedeEscribir}
              onMarcarPrincipal={onMarcarPrincipal}
              onRenombrar={onRenombrar}
              onOptIn={onOptIn}
              onBaja={onBaja}
            />
          ))}
          {proveedor.contactos.length === 0 && <p className="empty-hint">Sin contactos registrados.</p>}
        </div>
        {puedeEscribir && <ContactoForm onGuardar={onCrearContacto} />}
      </section>
    </div>
  );
}
