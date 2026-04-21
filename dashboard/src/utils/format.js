export function formatColones(n) {
  if (n == null || isNaN(Number(n))) return '₡0';
  const rounded = Math.round(Number(n));
  // de-DE usa el punto como separador de miles (igual que CR).
  return `₡${rounded.toLocaleString('de-DE')}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
