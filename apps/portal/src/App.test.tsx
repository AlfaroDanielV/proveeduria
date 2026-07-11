import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { instalarFetchMock } from './test/mockFetch';
import type { Usuario } from './types';

function rutaDe(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

async function completarLogin(identificador: string, password: string): Promise<void> {
  const usuarioInput = await screen.findByLabelText('Usuario');
  fireEvent.change(usuarioInput, { target: { value: identificador } });
  fireEvent.change(screen.getByLabelText('Contrasena'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));
}

describe('flujo de autenticacion', () => {
  it('login feliz muestra el shell con la sesion activa', async () => {
    const usuario: Usuario = {
      userId: 'u1',
      nombre: 'Jose Pablo (Proveeduria)',
      email: 'proveeduria@atemporal.cr',
      roles: ['admin_materiales'],
      projectIds: [],
    };

    instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/me') return { status: 401, body: { error: 'auth_requerida' } };
      if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/login') {
        return { status: 200, body: { user: usuario, mustChangePassword: false } };
      }
      if (ruta === '/api/portal/pedidos') return { status: 200, body: { items: [], total: 0, limit: 25, offset: 0 } };
      return { status: 404, body: { error: 'no_mock', ruta } };
    });

    render(<App />);
    await completarLogin('proveeduria@atemporal.cr', 'clave-correcta');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pedidos' })).toBeTruthy();
    });
    expect(screen.getByText(/Jose Pablo \(Proveeduria\)/)).toBeTruthy();
  });

  it('mustChangePassword=true redirige a la pantalla de cambio de contrasena', async () => {
    const usuario: Usuario = {
      userId: 'u2',
      nombre: 'Usuario Nuevo',
      email: 'nuevo@atemporal.cr',
      roles: ['ingeniero'],
      projectIds: [],
    };

    instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/me') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/login') {
        return { status: 200, body: { user: usuario, mustChangePassword: true } };
      }
      return { status: 404, body: { error: 'no_mock', ruta } };
    });

    render(<App />);
    await completarLogin('nuevo@atemporal.cr', 'temporal123');

    await waitFor(() => {
      expect(screen.getByText('Cambia tu contrasena')).toBeTruthy();
    });
    expect(screen.queryByText('Pedidos')).toBeNull();
  });

  it('credenciales invalidas muestran un error uniforme sin navegar', async () => {
    instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/me') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/login') return { status: 401, body: { error: 'credenciales_invalidas' } };
      return { status: 404, body: { error: 'no_mock', ruta } };
    });

    render(<App />);
    await completarLogin('desconocido@atemporal.cr', 'lo-que-sea');

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/no pudimos iniciar sesion/i);
    });
  });
});
