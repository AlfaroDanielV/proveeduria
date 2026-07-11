import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PedidoDetalle from './PedidoDetalle';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { instalarFetchMock } from '../../test/mockFetch';
import type { EstadoPedido, Rol, Usuario } from '../../types';

function rutaDe(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function usuarioCon(roles: readonly Rol[]): Usuario {
  return { userId: 'u1', nombre: 'Usuario de prueba', email: 'u@atemporal.cr', roles, projectIds: [] };
}

function instalarMocks(estado: EstadoPedido): void {
  instalarFetchMock((url) => {
    const ruta = rutaDe(url);
    if (ruta === '/api/portal/me') return { status: 401, body: {} };
    if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
    if (ruta === '/api/portal/pedidos/ped1') {
      return {
        status: 200,
        body: {
          pedido: {
            id: 'ped1',
            numero: 'PED-2026-001',
            estado,
            proyecto: { id: 'proj1', nombre: 'Proyecto Uno', codigo: 'PRY-01' },
            solicitante: { userId: 'u2', nombre: 'Solicitante' },
            fechaRequerida: null,
            urgencia: 'normal',
            plazoCotizacionAt: null,
            itemsCount: 1,
            rfqsTotal: 1,
            rfqsRespondidas: 1,
            revisionesPendientes: 0,
          },
          items: [{ descripcion: 'Cemento', cantidad: 10, unidad: 'saco' }],
          quoteRequests: [],
        },
      };
    }
    if (ruta === '/api/portal/pedidos/ped1/comparativo') {
      return {
        status: 200,
        body: {
          pedido: { id: 'ped1', numero: 'PED-2026-001', estado },
          resumenProveedores: [],
          filas:
            estado === 'en_revision'
              ? [
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
                ]
              : [],
        },
      };
    }
    if (ruta === '/api/portal/pedidos/ped1/aprobaciones') {
      return { status: 200, body: { items: [] } };
    }
    if (ruta === '/api/portal/proveedores') {
      return { status: 200, body: { items: [], total: 0, limit: 100, offset: 0 } };
    }
    return { status: 404, body: { error: 'no_mock', ruta } };
  });
}

function renderDetalle(estado: EstadoPedido, roles: readonly Rol[]) {
  instalarMocks(estado);
  return render(
    <ToastProvider>
      <AuthProvider>
        <PedidoDetalle pedidoId="ped1" usuario={usuarioCon(roles)} />
      </AuthProvider>
    </ToastProvider>,
  );
}

describe('PedidoDetalle - acciones de aprobacion segun estado y rol', () => {
  it('borrador + admin_materiales muestra "Enviar RFQs"', async () => {
    renderDetalle('borrador', ['admin_materiales']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Enviar RFQs' })).toBeTruthy();
  });

  it('borrador + bodeguero NO muestra "Enviar RFQs"', async () => {
    renderDetalle('borrador', ['bodeguero']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Enviar RFQs' })).toBeNull();
  });

  it('en_revision + superadmin muestra "Adjudicar ganador"', async () => {
    renderDetalle('en_revision', ['superadmin']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Adjudicar ganador' })).toBeTruthy();
  });

  it('en_revision + ingeniero NO muestra "Adjudicar ganador"', async () => {
    renderDetalle('en_revision', ['ingeniero']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Adjudicar ganador' })).toBeNull();
  });

  it('aprobado + admin_materiales muestra "Emitir OC(s)"', async () => {
    renderDetalle('aprobado', ['admin_materiales']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Emitir OC(s)' })).toBeTruthy();
  });

  it('aprobado + bodeguero NO muestra "Emitir OC(s)"', async () => {
    renderDetalle('aprobado', ['bodeguero']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Emitir OC(s)' })).toBeNull();
  });

  it('siempre muestra el historial de aprobaciones, sin importar estado/rol', async () => {
    renderDetalle('cotizando', ['bodeguero']);
    await waitFor(() => expect(screen.getByText('PED-2026-001')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Historial de aprobaciones' })).toBeTruthy();
  });
});
