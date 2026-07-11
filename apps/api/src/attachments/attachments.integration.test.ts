import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { firmarLinkAttachment, resolverAttachmentsRequest } from './routes.js';
import type { AttachmentsDeps } from './routes.js';
import { PgAttachmentBlobStore } from './store.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

const SECRETO = 'secreto-integracion-adjuntos';
const AHORA = new Date('2026-07-10T12:00:00.000Z');

describe.skipIf(!RUN)('GET /api/attachments/:id (integracion Postgres)', () => {
  let pool: pg.Pool;
  let deps: AttachmentsDeps;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    deps = { store: new PgAttachmentBlobStore(pool), secreto: SECRETO, ahora: () => AHORA };
  });

  afterAll(async () => {
    await pool.end();
  });

  it('siembra attachment+blob reales y responde 200 con los bytes; firma vencida -> 404', async () => {
    const attachmentId = randomUUID();
    const bytes = Buffer.from('%PDF-1.4 orden de compra de prueba');

    await pool.query(
      'INSERT INTO attachments (id, blob_path, content_type, bytes) VALUES ($1, $2, $3, $4)',
      [attachmentId, `pg://attachment_blobs/${attachmentId}`, 'application/pdf', bytes.length],
    );
    await pool.query('INSERT INTO attachment_blobs (attachment_id, bytes) VALUES ($1, $2)', [
      attachmentId,
      bytes,
    ]);

    try {
      const f = firmarLinkAttachment(attachmentId, SECRETO, AHORA);
      const feliz = await resolverAttachmentsRequest(
        {
          method: 'GET',
          pathname: `/api/attachments/${attachmentId}`,
          searchParams: new URLSearchParams({ f }),
        },
        deps,
      );
      expect(feliz?.status).toBe(200);
      expect(feliz?.headers['content-type']).toBe('application/pdf');
      expect(feliz?.headers['content-length']).toBe(String(bytes.length));
      expect(feliz?.body).toEqual(bytes);

      // Firma vencida (vidaSegundos=1, verificada 2s despues): 404 uniforme, sin detalle.
      const fVencida = firmarLinkAttachment(attachmentId, SECRETO, AHORA, 1);
      const vencido = await resolverAttachmentsRequest(
        {
          method: 'GET',
          pathname: `/api/attachments/${attachmentId}`,
          searchParams: new URLSearchParams({ f: fVencida }),
        },
        { ...deps, ahora: () => new Date(AHORA.getTime() + 2_000) },
      );
      expect(vencido).toEqual({ status: 404, headers: {} });
    } finally {
      await pool.query('DELETE FROM attachment_blobs WHERE attachment_id = $1', [attachmentId]);
      await pool.query('DELETE FROM attachments WHERE id = $1', [attachmentId]);
    }
  });
});
