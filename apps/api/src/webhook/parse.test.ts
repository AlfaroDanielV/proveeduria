import { describe, expect, it } from 'vitest';

import { parseMeta } from './parse.js';

function sobre(messages: unknown[]): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages } }],
      },
    ],
  };
}

describe('parseMeta', () => {
  it('normaliza un mensaje de texto', () => {
    const out = parseMeta(
      sobre([
        {
          from: '50688887777',
          id: 'wamid.TEXT1',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'necesito 10 sacos de cemento' },
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      wamid: 'wamid.TEXT1',
      from: '50688887777',
      tipo: 'texto',
      texto: 'necesito 10 sacos de cemento',
      timestamp: '1700000000',
    });
    expect(out[0]?.adjunto).toBeUndefined();
  });

  it('normaliza una imagen con caption y fuente imagen', () => {
    const out = parseMeta(
      sobre([
        {
          from: '50611112222',
          id: 'wamid.IMG1',
          type: 'image',
          image: { id: 'MEDIA123', mime_type: 'image/jpeg', sha256: 'abc', caption: 'la boleta' },
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.tipo).toBe('imagen');
    expect(out[0]?.texto).toBe('la boleta');
    expect(out[0]?.adjunto).toMatchObject({
      mediaId: 'MEDIA123',
      mimeType: 'image/jpeg',
      sha256: 'abc',
      fuente: 'imagen',
    });
  });

  it('mapea un documento a fuente pdf', () => {
    const out = parseMeta(
      sobre([
        {
          from: '50611112222',
          id: 'wamid.DOC1',
          type: 'document',
          document: { id: 'DOC9', mime_type: 'application/pdf', filename: 'factura.pdf' },
        },
      ]),
    );
    expect(out[0]?.adjunto).toMatchObject({
      mediaId: 'DOC9',
      nombreArchivo: 'factura.pdf',
      fuente: 'pdf',
    });
  });

  it('mapea audio/voice a fuente audio', () => {
    const out = parseMeta(
      sobre([{ from: '5061', id: 'wamid.AUD1', type: 'audio', audio: { id: 'AUD9', voice: true } }]),
    );
    expect(out[0]?.tipo).toBe('audio');
    expect(out[0]?.adjunto).toMatchObject({ mediaId: 'AUD9', fuente: 'audio' });
  });

  it('marca tipos desconocidos sin crashear', () => {
    const out = parseMeta(
      sobre([{ from: '5061', id: 'wamid.X', type: 'sarasa', sarasa: { foo: 1 } }]),
    );
    expect(out[0]?.tipo).toBe('desconocido');
  });

  it('recolecta mensajes de varios entries/changes', () => {
    const payload = {
      entry: [
        { changes: [{ value: { messages: [{ from: 'a', id: 'w1', type: 'text', text: { body: 'x' } }] } }] },
        { changes: [{ value: { messages: [{ from: 'b', id: 'w2', type: 'text', text: { body: 'y' } }] } }] },
      ],
    };
    const out = parseMeta(payload);
    expect(out.map((m) => m.wamid)).toEqual(['w1', 'w2']);
  });

  it('descarta mensajes sin id o sin from', () => {
    const out = parseMeta(
      sobre([
        { from: 'a', type: 'text', text: { body: 'sin id' } },
        { id: 'w3', type: 'text', text: { body: 'sin from' } },
        { from: 'a', id: 'w4', type: 'text', text: { body: 'ok' } },
      ]),
    );
    expect(out.map((m) => m.wamid)).toEqual(['w4']);
  });

  it('devuelve [] para payloads de solo estados (sin messages)', () => {
    const out = parseMeta({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.s', status: 'delivered' }] } }] }],
    });
    expect(out).toEqual([]);
  });

  it('no crashea con payloads malformados', () => {
    expect(parseMeta(null)).toEqual([]);
    expect(parseMeta(undefined)).toEqual([]);
    expect(parseMeta(42)).toEqual([]);
    expect(parseMeta('texto')).toEqual([]);
    expect(parseMeta({})).toEqual([]);
    expect(parseMeta({ entry: 'no-es-array' })).toEqual([]);
    expect(parseMeta({ entry: [{ changes: 'x' }] })).toEqual([]);
    expect(parseMeta({ entry: [{ changes: [{ value: { messages: 'x' } }] }] })).toEqual([]);
    expect(parseMeta({ entry: [null, 7, { changes: [null, { value: null }] }] })).toEqual([]);
  });
});
