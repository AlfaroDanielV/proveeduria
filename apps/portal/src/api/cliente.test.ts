import { describe, expect, it } from 'vitest';
import { ApiError, SesionExpiradaError, cambiarPassword, listarPedidos, login } from './cliente';
import { instalarFetchMock } from '../test/mockFetch';

function rutaDe(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

describe('cliente API - reintento de sesion', () => {
  it('reintenta una vez tras 401 y devuelve el resultado si el refresh funciona', async () => {
    let llamadasPedidos = 0;
    let llamadasRefresh = 0;
    const fetchMock = instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/pedidos') {
        llamadasPedidos += 1;
        if (llamadasPedidos === 1) return { status: 401, body: { error: 'auth_requerida' } };
        return { status: 200, body: { items: [], total: 0, limit: 25, offset: 0 } };
      }
      if (ruta === '/api/portal/auth/refresh') {
        llamadasRefresh += 1;
        return { status: 200, body: {} };
      }
      return { status: 404, body: {} };
    });

    const resultado = await listarPedidos();

    expect(resultado.items).toEqual([]);
    expect(llamadasRefresh).toBe(1);
    expect(llamadasPedidos).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lanza SesionExpiradaError si el refresh tambien devuelve 401', async () => {
    instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/pedidos') return { status: 401, body: {} };
      if (ruta === '/api/portal/auth/refresh') return { status: 401, body: {} };
      return { status: 404, body: {} };
    });

    await expect(listarPedidos()).rejects.toBeInstanceOf(SesionExpiradaError);
  });

  it('login no reintenta con refresh: un 401 es credencial invalida', async () => {
    const fetchMock = instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/auth/login') return { status: 401, body: { error: 'credenciales_invalidas' } };
      return { status: 404, body: {} };
    });

    await expect(login('a@b.com', 'mala')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('las mutaciones envian el header X-Portal-CSRF', async () => {
    const fetchMock = instalarFetchMock((url) => {
      const ruta = rutaDe(url);
      if (ruta === '/api/portal/auth/cambiar-password') return { status: 204 };
      return { status: 404, body: {} };
    });

    await cambiarPassword('actual123', 'nueva12345');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-Portal-CSRF')).toBe('1');
    expect(init.method).toBe('POST');
  });
});
