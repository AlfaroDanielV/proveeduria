import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastContextValue {
  readonly mensaje: string | null;
  readonly mostrarToast: (mensaje: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mostrarToast = useCallback((texto: string) => {
    setMensaje(texto);
    if (temporizador.current !== null) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setMensaje(null), 5000);
  }, []);

  return <ToastContext.Provider value={{ mensaje, mostrarToast }}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const contexto = useContext(ToastContext);
  if (contexto === null) throw new Error('useToast debe usarse dentro de <ToastProvider>.');
  return contexto;
}
