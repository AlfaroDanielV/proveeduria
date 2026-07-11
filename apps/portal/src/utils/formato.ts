/** Formateadores compartidos (portados de la SPA estatica anterior, src/app.js). */

export function formatearColones(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-';
  return new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency: 'CRC',
    maximumFractionDigits: 0,
  }).format(valor);
}

export function formatearNumero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-';
  return new Intl.NumberFormat('es-CR', { maximumFractionDigits: 3 }).format(valor);
}

export function formatearEstado(valor: string): string {
  return valor.replaceAll('_', ' ');
}

export function claseEstado(valor: string): string {
  if (valor === 'en_revision' || valor === 'resuelta') return 'en_revision';
  if (valor === 'cotizando' || valor === 'pendiente') return 'cotizando';
  if (valor === 'cancelado') return 'cancelado';
  return 'default';
}

export function formatearFecha(valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '-';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor;
  return new Intl.DateTimeFormat('es-CR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(fecha);
}

export function formatearDetalle(detalle: unknown): string {
  if (detalle === null || detalle === undefined) return '-';
  if (typeof detalle === 'string') return detalle;
  try {
    return JSON.stringify(detalle);
  } catch {
    return String(detalle);
  }
}
