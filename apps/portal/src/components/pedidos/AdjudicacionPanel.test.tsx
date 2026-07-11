import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdjudicacionPanel from './AdjudicacionPanel';
import type { Comparativo } from '../../types';

const comparativo: Comparativo = {
  pedido: { id: 'ped1', numero: 'PED-2026-001', estado: 'en_revision' },
  resumenProveedores: [],
  filas: [
    {
      pedidoItemId: 'item1',
      descripcion: 'Cemento',
      proveedor: 'Rodex',
      supplierId: 'p1',
      precioUnitario: 100,
      cantidadCotizada: 10,
      cantidadSolicitada: 10,
      subtotal: 1000,
      faltante: false,
    },
    {
      pedidoItemId: 'item1',
      descripcion: 'Cemento',
      proveedor: 'Coeco',
      supplierId: 'p2',
      precioUnitario: 90,
      cantidadCotizada: 10,
      cantidadSolicitada: 10,
      subtotal: 900,
      faltante: false,
    },
    {
      pedidoItemId: 'item2',
      descripcion: 'Arena',
      proveedor: 'Rodex',
      supplierId: 'p1',
      precioUnitario: 50,
      cantidadCotizada: 5,
      cantidadSolicitada: 5,
      subtotal: 250,
      faltante: false,
    },
    {
      pedidoItemId: 'item2',
      descripcion: 'Arena',
      proveedor: 'Coeco',
      supplierId: 'p2',
      precioUnitario: null,
      cantidadCotizada: null,
      cantidadSolicitada: 5,
      subtotal: null,
      faltante: true,
    },
  ],
};

describe('AdjudicacionPanel', () => {
  it('exige un proveedor ganador por item antes de habilitar la confirmacion', () => {
    const onConfirmar = vi.fn();
    render(<AdjudicacionPanel comparativo={comparativo} onConfirmar={onConfirmar} />);

    fireEvent.click(screen.getByRole('button', { name: 'Adjudicar' }));

    expect(screen.getByRole('alert').textContent).toMatch(/asigna un proveedor ganador para todos los items/i);
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  it('solo ofrece proveedores con precio para ese item', () => {
    render(<AdjudicacionPanel comparativo={comparativo} onConfirmar={vi.fn()} />);

    const selects = screen.getAllByRole('combobox');
    const opcionesItem2 = Array.from(selects[1]!.querySelectorAll('option')).map((o) => o.textContent);
    expect(opcionesItem2.some((texto) => texto?.includes('Coeco'))).toBe(false);
    expect(opcionesItem2.some((texto) => texto?.includes('Rodex'))).toBe(true);
  });

  it('agrupa las asignaciones por proveedor al confirmar', async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    render(<AdjudicacionPanel comparativo={comparativo} onConfirmar={onConfirmar} />);

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0]!, { target: { value: 'p2' } }); // item1 -> Coeco
    fireEvent.change(selects[1]!, { target: { value: 'p1' } }); // item2 -> Rodex

    fireEvent.click(screen.getByRole('button', { name: 'Adjudicar' }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar adjudicacion/i }));

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
    expect(onConfirmar).toHaveBeenCalledWith([
      { supplierId: 'p2', pedidoItemIds: ['item1'] },
      { supplierId: 'p1', pedidoItemIds: ['item2'] },
    ]);
  });
});
