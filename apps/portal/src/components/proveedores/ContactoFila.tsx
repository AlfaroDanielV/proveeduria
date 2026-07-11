import { useState } from 'react';
import Dialog from '../Dialog';
import type { Contacto } from '../../types';
import { formatearFecha } from '../../utils/formato';

interface ContactoFilaProps {
  readonly contacto: Contacto;
  readonly puedeEscribir: boolean;
  readonly onMarcarPrincipal: (contactoId: string) => Promise<unknown>;
  readonly onRenombrar: (contactoId: string, nombre: string) => Promise<unknown>;
  readonly onOptIn: (contactoId: string) => Promise<unknown>;
  readonly onBaja: (contactoId: string) => Promise<unknown>;
}

export default function ContactoFila({
  contacto,
  puedeEscribir,
  onMarcarPrincipal,
  onRenombrar,
  onOptIn,
  onBaja,
}: ContactoFilaProps) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(contacto.nombre);
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const optIn = contacto.optinAt !== null;

  async function guardarNombre(): Promise<void> {
    if (nombre.trim() === '' || nombre.trim() === contacto.nombre) {
      setEditando(false);
      setNombre(contacto.nombre);
      return;
    }
    await onRenombrar(contacto.id, nombre.trim());
    setEditando(false);
  }

  return (
    <div className="compact-item contacto-fila">
      {editando ? (
        <div className="contacto-edicion">
          <input value={nombre} onChange={(evento) => setNombre(evento.target.value)} autoComplete="off" />
          <button type="button" onClick={() => void guardarNombre()}>
            Guardar
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setNombre(contacto.nombre);
              setEditando(false);
            }}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <strong>
          {contacto.nombre} {contacto.esPrincipal && <span className="chip ok">principal</span>}
        </strong>
      )}
      <span>{contacto.telefonoWhatsapp}</span>
      <span>{optIn ? `Opt-in desde ${formatearFecha(contacto.optinAt)}` : 'Sin opt-in'}</span>

      {puedeEscribir && !editando && (
        <div className="contacto-acciones">
          <button type="button" className="secondary" onClick={() => setEditando(true)}>
            Editar
          </button>
          {!contacto.esPrincipal && (
            <button type="button" className="secondary" onClick={() => void onMarcarPrincipal(contacto.id)}>
              Marcar principal
            </button>
          )}
          {optIn ? (
            <button type="button" className="danger" onClick={() => setConfirmandoBaja(true)}>
              Baja
            </button>
          ) : (
            <button type="button" className="secondary" onClick={() => void onOptIn(contacto.id)}>
              Opt-in
            </button>
          )}
        </div>
      )}

      <Dialog titulo="Confirmar baja" abierto={confirmandoBaja} onCerrar={() => setConfirmandoBaja(false)}>
        <p>
          Vas a dar de baja a <strong>{contacto.nombre}</strong>. Dejara de recibir RFQs hasta que se registre un
          nuevo opt-in.
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="danger"
            onClick={() => {
              setConfirmandoBaja(false);
              void onBaja(contacto.id);
            }}
          >
            Confirmar baja
          </button>
          <button type="button" className="secondary" onClick={() => setConfirmandoBaja(false)}>
            Cancelar
          </button>
        </div>
      </Dialog>
    </div>
  );
}
