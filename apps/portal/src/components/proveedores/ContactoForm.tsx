import { useState } from 'react';
import type { FormEvent } from 'react';

export interface DatosContactoForm {
  readonly nombre: string;
  readonly telefonoWhatsapp: string;
  readonly esPrincipal: boolean;
}

interface ContactoFormProps {
  readonly onGuardar: (datos: DatosContactoForm) => Promise<unknown>;
}

export default function ContactoForm({ onGuardar }: ContactoFormProps) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [esPrincipal, setEsPrincipal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setError(null);
    if (nombre.trim() === '') {
      setError('El nombre del contacto es obligatorio.');
      return;
    }
    if (!/^\+\d{8,15}$/.test(telefono.trim())) {
      setError('El telefono debe estar en formato E.164 (ej. +50688888888).');
      return;
    }
    setEnviando(true);
    try {
      await onGuardar({ nombre: nombre.trim(), telefonoWhatsapp: telefono.trim(), esPrincipal });
      setNombre('');
      setTelefono('');
      setEsPrincipal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos crear el contacto.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="form-card compact" onSubmit={onSubmit} aria-label="Nuevo contacto">
      <label>
        <span>Nombre</span>
        <input value={nombre} onChange={(evento) => setNombre(evento.target.value)} autoComplete="off" />
      </label>
      <label>
        <span>Telefono (E.164)</span>
        <input
          value={telefono}
          onChange={(evento) => setTelefono(evento.target.value)}
          placeholder="+50688888888"
          autoComplete="off"
        />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={esPrincipal} onChange={(evento) => setEsPrincipal(evento.target.checked)} />
        <span>Contacto principal</span>
      </label>
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={enviando}>
        {enviando ? 'Agregando...' : 'Agregar contacto'}
      </button>
    </form>
  );
}
