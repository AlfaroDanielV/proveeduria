import { describe, expect, it } from 'vitest';

import { firmarLinkAttachment, resolverAttachmentsRequest } from './routes.js';
import type { AttachmentsDeps, AttachmentsRequest } from './routes.js';
import { FakeAttachmentBlobStore } from './store.js';

const SECRETO = 'secreto-de-adjuntos-test';
const AHORA = new Date('2026-07-10T12:00:00.000Z');
const ATTACHMENT_ID = '80000000-0000-4000-8000-000000000001';
const OTRO_ATTACHMENT_ID = '80000000-0000-4000-8000-000000000002';

function construirDeps(store: FakeAttachmentBlobStore, ahora: Date = AHORA): AttachmentsDeps {
  return { store, secreto: SECRETO, ahora: () => ahora };
}

function req(overrides: Partial<AttachmentsRequest> & { pathname: string }): AttachmentsRequest {
  return {
    method: 'GET',
    searchParams: new URLSearchParams(),
    ...overrides,
  };
}

function sembrarPdf(store: FakeAttachmentBlobStore, id: string = ATTACHMENT_ID): Buffer {
  const bytes = Buffer.from('%PDF-1.4 contenido de prueba');
  store.sembrar(id, { contentType: 'application/pdf', bytes });
  return bytes;
}

describe('resolverAttachmentsRequest', () => {
  it('devuelve null para rutas que no son de adjuntos (el llamador sigue con otras rutas)', async () => {
    const store = new FakeAttachmentBlobStore();
    const resp = await resolverAttachmentsRequest(
      req({ pathname: '/api/portal/pedidos' }),
      construirDeps(store),
    );
    expect(resp).toBeNull();
  });

  it('GET feliz: 200 con content-type, content-length, cache-control y bytes', async () => {
    const store = new FakeAttachmentBlobStore();
    const bytes = sembrarPdf(store);
    const f = firmarLinkAttachment(ATTACHMENT_ID, SECRETO, AHORA);

    const resp = await resolverAttachmentsRequest(
      req({
        pathname: `/api/attachments/${ATTACHMENT_ID}`,
        searchParams: new URLSearchParams({ f }),
      }),
      construirDeps(store),
    );

    expect(resp).not.toBeNull();
    expect(resp?.status).toBe(200);
    expect(resp?.headers['content-type']).toBe('application/pdf');
    expect(resp?.headers['content-length']).toBe(String(bytes.length));
    expect(resp?.headers['cache-control']).toBe('private, max-age=0');
    expect(resp?.body).toEqual(bytes);
  });

  it('HEAD feliz: mismo content-type, sin body', async () => {
    const store = new FakeAttachmentBlobStore();
    const bytes = sembrarPdf(store);
    const f = firmarLinkAttachment(ATTACHMENT_ID, SECRETO, AHORA);

    const resp = await resolverAttachmentsRequest(
      req({
        method: 'HEAD',
        pathname: `/api/attachments/${ATTACHMENT_ID}`,
        searchParams: new URLSearchParams({ f }),
      }),
      construirDeps(store),
    );

    expect(resp?.status).toBe(200);
    expect(resp?.headers['content-type']).toBe('application/pdf');
    expect(resp?.headers['content-length']).toBe(String(bytes.length));
    expect(resp?.body).toBeUndefined();
  });

  it('sin blob asociado (content_type null) cae a application/octet-stream', async () => {
    const store = new FakeAttachmentBlobStore();
    const bytes = Buffer.from('datos sin tipo');
    store.sembrar(ATTACHMENT_ID, { contentType: null, bytes });
    const f = firmarLinkAttachment(ATTACHMENT_ID, SECRETO, AHORA);

    const resp = await resolverAttachmentsRequest(
      req({
        pathname: `/api/attachments/${ATTACHMENT_ID}`,
        searchParams: new URLSearchParams({ f }),
      }),
      construirDeps(store),
    );

    expect(resp?.status).toBe(200);
    expect(resp?.headers['content-type']).toBe('application/octet-stream');
  });

  const casosDeFallo: Array<[string, (store: FakeAttachmentBlobStore) => AttachmentsRequest]> = [
    [
      'sin firma f',
      () =>
        req({ pathname: `/api/attachments/${ATTACHMENT_ID}` }),
    ],
    [
      'firma vacia',
      () =>
        req({
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({ f: '' }),
        }),
    ],
    [
      'firma invalida (basura)',
      () =>
        req({
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({ f: 'no-es-un-jwt' }),
        }),
    ],
    [
      'firma expirada',
      () =>
        req({
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({
            f: firmarLinkAttachment(ATTACHMENT_ID, SECRETO, AHORA, 1),
          }),
        }),
    ],
    [
      'sub distinto del :id de la URL',
      () =>
        req({
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({
            f: firmarLinkAttachment(OTRO_ATTACHMENT_ID, SECRETO, AHORA),
          }),
        }),
    ],
    [
      'id malformado (no UUID)',
      () =>
        req({
          pathname: '/api/attachments/no-es-un-uuid',
          searchParams: new URLSearchParams({
            f: firmarLinkAttachment('no-es-un-uuid', SECRETO, AHORA),
          }),
        }),
    ],
    [
      'firmada con otro secreto',
      () =>
        req({
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({
            f: firmarLinkAttachment(ATTACHMENT_ID, 'otro-secreto', AHORA),
          }),
        }),
    ],
    [
      'adjunto no encontrado (firma valida, sin blob sembrado)',
      () =>
        req({
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({
            f: firmarLinkAttachment(ATTACHMENT_ID, SECRETO, AHORA),
          }),
        }),
    ],
    [
      'metodo no permitido (POST)',
      () =>
        req({
          method: 'POST',
          pathname: `/api/attachments/${ATTACHMENT_ID}`,
          searchParams: new URLSearchParams({
            f: firmarLinkAttachment(ATTACHMENT_ID, SECRETO, AHORA),
          }),
        }),
    ],
  ];

  it.each(casosDeFallo)('%s -> 404 uniforme sin detalle', async (_nombre, construirRequest) => {
    const store = new FakeAttachmentBlobStore();
    // Nota: el caso "adjunto no encontrado" depende de NO sembrar; los demas casos fallan
    // antes de llegar al store, asi que sembrar o no es indistinto para ellos.
    const ahora = _nombre === 'firma expirada' ? new Date(AHORA.getTime() + 2_000) : AHORA;
    const resp = await resolverAttachmentsRequest(construirRequest(store), construirDeps(store, ahora));
    expect(resp).toEqual({ status: 404, headers: {} });
  });
});
