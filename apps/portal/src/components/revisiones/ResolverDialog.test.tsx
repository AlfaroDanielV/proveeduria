import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResolverDialog from './ResolverDialog';

describe('ResolverDialog', () => {
  it('exige texto de resolucion antes de confirmar', () => {
    const onConfirmar = vi.fn();
    render(<ResolverDialog abierto onCerrar={vi.fn()} onConfirmar={onConfirmar} />);

    fireEvent.click(screen.getByRole('button', { name: /confirmar resolucion/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/escribe la resolucion/i);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('confirma con el texto ingresado cuando no esta vacio', async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    const onCerrar = vi.fn();
    render(<ResolverDialog abierto onCerrar={onCerrar} onConfirmar={onConfirmar} />);

    fireEvent.change(screen.getByLabelText('Resolucion'), {
      target: { value: 'Se contacto al proveedor y se corrigio la factura.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirmar resolucion/i }));

    await waitFor(() => {
      expect(onConfirmar).toHaveBeenCalledWith('Se contacto al proveedor y se corrigio la factura.');
    });
  });
});
