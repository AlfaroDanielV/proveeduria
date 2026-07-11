/**
 * Tests de `firmarLinkAttachment` (JWT HS256 minimo para el link de attachments).
 */

import { describe, expect, it } from 'vitest';
import { firmarLinkAttachment } from './attachment-link.js';

function decodificarPayload(jwt: string): Record<string, unknown> {
  const partes = jwt.split('.');
  expect(partes).toHaveLength(3);
  const payloadB64 = partes[1] as string;
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('firmarLinkAttachment', () => {
  it('arma la URL con el path/atributos esperados y un JWT de 3 partes', () => {
    const url = firmarLinkAttachment({
      attachmentId: 'attach-1',
      secreto: 'shh',
      ahora: new Date('2026-07-10T12:00:00Z'),
      publicApiUrl: 'https://api.example.com',
    });

    expect(url.startsWith('https://api.example.com/api/attachments/attach-1?f=')).toBe(true);
    const jwt = url.split('?f=')[1] as string;
    expect(jwt.split('.')).toHaveLength(3);
  });

  it('tolera publicApiUrl con / final', () => {
    const url = firmarLinkAttachment({
      attachmentId: 'attach-1',
      secreto: 'shh',
      ahora: new Date('2026-07-10T12:00:00Z'),
      publicApiUrl: 'https://api.example.com/',
    });

    expect(url.startsWith('https://api.example.com/api/attachments/attach-1?f=')).toBe(true);
    expect(url).not.toContain('.com//api');
  });

  it('el JWT decodifica con sub=attachmentId y exp-iat = 72h por defecto', () => {
    const ahora = new Date('2026-07-10T12:00:00Z');
    const url = firmarLinkAttachment({
      attachmentId: 'attach-xyz',
      secreto: 'shh',
      ahora,
      publicApiUrl: 'https://api.example.com',
    });
    const jwt = url.split('?f=')[1] as string;
    const payload = decodificarPayload(jwt);

    expect(payload.sub).toBe('attach-xyz');
    expect(payload.iat).toBe(Math.floor(ahora.getTime() / 1000));
    expect((payload.exp as number) - (payload.iat as number)).toBe(72 * 3600);
  });

  it('respeta vidaSegundos explicito', () => {
    const ahora = new Date('2026-07-10T12:00:00Z');
    const url = firmarLinkAttachment({
      attachmentId: 'attach-xyz',
      secreto: 'shh',
      ahora,
      vidaSegundos: 3600,
      publicApiUrl: 'https://api.example.com',
    });
    const jwt = url.split('?f=')[1] as string;
    const payload = decodificarPayload(jwt);

    expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
  });

  it('secretos distintos producen firmas distintas para el mismo payload', () => {
    const ahora = new Date('2026-07-10T12:00:00Z');
    const url1 = firmarLinkAttachment({
      attachmentId: 'attach-1',
      secreto: 'secreto-a',
      ahora,
      publicApiUrl: 'https://api.example.com',
    });
    const url2 = firmarLinkAttachment({
      attachmentId: 'attach-1',
      secreto: 'secreto-b',
      ahora,
      publicApiUrl: 'https://api.example.com',
    });

    const firma1 = (url1.split('?f=')[1] as string).split('.')[2];
    const firma2 = (url2.split('?f=')[1] as string).split('.')[2];
    expect(firma1).not.toBe(firma2);
  });
});
