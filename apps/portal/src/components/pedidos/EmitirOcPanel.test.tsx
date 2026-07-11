import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmitirOcPanel from './EmitirOcPanel';

describe('EmitirOcPanel', () => {
  it('muestra los numeros de OC emitidos tras confirmar', async () => {
    const onConfirmar = vi.fn().mockResolvedValue([
      { ocId: 'oc1', numero: 'OC-2026-001', supplierId: 'p1', montoTotal: 1000 },
      { ocId: 'oc2', numero: 'OC-2026-002', supplierId: 'p2', montoTotal: 500 },
    ]);
    render(<EmitirOcPanel onConfirmar={onConfirmar} />);

    fireEvent.click(screen.getByRole('button', { name: 'Emitir OC(s)' }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar emision/i }));

    await waitFor(() => {
      expect(screen.getByText('OC-2026-001')).toBeTruthy();
      expect(screen.getByText('OC-2026-002')).toBeTruthy();
    });
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('muestra el error del servidor si la emision falla', async () => {
    const onConfirmar = vi.fn().mockRejectedValue(new Error('sin adjudicacion registrada'));
    render(<EmitirOcPanel onConfirmar={onConfirmar} />);

    fireEvent.click(screen.getByRole('button', { name: 'Emitir OC(s)' }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar emision/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/sin adjudicacion registrada/i);
    });
  });
});
