import { useState } from 'react';
import Dialog from '../Dialog';

interface ResolverDialogProps {
  readonly abierto: boolean;
  readonly onCerrar: () => void;
  readonly onConfirmar: (resolucion: string) => Promise<unknown>;
}

export default function ResolverDialog({ abierto, onCerrar, onConfirmar }: ResolverDialogProps) {
  const [resolucion, setResolucion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function cerrar(): void {
    setResolucion('');
    setError(null);
    onCerrar();
  }

  async function confirmar(): Promise<void> {
    if (resolucion.trim() === '') {
      setError('Escribe la resolucion antes de confirmar.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await onConfirmar(resolucion.trim());
      cerrar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos resolver la entrada.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog titulo="Resolver entrada de la cola" abierto={abierto} onCerrar={cerrar}>
      <label>
        <span>Resolucion</span>
        <textarea
          value={resolucion}
          onChange={(evento) => setResolucion(evento.target.value)}
          rows={4}
          placeholder="Describe como se resolvio esta entrada"
        />
      </label>
      {error !== null && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" onClick={() => void confirmar()} disabled={enviando}>
          {enviando ? 'Guardando...' : 'Confirmar resolucion'}
        </button>
        <button type="button" className="secondary" onClick={cerrar}>
          Cancelar
        </button>
      </div>
    </Dialog>
  );
}
