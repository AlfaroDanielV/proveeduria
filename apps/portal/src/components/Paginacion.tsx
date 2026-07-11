interface PaginacionProps {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly onCambiar: (offset: number) => void;
}

export default function Paginacion({ total, limit, offset, onCambiar }: PaginacionProps) {
  if (total <= limit && offset === 0) return null;
  const desde = total === 0 ? 0 : offset + 1;
  const hasta = Math.min(offset + limit, total);
  const puedeAnterior = offset > 0;
  const puedeSiguiente = offset + limit < total;

  return (
    <div className="pagination">
      <button type="button" disabled={!puedeAnterior} onClick={() => onCambiar(Math.max(0, offset - limit))}>
        Anterior
      </button>
      <span>
        {desde}-{hasta} de {total}
      </span>
      <button type="button" disabled={!puedeSiguiente} onClick={() => onCambiar(offset + limit)}>
        Siguiente
      </button>
    </div>
  );
}
