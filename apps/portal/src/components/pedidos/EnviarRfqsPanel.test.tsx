import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EnviarRfqsPanel from './EnviarRfqsPanel';
import { enviarRfqs } from '../../api/cliente';
import { instalarFetchMock } from '../../test/mockFetch';
import type { Proveedor } from '../../types';

function proveedor(id: string, nombre: string, conOptIn: boolean): Proveedor {
  return {
    id,
    nombre,
    cedulaJuridica: null,
    categorias: [],
    activo: true,
    notas: null,
    contactos: [
      {
        id: `${id}-c1`,
        nombre: 'Contacto',
        telefonoWhatsapp: '+50600000000',
        esPrincipal: true,
        optinAt: conOptIn ? '2026-01-01T00:00:00.000Z' : null,
      },
    ],
  };
}

function instalarMockProveedores() {
  return instalarFetchMock((url) => {
    const ruta = new URL(url, 'http://localhost').pathname;
    if (ruta === '/api/portal/proveedores') {
      return {
        status: 200,
        body: {
          items: [proveedor('p1', 'Rodex', true), proveedor('p2', 'Sin Optin', false)],
          total: 2,
          limit: 100,
          offset: 0,
        },
      };
    }
    if (ruta === '/api/portal/pedidos/ped1/rfqs') {
      return { status: 200, body: { pedidoId: 'ped1', estado: 'cotizando', rfqs: 1 } };
    }
    return { status: 404, body: { error: 'no_mock', ruta } };
  });
}

describe('EnviarRfqsPanel', () => {
  it('solo lista proveedores activos con contacto opt-in', async () => {
    instalarMockProveedores();
    render(<EnviarRfqsPanel onConfirmar={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Rodex')).toBeTruthy());
    expect(screen.queryByText('Sin Optin')).toBeNull();
  });

  it('exige al menos un proveedor seleccionado antes de confirmar', async () => {
    instalarMockProveedores();
    render(<EnviarRfqsPanel onConfirmar={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Rodex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar RFQs' }));

    expect(screen.getByRole('alert').textContent).toMatch(/selecciona al menos un proveedor/i);
  });

  it('manda el shape correcto con el header X-Portal-CSRF al confirmar', async () => {
    const fetchMock = instalarMockProveedores();
    render(
      <EnviarRfqsPanel
        onConfirmar={(supplierIds, plazoHoras) => enviarRfqs('ped1', { supplierIds, plazoHoras })}
      />,
    );

    await waitFor(() => expect(screen.getByText('Rodex')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Rodex'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar RFQs' }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar envio/i }));

    await waitFor(() => {
      const llamada = fetchMock.mock.calls.find(
        ([u]) => new URL(u as string, 'http://localhost').pathname === '/api/portal/pedidos/ped1/rfqs',
      );
      expect(llamada).toBeTruthy();
    });

    const [, init] = fetchMock.mock.calls.find(
      ([u]) => new URL(u as string, 'http://localhost').pathname === '/api/portal/pedidos/ped1/rfqs',
    ) as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-Portal-CSRF')).toBe('1');
    expect(JSON.parse(init.body as string)).toEqual({ supplierIds: ['p1'], plazoHoras: 24 });
  });
});
