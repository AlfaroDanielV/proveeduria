import type { ReactNode } from 'react';

interface DialogProps {
  readonly titulo: string;
  readonly abierto: boolean;
  readonly onCerrar: () => void;
  readonly children: ReactNode;
}

export default function Dialog({ titulo, abierto, onCerrar, children }: DialogProps) {
  if (!abierto) return null;
  return (
    <div className="dialog-backdrop" onClick={onCerrar}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="dialog-head">
          <h3>{titulo}</h3>
          <button type="button" className="dialog-close" onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
