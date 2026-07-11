import { describe, expect, it } from 'vitest';
import { crearFakeRepos, FakeToolStore } from '@proveeduria/agent';
import { descargarMediaMeta, procesarMediaInbound } from './media.js';
import type { InboundMessage } from './types.js';

const AHORA = new Date('2026-07-10T12:00:00.000Z');

function mensajeImagen(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    wamid: 'wamid.img',
    fromPhone: '+50688881001',
    tipo: 'imagen',
    payload: { type: 'image', image: { id: 'MEDIA123', mime_type: 'image/jpeg' } },
    receivedAt: AHORA,
    processedAt: null,
    ...overrides,
  };
}

/** Response minima para el fetch fake. */
function resp(init: { ok: boolean; status?: number; json?: unknown; bytes?: Buffer }): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: async () => init.json,
    arrayBuffer: async () => new Uint8Array(init.bytes ?? Buffer.alloc(0)).buffer,
  } as unknown as Response;
}

describe('descargarMediaMeta', () => {
  it('hace los dos saltos (metadata -> URL efimera -> bytes) con el Bearer', async () => {
    const bytes = Buffer.from('foto-cotizacion');
    const urls: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const url = String(input);
      urls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
      if (url === 'https://graph/v23/MEDIA123') {
        return resp({ ok: true, json: { url: 'https://cdn/blob-1', mime_type: 'image/jpeg' } });
      }
      return resp({ ok: true, bytes });
    }) as typeof fetch;

    const media = await descargarMediaMeta({
      mediaId: 'MEDIA123',
      accessToken: 'TOKEN',
      graphUrl: 'https://graph/v23',
      fetchImpl,
    });

    expect(urls).toEqual(['https://graph/v23/MEDIA123', 'https://cdn/blob-1']);
    expect(media.mimeType).toBe('image/jpeg');
    expect(media.bytes.equals(bytes)).toBe(true);
  });
});

describe('procesarMediaInbound', () => {
  it('descarga, persiste el attachment y fija inbound_messages.attachment_id', async () => {
    const store = new FakeToolStore();
    const bytes = Buffer.from('foto-cotizacion');
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      return String(input).includes('/MEDIA123')
        ? resp({ ok: true, json: { url: 'https://cdn/blob-1', mime_type: 'image/jpeg' } })
        : resp({ ok: true, bytes });
    }) as typeof fetch;

    const adjunto = await procesarMediaInbound({
      tx: store.tx,
      mensaje: mensajeImagen(),
      attachmentRepo: crearFakeRepos(store).attachments,
      config: { accessToken: 'TOKEN', graphUrl: 'https://graph/v23', fetchImpl },
      ahora: AHORA,
    });

    expect(adjunto).not.toBeNull();
    expect(adjunto?.fuente).toBe('imagen');
    expect(adjunto?.contentType).toBe('image/jpeg');
    expect(adjunto?.bytes.equals(bytes)).toBe(true);
    expect(store.attachments.size).toBe(1);
    expect([...store.attachmentBlobs.values()][0]?.equals(bytes)).toBe(true);
    const update = store.tx.queries.find((q) => q.sql.includes('UPDATE inbound_messages SET attachment_id'));
    expect(update?.params).toEqual(['70000000-0000-4000-8000-000000000001', adjunto?.attachmentId]);
  });

  it('sin token: audita media_sin_token y sigue sin attachment', async () => {
    const store = new FakeToolStore();
    const adjunto = await procesarMediaInbound({
      tx: store.tx,
      mensaje: mensajeImagen(),
      attachmentRepo: crearFakeRepos(store).attachments,
      config: { graphUrl: 'https://graph/v23' },
      ahora: AHORA,
    });

    expect(adjunto).toBeNull();
    expect(store.attachments.size).toBe(0);
    const audit = store.tx.queries.find((q) => q.sql.includes('INSERT INTO audit_events'));
    expect(audit?.params[0]).toBe('media_sin_token');
  });

  it('error de descarga: audita media_error y NO rompe el handler', async () => {
    const store = new FakeToolStore();
    const adjunto = await procesarMediaInbound({
      tx: store.tx,
      mensaje: mensajeImagen(),
      attachmentRepo: crearFakeRepos(store).attachments,
      config: { accessToken: 'TOKEN', graphUrl: 'https://graph/v23' },
      ahora: AHORA,
      descargar: async () => {
        throw new Error('boom');
      },
    });

    expect(adjunto).toBeNull();
    expect(store.attachments.size).toBe(0);
    const audit = store.tx.queries.find((q) => q.sql.includes('INSERT INTO audit_events'));
    expect(audit?.params[0]).toBe('media_error');
  });

  it('inbound sin media (texto): no-op, devuelve null sin tocar la tx', async () => {
    const store = new FakeToolStore();
    const adjunto = await procesarMediaInbound({
      tx: store.tx,
      mensaje: mensajeImagen({ tipo: 'texto', payload: { text: { body: 'hola' } } }),
      attachmentRepo: crearFakeRepos(store).attachments,
      config: { accessToken: 'TOKEN', graphUrl: 'https://graph/v23' },
      ahora: AHORA,
    });

    expect(adjunto).toBeNull();
    expect(store.tx.queries).toHaveLength(0);
  });
});
