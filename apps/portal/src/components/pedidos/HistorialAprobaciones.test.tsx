import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HistorialAprobaciones from './HistorialAprobaciones';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { instalarFetchMock } from '../../test/mockFetch';

function rutaDe(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function renderHistorial(recargarTrigger = 0) {
  return render(
    <ToastProvider>
      <AuthProvider>
        <HistorialAprobaciones pedidoId="ped1" recargarTrigger={recargarTrigger} />
      </AuthProvider>
    </ToastProvider>,
  );
}

describe('HistorialAprobaciones', () => {
  it('renderiza los tipos de evento y el detalle de asignaciones para "ganador"', async () => {
    instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/me') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
      if (ruta === '/api/portal/pedidos/ped1/aprobaciones') {
        return {
          status: 200,
          body: {
            items: [
              {
                id: 'ev1',
                tipo: 'lista_proveedores',
                aprobadoPor: { userId: 'u1', nombre: 'Ana' },
                canal: 'web',
                detalle: { supplierIds: ['p1'] },
                at: '2026-07-01T00:00:00.000Z',
              },
              {
                id: 'ev2',
                tipo: 'ganador',
                aprobadoPor: { userId: 'u1', nombre: 'Ana' },
                canal: 'web',
                detalle: {
                  // Forma real de `aprobar_ganador` (packages/agent/src/tools/adjudicacion.ts):
                  // las asignaciones NO traen nombre, viene del snapshot `comparativo.resumenProveedores`.
                  asignaciones: [{ supplierId: 'p1', pedidoItemIds: ['item1', 'item2'], quoteResponseId: 'qr1' }],
                  comparativo: {
                    pedidoId: 'ped1',
                    numero: 'PED-2026-001',
                    filas: [],
                    resumenProveedores: [{ supplierId: 'p1', nombre: 'Rodex' }],
                  },
                },
                at: '2026-07-02T00:00:00.000Z',
              },
            ],
          },
        };
      }
      return { status: 404, body: { error: 'no_mock', ruta } };
    });

    renderHistorial();

    await waitFor(() => expect(screen.getByText('lista proveedores')).toBeTruthy());
    expect(screen.getByText('ganador')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /ver asignaciones/i }));
    expect(screen.getByText(/Rodex: 2 item\(s\)/)).toBeTruthy();
  });

  it('muestra un mensaje vacio cuando no hay aprobaciones registradas', async () => {
    instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/me') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
      if (ruta === '/api/portal/pedidos/ped1/aprobaciones') return { status: 200, body: { items: [] } };
      return { status: 404, body: { error: 'no_mock', ruta } };
    });

    renderHistorial();

    await waitFor(() => expect(screen.getByText('Sin aprobaciones registradas.')).toBeTruthy());
  });
});
