import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { login as loginApi, logout as logoutApi, obtenerMe } from '../api/cliente';
import type { Usuario } from '../types';

interface AuthContextValue {
  readonly usuario: Usuario | null;
  readonly cargando: boolean;
  readonly debeCambiarPassword: boolean;
  readonly iniciarSesion: (identificador: string, password: string) => Promise<void>;
  readonly cerrarSesion: () => Promise<void>;
  readonly confirmarCambioPassword: () => void;
  readonly sesionExpirada: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [debeCambiarPassword, setDebeCambiarPassword] = useState(false);

  useEffect(() => {
    let activo = true;
    obtenerMe()
      .then((data) => {
        if (!activo) return;
        setUsuario(data.user);
        setDebeCambiarPassword(false);
      })
      .catch(() => {
        if (activo) setUsuario(null);
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  const iniciarSesion = useCallback(async (identificador: string, password: string) => {
    const resultado = await loginApi(identificador, password);
    setUsuario(resultado.user);
    setDebeCambiarPassword(resultado.mustChangePassword);
  }, []);

  const cerrarSesion = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // Igual limpiamos el estado local: si el servidor ya no reconoce la sesion, no hay
      // nada que revocar.
    }
    setUsuario(null);
    setDebeCambiarPassword(false);
  }, []);

  const confirmarCambioPassword = useCallback(() => {
    setDebeCambiarPassword(false);
  }, []);

  const sesionExpirada = useCallback(() => {
    setUsuario(null);
    setDebeCambiarPassword(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        usuario,
        cargando,
        debeCambiarPassword,
        iniciarSesion,
        cerrarSesion,
        confirmarCambioPassword,
        sesionExpirada,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const contexto = useContext(AuthContext);
  if (contexto === null) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return contexto;
}
