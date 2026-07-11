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

function sobreStatuses(statuses: unknown[]): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses } }],
      },
    ],
  };
}

const VACIO = { mensajes: [], statuses: [] };

describe('parseMeta - mensajes', () => {
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
    expect(out.mensajes).toHaveLength(1);
    expect(out.mensajes[0]).toMatchObject({
      wamid: 'wamid.TEXT1',
      from: '50688887777',
      tipo: 'texto',
      texto: 'necesito 10 sacos de cemento',
      timestamp: '1700000000',
    });
    expect(out.mensajes[0]?.adjunto).toBeUndefined();
    expect(out.statuses).toEqual([]);
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
    expect(out.mensajes).toHaveLength(1);
    expect(out.mensajes[0]?.tipo).toBe('imagen');
    expect(out.mensajes[0]?.texto).toBe('la boleta');
    expect(out.mensajes[0]?.adjunto).toMatchObject({
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
    expect(out.mensajes[0]?.adjunto).toMatchObject({
      mediaId: 'DOC9',
      nombreArchivo: 'factura.pdf',
      fuente: 'pdf',
    });
  });

  it('mapea audio/voice a fuente audio', () => {
    const out = parseMeta(
      sobre([{ from: '5061', id: 'wamid.AUD1', type: 'audio', audio: { id: 'AUD9', voice: true } }]),
    );
    expect(out.mensajes[0]?.tipo).toBe('audio');
    expect(out.mensajes[0]?.adjunto).toMatchObject({ mediaId: 'AUD9', fuente: 'audio' });
  });

  it('marca tipos desconocidos sin crashear', () => {
    const out = parseMeta(
      sobre([{ from: '5061', id: 'wamid.X', type: 'sarasa', sarasa: { foo: 1 } }]),
    );
    expect(out.mensajes[0]?.tipo).toBe('desconocido');
  });

  it('recolecta mensajes de varios entries/changes', () => {
    const payload = {
      entry: [
        { changes: [{ value: { messages: [{ from: 'a', id: 'w1', type: 'text', text: { body: 'x' } }] } }] },
        { changes: [{ value: { messages: [{ from: 'b', id: 'w2', type: 'text', text: { body: 'y' } }] } }] },
      ],
    };
    const out = parseMeta(payload);
    expect(out.mensajes.map((m) => m.wamid)).toEqual(['w1', 'w2']);
  });

  it('descarta mensajes sin id o sin from', () => {
    const out = parseMeta(
      sobre([
        { from: 'a', type: 'text', text: { body: 'sin id' } },
        { id: 'w3', type: 'text', text: { body: 'sin from' } },
        { from: 'a', id: 'w4', type: 'text', text: { body: 'ok' } },
      ]),
    );
    expect(out.mensajes.map((m) => m.wamid)).toEqual(['w4']);
  });

  it('devuelve mensajes [] para payloads de solo estados (sin messages)', () => {
    const out = parseMeta({
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.s', status: 'delivered' }] } }] }],
    });
    expect(out.mensajes).toEqual([]);
    expect(out.statuses).toHaveLength(1);
  });

  it('no crashea con payloads malformados', () => {
    expect(parseMeta(null)).toEqual(VACIO);
    expect(parseMeta(undefined)).toEqual(VACIO);
    expect(parseMeta(42)).toEqual(VACIO);
    expect(parseMeta('texto')).toEqual(VACIO);
    expect(parseMeta({})).toEqual(VACIO);
    expect(parseMeta({ entry: 'no-es-array' })).toEqual(VACIO);
    expect(parseMeta({ entry: [{ changes: 'x' }] })).toEqual(VACIO);
    expect(parseMeta({ entry: [{ changes: [{ value: { messages: 'x' } }] }] })).toEqual(VACIO);
    expect(parseMeta({ entry: [null, 7, { changes: [null, { value: null }] }] })).toEqual(VACIO);
  });
});

describe('parseMeta - statuses', () => {
  it('normaliza un status delivered', () => {
    const out = parseMeta(
      sobreStatuses([
        {
          id: 'wamid.OUT1',
          status: 'delivered',
          timestamp: '1700000001',
          recipient_id: '50688887777',
        },
      ]),
    );
    expect(out.mensajes).toEqual([]);
    expect(out.statuses).toHaveLength(1);
    expect(out.statuses[0]).toMatchObject({
      wamid: 'wamid.OUT1',
      estado: 'delivered',
      timestamp: '1700000001',
      recipientId: '50688887777',
    });
    expect(out.statuses[0]?.errores).toBeUndefined();
  });

  it('normaliza sent/read/failed y guarda errors crudo en failed', () => {
    const errors = [{ code: 131047, title: 'fuera de ventana de 24h' }];
    const out = parseMeta(
      sobreStatuses([
        { id: 'w1', status: 'sent' },
        { id: 'w2', status: 'read' },
        { id: 'w3', status: 'failed', errors },
      ]),
    );
    expect(out.statuses.map((s) => s.estado)).toEqual(['sent', 'read', 'failed']);
    expect(out.statuses[2]?.errores).toEqual(errors);
    expect(out.statuses[0]?.errores).toBeUndefined();
  });

  it('ignora un status con estado desconocido', () => {
    const out = parseMeta(sobreStatuses([{ id: 'w1', status: 'clicked' }]));
    expect(out.statuses).toEqual([]);
  });

  it('descarta statuses sin id o sin status', () => {
    const out = parseMeta(
      sobreStatuses([{ status: 'sent' }, { id: 'w1' }, { id: 'w2', status: 'sent' }]),
    );
    expect(out.statuses.map((s) => s.wamid)).toEqual(['w2']);
  });

  it('payload mixto: separa mensajes y statuses del mismo change', () => {
    const out = parseMeta({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: 'a', id: 'wIN', type: 'text', text: { body: 'hola' } }],
                statuses: [{ id: 'wOUT', status: 'sent' }],
              },
            },
          ],
        },
      ],
    });
    expect(out.mensajes.map((m) => m.wamid)).toEqual(['wIN']);
    expect(out.statuses.map((s) => s.wamid)).toEqual(['wOUT']);
  });
});
