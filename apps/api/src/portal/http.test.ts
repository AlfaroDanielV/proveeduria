import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import {
  CuerpoDemasiadoGrandeError,
  JsonInvalidoError,
  cookieDeBorrado,
  leerCuerpoJson,
  parseCookies,
  primerHeader,
  serializeCookie,
} from './http.js';

class FakeReq extends EventEmitter {
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }

  enviar(chunks: string[]): void {
    for (const chunk of chunks) this.emit('data', Buffer.from(chunk, 'utf8'));
    this.emit('end');
  }
}

describe('leerCuerpoJson', () => {
  it('parsea un body JSON valido', async () => {
    const req = new FakeReq();
    const promise = leerCuerpoJson(req as never, 1024);
    req.enviar(['{"a":1', ',"b":2}']);
    await expect(promise).resolves.toEqual({ a: 1, b: 2 });
  });

  it('body vacio resuelve a objeto vacio', async () => {
    const req = new FakeReq();
    const promise = leerCuerpoJson(req as never, 1024);
    req.enviar(['']);
    await expect(promise).resolves.toEqual({});
  });

  it('rechaza JSON invalido', async () => {
    const req = new FakeReq();
    const promise = leerCuerpoJson(req as never, 1024);
    req.enviar(['{no-es-json']);
    await expect(promise).rejects.toBeInstanceOf(JsonInvalidoError);
  });

  it('rechaza cuerpos que exceden el limite y destruye el socket', async () => {
    const req = new FakeReq();
    const promise = leerCuerpoJson(req as never, 4);
    req.enviar(['12345']);
    await expect(promise).rejects.toBeInstanceOf(CuerpoDemasiadoGrandeError);
    expect(req.destroyed).toBe(true);
  });
});

describe('parseCookies', () => {
  it('parsea multiples cookies', () => {
    expect(parseCookies('portal_token=abc; portal_refresh=xyz')).toEqual({
      portal_token: 'abc',
      portal_refresh: 'xyz',
    });
  });

  it('header ausente da mapa vacio', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('tolera formato invalido sin lanzar', () => {
    expect(parseCookies('sin-signo-igual; ;valida=1')).toEqual({ valida: '1' });
  });
});

describe('serializeCookie / cookieDeBorrado', () => {
  it('incluye Secure solo si se pide', () => {
    const dev = serializeCookie('portal_token', 'abc', { maxAgeSeconds: 900, secure: false });
    const prod = serializeCookie('portal_token', 'abc', { maxAgeSeconds: 900, secure: true });
    expect(dev).not.toContain('Secure');
    expect(prod).toContain('Secure');
    expect(dev).toContain('Path=/api/portal');
    expect(dev).toContain('HttpOnly');
    expect(dev).toContain('SameSite=Strict');
    expect(dev).toContain('Max-Age=900');
  });

  it('cookieDeBorrado usa Max-Age=0', () => {
    expect(cookieDeBorrado('portal_refresh', false)).toContain('Max-Age=0');
  });
});

describe('primerHeader', () => {
  it('devuelve el primer valor de un array', () => {
    expect(primerHeader(['1', '2'])).toBe('1');
  });

  it('devuelve el string directo', () => {
    expect(primerHeader('1')).toBe('1');
  });

  it('devuelve undefined si no hay valor', () => {
    expect(primerHeader(undefined)).toBeUndefined();
  });
});
