import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProveedorForm from './ProveedorForm';
import { crearProveedor } from '../../api/cliente';
import { instalarFetchMock } from '../../test/mockFetch';

describe('ProveedorForm', () => {
  it('valida que el nombre sea obligatorio y no invoca onGuardar', () => {
    const onGuardar = vi.fn();
    render(<ProveedorForm onGuardar={onGuardar} />);

    fireEvent.click(screen.getByRole('button', { name: /crear proveedor/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/nombre es obligatorio/i);
    expect(onGuardar).not.toHaveBeenCalled();
  });

  it('envia el shape correcto con el header X-Portal-CSRF al crear', async () => {
    const fetchMock = instalarFetchMock((url) => {
      const ruta = new URL(url, 'http://localhost').pathname;
      if (ruta === '/api/portal/proveedores') {
        return {
          status: 200,
          body: {
            id: 'p1',
            nombre: 'Rodex',
            cedulaJuridica: null,
            categorias: ['cemento'],
            activo: true,
            notas: null,
            contactos: [],
          },
        };
      }
      return { status: 404, body: { error: 'no_mock' } };
    });

    render(
      <ProveedorForm
        onGuardar={(datos) =>
          crearProveedor({
            nombre: datos.nombre,
            cedulaJuridica: datos.cedulaJuridica ?? undefined,
            categorias: datos.categorias,
            notas: datos.notas ?? undefined,
          })
        }
      />,
    );

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Rodex' } });
    const categoriasInput = screen.getByLabelText('Categorias');
    fireEvent.change(categoriasInput, { target: { value: 'cemento' } });
    fireEvent.keyDown(categoriasInput, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: /crear proveedor/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/portal/proveedores');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-Portal-CSRF')).toBe('1');
    expect(JSON.parse(init.body as string)).toEqual({
      nombre: 'Rodex',
      categorias: ['cemento'],
    });
  });
});
