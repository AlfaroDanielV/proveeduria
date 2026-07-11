import { useEffect, useState } from 'react';
import Dialog from '../Dialog';
import { listarProveedores } from '../../api/cliente';
import type { Proveedor } from '../../types';

const PLAZO_HORAS_DEFECTO = 24;

interface EnviarRfqsPanelProps {
  readonly onConfirmar: (supplierIds: readonly string[], plazoHoras: number) => Promise<unknown>;
}

/**
 * Bandeja "aprobar lista de proveedores" (estado `borrador`): selecciona proveedores activos
 * con al menos un contacto opt-in y dispara `enviar_rfq` con confirmacion previa.
 */
export default function EnviarRfqsPanel({ onConfirmar }: EnviarRfqsPanelProps) {
  const [proveedores, setProveedores] = useState<readonly Proveedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [seleccionados, setSeleccionados] = useState<readonly string[]>([]);
  const [plazoHoras, setPlazoHoras] = useState(PLAZO_HORAS_DEFECTO);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let activo = true;
    setCargando(true);
    listarProveedores({ activo: true, limit: 100 })
      .then((data) => {
        if (activo) setProveedores(data.items);
      })
      .catch(() => {
        if (activo) setErrorCarga('No pudimos cargar los proveedores.');
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  const conOptIn = proveedores.filter((proveedor) => proveedor.contactos.some((c) => c.optinAt !== null));
  const seleccionadosDatos = conOptIn.filter((proveedor) => seleccionados.includes(proveedor.id));

  function alternar(id: string): void {
    setSeleccionados((actual) => (actual.includes(id) ? actual.filter((s) => s !== id) : [...actual, id]));
  }

  function abrirConfirmacion(): void {
    if (seleccionados.length === 0) {
      setError('Selecciona al menos un proveedor.');
      return;
    }
    if (!Number.isFinite(plazoHoras) || plazoHoras <= 0) {
      setError('El plazo debe ser un numero de horas mayor a cero.');
      return;
    }
    setError(null);
    setConfirmando(true);
  }

  function cerrarConfirmacion(): void {
    setConfirmando(false);
    setError(null);
  }

  async function confirmar(): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      await onConfirmar(seleccionados, plazoHoras);
      setSeleccionados([]);
      setConfirmando(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos enviar las RFQs.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="comparativo-section" aria-label="Enviar RFQs">
      <div className="panel-title compact">
        <h3>Enviar RFQs</h3>
      </div>
      {cargando && <p className="empty-hint">Cargando proveedores...</p>}
      {errorCarga !== null && (
        <p role="alert" className="form-error">
          {errorCarga}
        </p>
      )}
      {!cargando && errorCarga === null && conOptIn.length === 0 && (
        <p className="empty-hint">No hay proveedores activos con contacto opt-in.</p>
      )}
      {conOptIn.length > 0 && (
        <div className="form-card compact">
          <div className="compact-list">
            {conOptIn.map((proveedor) => (
              <label key={proveedor.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={seleccionados.includes(proveedor.id)}
                  onChange={() => alternar(proveedor.id)}
                />
                <span>{proveedor.nombre}</span>
              </label>
            ))}
          </div>
          <label>
            <span>Plazo (horas)</span>
            <input
              type="number"
              min={1}
              value={plazoHoras}
              onChange={(evento) => setPlazoHoras(Number(evento.target.value))}
            />
          </label>
          {error !== null && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" onClick={abrirConfirmacion}>
              Enviar RFQs
            </button>
          </div>
        </div>
      )}

      <Dialog titulo="Confirmar envio de RFQs" abierto={confirmando} onCerrar={cerrarConfirmacion}>
        <p>
          Vas a solicitar cotizacion a <strong>{seleccionadosDatos.length}</strong> proveedor(es) con un plazo de{' '}
          <strong>{plazoHoras}h</strong>:
        </p>
        <ul>
          {seleccionadosDatos.map((proveedor) => (
            <li key={proveedor.id}>{proveedor.nombre}</li>
          ))}
        </ul>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={() => void confirmar()} disabled={enviando}>
            {enviando ? 'Enviando...' : 'Confirmar envio'}
          </button>
          <button type="button" className="secondary" onClick={cerrarConfirmacion} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </Dialog>
    </section>
  );
}
