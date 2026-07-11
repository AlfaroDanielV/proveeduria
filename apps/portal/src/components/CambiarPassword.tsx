import { useState } from 'react';
import type { FormEvent } from 'react';
import { cambiarPassword } from '../api/cliente';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { manejarErrorApi } from '../utils/manejarError';

export default function CambiarPassword() {
  const auth = useAuth();
  const { mostrarToast } = useToast();
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setError(null);

    if (passwordNueva.length < 8) {
      setError('La contrasena nueva debe tener al menos 8 caracteres.');
      return;
    }
    if (passwordNueva !== confirmacion) {
      setError('La confirmacion no coincide con la contrasena nueva.');
      return;
    }

    setEnviando(true);
    try {
      await cambiarPassword(passwordActual, passwordNueva);
      auth.confirmarCambioPassword();
      mostrarToast('Contrasena actualizada.');
    } catch (err) {
      manejarErrorApi(err, auth.sesionExpirada, mostrarToast);
      setError(err instanceof Error ? err.message : 'No pudimos actualizar la contrasena.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <p className="eyebrow">Primer ingreso</p>
        <h1>Cambia tu contrasena</h1>
        <label>
          <span>Contrasena actual</span>
          <input
            type="password"
            value={passwordActual}
            onChange={(evento) => setPasswordActual(evento.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label>
          <span>Contrasena nueva</span>
          <input
            type="password"
            value={passwordNueva}
            onChange={(evento) => setPasswordNueva(evento.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          <span>Confirma la contrasena nueva</span>
          <input
            type="password"
            value={confirmacion}
            onChange={(evento) => setConfirmacion(evento.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Guardando...' : 'Guardar y continuar'}
        </button>
      </form>
    </main>
  );
}
