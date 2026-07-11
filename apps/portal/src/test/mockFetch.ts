import { vi } from 'vitest';

export interface RespuestaMock {
  readonly status: number;
  readonly body?: unknown;
}

export type ManejadorFetch = (
  url: string,
  init: RequestInit | undefined,
) => RespuestaMock | Promise<RespuestaMock>;

/** Instala un `global.fetch` fake dirigido por `manejador` y devuelve el mock (para asserts). */
export function instalarFetchMock(manejador: ManejadorFetch) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const respuesta = await manejador(url, init);
    // Los status sin cuerpo (204/205/304) exigen body null: el constructor de Response
    // rechaza un string vacio como cuerpo para esos codigos.
    const sinCuerpo = respuesta.status === 204 || respuesta.status === 205 || respuesta.status === 304;
    const cuerpo = sinCuerpo || respuesta.body === undefined ? null : JSON.stringify(respuesta.body);
    return new Response(cuerpo, {
      status: respuesta.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
