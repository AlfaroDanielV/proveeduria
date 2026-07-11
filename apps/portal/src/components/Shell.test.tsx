import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Shell from './Shell';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { instalarFetchMock } from '../test/mockFetch';
import type { Usuario } from '../types';

function rutaDe(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function renderShell(usuario: Usuario) {
  instalarFetchMock((url) => {
    const ruta = rutaDe(url);
    if (ruta === '/api/portal/me') return { status: 401, body: {} };
    if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
    if (ruta === '/api/portal/pedidos') return { status: 200, body: { items: [], total: 0, limit: 25, offset: 0 } };
    return { status: 404, body: { error: 'no_mock', ruta } };
  });

  return render(
    <ToastProvider>
      <AuthProvider>
        <Shell usuario={usuario} />
      </AuthProvider>
    </ToastProvider>,
  );
}

function usuarioCon(roles: Usuario['roles']): Usuario {
  return { userId: 'u1', nombre: 'Usuario de prueba', email: 'u@atemporal.cr', roles, projectIds: [] };
}

describe('menu del Shell segun rol', () => {
  it('bodeguero solo ve Pedidos', () => {
    renderShell(usuarioCon(['bodeguero']));
    expect(screen.getByRole('button', { name: 'Pedidos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Proveedores' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisiones' })).toBeNull();
  });

  it('admin_equipos ve Proveedores pero no Revisiones', () => {
    renderShell(usuarioCon(['admin_equipos']));
    expect(screen.getByRole('button', { name: 'Pedidos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Proveedores' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revisiones' })).toBeNull();
  });

  it('admin_materiales ve Proveedores y Revisiones', () => {
    renderShell(usuarioCon(['admin_materiales']));
    expect(screen.getByRole('button', { name: 'Proveedores' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisiones' })).toBeTruthy();
  });

  it('superadmin ve las tres pantallas', () => {
    renderShell(usuarioCon(['superadmin']));
    expect(screen.getByRole('button', { name: 'Pedidos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Proveedores' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revisiones' })).toBeTruthy();
  });
});
