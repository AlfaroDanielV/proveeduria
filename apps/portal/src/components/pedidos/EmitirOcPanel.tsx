import { useState } from 'react';
import Dialog from '../Dialog';
import type { OcEmitida } from '../../types';
import { formatearColones } from '../../utils/formato';

interface EmitirOcPanelProps {
  readonly onConfirmar: () => Promise<readonly OcEmitida[]>;
}

/** Emision de OC(s) (estado `aprobado`): sin body, la fuente es la adjudicacion registrada. */
export default function EmitirOcPanel({ onConfirmar }: EmitirOcPanelProps) {
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocsEmitidas, setOcsEmitidas] = useState<readonly OcEmitida[] | null>(null);

  function cerrarConfirmacion(): void {
    setConfirmando(false);
    setError(null);
  }

  async function confirmar(): Promise<void> {
    setEnviando(true);
    setError(null);
    try {
      const ocs = await onConfirmar();
      setOcsEmitidas(ocs);
      setConfirmando(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos emitir la(s) OC(s).');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="comparativo-section" aria-label="Emitir OC">
      <div className="panel-title compact">
        <h3>Emitir OC(s)</h3>
      </div>
      <div className="form-actions">
        <button type="button" onClick={() => setConfirmando(true)}>
          Emitir OC(s)
        </button>
      </div>

      {ocsEmitidas !== null && (
        <div className="compact-list">
          {ocsEmitidas.map((oc) => (
            <div className="compact-item" key={oc.ocId}>
              <strong>{oc.numero}</strong>
              <span>{formatearColones(oc.montoTotal)}</span>
            </div>
          ))}
        </div>
      )}

      <Dialog titulo="Confirmar emision de OC" abierto={confirmando} onCerrar={cerrarConfirmacion}>
        <p>Vas a emitir la(s) orden(es) de compra segun la adjudicacion registrada para este pedido.</p>
        {error !== null && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" onClick={() => void confirmar()} disabled={enviando}>
            {enviando ? 'Emitiendo...' : 'Confirmar emision'}
          </button>
          <button type="button" className="secondary" onClick={cerrarConfirmacion} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </Dialog>
    </section>
  );
}
