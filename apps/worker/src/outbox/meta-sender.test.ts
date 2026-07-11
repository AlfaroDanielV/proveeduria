/**
 * Tests de `MetaOutboxSender` con `fetchImpl` fake (sin red).
 */

import { describe, expect, it, vi } from 'vitest';
import { ErrorEnvio } from './dispatcher.js';
import type { OutboxMessagePendiente } from './dispatcher.js';
import { MetaOutboxSender } from './meta-sender.js';

const GRAPH_URL = 'https://graph.facebook.com/v23.0';
const PHONE_NUMBER_ID = '1234567890';
const ACCESS_TOKEN = 'token-secreto';

function message(overrides: Partial<OutboxMessagePendiente> = {}): OutboxMessagePendiente {
  return {
    id: 'm1',
    destino: '+50688880002',
    template: null,
    texto: null,
    payload: {},
    intentos: 1,
    maxIntentos: 8,
    attachmentId: null,
    ...overrides,
  };
}

interface FakeResponseInit {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly conCuerpo?: boolean;
  readonly headers?: Record<string, string>;
}

function fakeResponse(init: FakeResponseInit): Response {
  const conCuerpo = init.conCuerpo ?? true;
  const headers = new Headers(init.headers ?? {});
  return {
    ok: init.ok,
    status: init.status,
    headers,
    json: async () => {
      if (!conCuerpo) throw new Error('sin cuerpo JSON');
      return init.body;
    },
  } as unknown as Response;
}

function sender(
  fetchImpl: typeof fetch,
  overrides: Partial<{
    graphUrl: string;
    publicApiUrl: string;
    attachmentsLinkSecret: string;
    ahora: () => Date;
  }> = {},
): MetaOutboxSender {
  return new MetaOutboxSender({
    graphUrl: overrides.graphUrl ?? GRAPH_URL,
    phoneNumberId: PHONE_NUMBER_ID,
    accessToken: ACCESS_TOKEN,
    fetchImpl,
    ...(overrides.publicApiUrl !== undefined ? { publicApiUrl: overrides.publicApiUrl } : {}),
    ...(overrides.attachmentsLinkSecret !== undefined
      ? { attachmentsLinkSecret: overrides.attachmentsLinkSecret }
      : {}),
    ...(overrides.ahora !== undefined ? { ahora: overrides.ahora } : {}),
  });
}

/** Sender con publicApiUrl/attachmentsLinkSecret configurados (camino attachment_id). */
function senderConAttachments(
  fetchImpl: typeof fetch,
  ahora: () => Date = () => new Date('2026-07-10T12:00:00Z'),
): MetaOutboxSender {
  return sender(fetchImpl, {
    publicApiUrl: 'https://api.example.com',
    attachmentsLinkSecret: 'secreto-compartido',
    ahora,
  });
}

function decodificarJwtDeLink(link: string): { readonly sub: string; readonly exp: number; readonly iat: number } {
  const jwt = link.split('?f=')[1] as string;
  const payloadB64 = jwt.split('.')[1] as string;
  return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
    sub: string;
    exp: number;
    iat: number;
  };
}

describe('MetaOutboxSender', () => {
  it('envia un texto simple con el body esperado', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.txt.1' }] } }),
    );

    const resultado = await sender(fetchImpl).enviar(
      message({ texto: 'Hola, tu pedido fue confirmado.' }),
    );

    expect(resultado).toEqual({ wamidSalida: 'wamid.txt.1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GRAPH_URL}/${PHONE_NUMBER_ID}/messages`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${ACCESS_TOKEN}`,
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '+50688880002',
      type: 'text',
      text: { body: 'Hola, tu pedido fue confirmado.' },
    });
  });

  it('envia una plantilla con variables: body exacto del POST', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.tpl.1' }] } }),
    );

    const resultado = await sender(fetchImpl).enviar(
      message({
        template: 'rfq_solicitud',
        payload: { variables: ['Juan', 'Proyecto X', 'items', '2026-07-10', 'PED-0001'] },
      }),
    );

    expect(resultado).toEqual({ wamidSalida: 'wamid.tpl.1' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '+50688880002',
      type: 'template',
      template: {
        name: 'rfq_solicitud',
        language: { code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Juan' },
              { type: 'text', text: 'Proyecto X' },
              { type: 'text', text: 'items' },
              { type: 'text', text: '2026-07-10' },
              { type: 'text', text: 'PED-0001' },
            ],
          },
        ],
      },
    });
  });

  it('envia una plantilla con documento: agrega el component header', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.tpl.2' }] } }),
    );

    const resultado = await sender(fetchImpl).enviar(
      message({
        template: 'oc_emitida',
        payload: {
          idioma: 'es_CR',
          variables: ['PED-0002'],
          documento: { link: 'https://blob/oc.pdf', filename: 'oc.pdf' },
        },
      }),
    );

    expect(resultado).toEqual({ wamidSalida: 'wamid.tpl.2' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '+50688880002',
      type: 'template',
      template: {
        name: 'oc_emitida',
        language: { code: 'es_CR' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: { link: 'https://blob/oc.pdf', filename: 'oc.pdf' },
              },
            ],
          },
          {
            type: 'body',
            parameters: [{ type: 'text', text: 'PED-0002' }],
          },
        ],
      },
    });
  });

  it('parte textos > 4096 caracteres en chunks secuenciales; wamidSalida es el del primero', async () => {
    const textoLargo = 'a'.repeat(5000);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.chunk.1' }] } }),
      )
      .mockResolvedValueOnce(
        fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.chunk.2' }] } }),
      );

    const resultado = await sender(fetchImpl).enviar(message({ texto: textoLargo }));

    expect(resultado).toEqual({ wamidSalida: 'wamid.chunk.1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const cuerpo1 = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    const cuerpo2 = JSON.parse(
      (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    );
    expect((cuerpo1.text.body as string).length + (cuerpo2.text.body as string).length).toBe(
      5000,
    );
    expect((cuerpo1.text.body as string).length).toBeLessThanOrEqual(4096);
  });

  it('plantilla sin variables: error permanente sin llamar fetch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      sender(fetchImpl).enviar(message({ template: 'rfq_solicitud', payload: {} })),
    ).rejects.toMatchObject({ tipo: 'permanente', codigo: 132012 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('plantilla con variables invalidas (no todas strings): error permanente sin llamar fetch', async () => {
    const fetchImpl = vi.fn();

    await expect(
      sender(fetchImpl).enviar(
        message({ template: 'rfq_solicitud', payload: { variables: ['ok', 5] } }),
      ),
    ).rejects.toBeInstanceOf(ErrorEnvio);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ni texto ni template: error permanente sin llamar fetch', async () => {
    const fetchImpl = vi.fn();

    await expect(sender(fetchImpl).enviar(message())).rejects.toMatchObject({
      tipo: 'permanente',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('codigo 132001 (plantilla no existe): error permanente', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        ok: false,
        status: 400,
        body: { error: { code: 132001, message: 'Template does not exist' } },
      }),
    );

    await expect(
      sender(fetchImpl).enviar(
        message({ template: 'no_existe', payload: { variables: ['x'] } }),
      ),
    ).rejects.toMatchObject({ tipo: 'permanente', codigo: 132001 });
  });

  it('429 con codigo 80007 y Retry-After: 30 -> rate_limit con retryAfterMs 30000', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({
        ok: false,
        status: 429,
        headers: { 'Retry-After': '30' },
        body: { error: { code: 80007, message: 'Rate limit hit' } },
      }),
    );

    await expect(sender(fetchImpl).enviar(message({ texto: 'hola' }))).rejects.toMatchObject({
      tipo: 'rate_limit',
      codigo: 80007,
      retryAfterMs: 30_000,
    });
  });

  it('500 sin cuerpo JSON interpretable: error transitorio', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: false, status: 500, conCuerpo: false }),
    );

    await expect(sender(fetchImpl).enviar(message({ texto: 'hola' }))).rejects.toMatchObject({
      tipo: 'transitorio',
    });
  });

  it('codigo no listado en la spec: error transitorio', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: false, status: 400, body: { error: { code: 999, message: 'raro' } } }),
    );

    await expect(sender(fetchImpl).enviar(message({ texto: 'hola' }))).rejects.toMatchObject({
      tipo: 'transitorio',
      codigo: 999,
    });
  });

  it('fetch que lanza (error de red): error transitorio', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });

    await expect(sender(fetchImpl).enviar(message({ texto: 'hola' }))).rejects.toMatchObject({
      tipo: 'transitorio',
    });
  });

  describe('documento por attachment_id (outbox-whatsapp.md §Documentos adjuntos)', () => {
    it('plantilla con attachmentId: header document con link firmado y filename del payload', async () => {
      const fetchImpl = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.oc.1' }] } }),
      );
      const ahora = new Date('2026-07-10T12:00:00Z');

      const resultado = await senderConAttachments(fetchImpl, () => ahora).enviar(
        message({
          template: 'oc_emitida',
          payload: {
            variables: ['Juan', 'OC-0001', 'Proyecto X', '₡100.000'],
            documento_nombre: 'OC-0001.pdf',
          },
          attachmentId: 'attach-oc-1',
        }),
      );

      expect(resultado).toEqual({ wamidSalida: 'wamid.oc.1' });
      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const cuerpo = JSON.parse(init.body as string);
      const header = cuerpo.template.components.find(
        (c: { type: string }) => c.type === 'header',
      );
      const document = header.parameters[0].document;
      expect(document.filename).toBe('OC-0001.pdf');
      expect(document.link).toContain('https://api.example.com/api/attachments/attach-oc-1?f=');

      const claims = decodificarJwtDeLink(document.link as string);
      expect(claims.sub).toBe('attach-oc-1');
      expect(claims.exp - claims.iat).toBe(72 * 3600);
    });

    it('attachmentId sin payload.documento_nombre: filename cae a documento.pdf', async () => {
      const fetchImpl = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.oc.2' }] } }),
      );

      await senderConAttachments(fetchImpl).enviar(
        message({
          template: 'oc_emitida',
          payload: { variables: ['Juan'] },
          attachmentId: 'attach-oc-2',
        }),
      );

      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const cuerpo = JSON.parse(init.body as string);
      const header = cuerpo.template.components.find(
        (c: { type: string }) => c.type === 'header',
      );
      expect(header.parameters[0].document.filename).toBe('documento.pdf');
    });

    it('attachmentId tiene precedencia sobre payload.documento explicito', async () => {
      const fetchImpl = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.oc.3' }] } }),
      );

      await senderConAttachments(fetchImpl).enviar(
        message({
          template: 'oc_emitida',
          payload: {
            variables: ['Juan'],
            documento: { link: 'https://blob/otra-oc.pdf', filename: 'otra.pdf' },
          },
          attachmentId: 'attach-oc-3',
        }),
      );

      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const cuerpo = JSON.parse(init.body as string);
      const header = cuerpo.template.components.find(
        (c: { type: string }) => c.type === 'header',
      );
      expect(header.parameters[0].document.link).toContain('/api/attachments/attach-oc-3?f=');
      expect(header.parameters[0].document.filename).not.toBe('otra.pdf');
    });

    it('attachmentId sin publicApiUrl/attachmentsLinkSecret configurados: error permanente sin llamar fetch', async () => {
      const fetchImpl = vi.fn();

      await expect(
        sender(fetchImpl).enviar(
          message({
            template: 'oc_emitida',
            payload: { variables: ['Juan'] },
            attachmentId: 'attach-oc-4',
          }),
        ),
      ).rejects.toMatchObject({ tipo: 'permanente' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('texto con attachmentId: error permanente sin llamar fetch', async () => {
      const fetchImpl = vi.fn();

      await expect(
        senderConAttachments(fetchImpl).enviar(
          message({ texto: 'hola', attachmentId: 'attach-oc-5' }),
        ),
      ).rejects.toMatchObject({ tipo: 'permanente' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('payload.documento sigue funcionando cuando attachmentId es null', async () => {
      const fetchImpl = vi.fn(async () =>
        fakeResponse({ ok: true, status: 200, body: { messages: [{ id: 'wamid.oc.6' }] } }),
      );

      await senderConAttachments(fetchImpl).enviar(
        message({
          template: 'oc_emitida',
          payload: {
            variables: ['Juan'],
            documento: { link: 'https://blob/oc.pdf', filename: 'oc.pdf' },
          },
          attachmentId: null,
        }),
      );

      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const cuerpo = JSON.parse(init.body as string);
      const header = cuerpo.template.components.find(
        (c: { type: string }) => c.type === 'header',
      );
      expect(header.parameters[0].document).toEqual({
        link: 'https://blob/oc.pdf',
        filename: 'oc.pdf',
      });
    });
  });
});
