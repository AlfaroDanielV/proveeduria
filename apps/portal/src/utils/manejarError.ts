import { SesionExpiradaError } from '../api/cliente';

/**
 * Manejo uniforme de errores de API en las pantallas: sesion vencida desloguea y avisa;
 * cualquier otro error solo se muestra como toast.
 */
export function manejarErrorApi(
  error: unknown,
  sesionExpirada: () => void,
  mostrarToast: (mensaje: string) => void,
): void {
  if (error instanceof SesionExpiradaError) {
    sesionExpirada();
    mostrarToast('La sesion expiro. Inicia sesion de nuevo.');
    return;
  }
  mostrarToast(error instanceof Error ? error.message : 'Ocurrio un error inesperado.');
}
