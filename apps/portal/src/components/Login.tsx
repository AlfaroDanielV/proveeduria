import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';

const MENSAJE_ERROR_UNIFORME = 'No pudimos iniciar sesion. Verifica tu usuario y contrasena.';

export default function Login() {
  const auth = useAuth();
  const [identificador, setIdentificador] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setError(null);
    if (identificador.trim() === '' || password === '') {
      setError(MENSAJE_ERROR_UNIFORME);
      return;
    }
    setEnviando(true);
    try {
      await auth.iniciarSesion(identificador.trim(), password);
    } catch {
      // Respuesta uniforme: nunca revelamos si el usuario existe o si fue el password.
      setError(MENSAJE_ERROR_UNIFORME);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <p className="eyebrow">Atemporal</p>
        <h1>Centro de Control</h1>
        <label>
          <span>Usuario</span>
          <input
            value={identificador}
            onChange={(evento) => setIdentificador(evento.target.value)}
            placeholder="email o telefono"
            autoComplete="username"
          />
        </label>
        <label>
          <span>Contrasena</span>
          <input
            type="password"
            value={password}
            onChange={(evento) => setPassword(evento.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
