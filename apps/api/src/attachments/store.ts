/**
 * Lectura de bytes de adjuntos (docs/specs/outbox-whatsapp.md §Documentos adjuntos):
 * mientras no exista Azure Blob (D-2), los bytes del PDF de OC viven en
 * `attachment_blobs` (migracion 010 en `packages/db`), 1:1 con `attachments`.
 *
 * Constructor tipado sobre `Tx` (`@proveeduria/agent`, mismo patron que
 * `db/entregas.ts`/`portal/repo.ts`), no el `Pool` concreto de `pg`: sirve igual fuera de
 * una transaccion (`index.ts`, un `Pool`) que dentro de una (tests de integracion con
 * `BEGIN`/`ROLLBACK` sobre un `PoolClient`).
 *
 * Solo lectura: este store no escribe blobs (eso lo hace `emitir_oc` en
 * `packages/agent`/`apps/worker`, fuera del alcance de `apps/api`).
 */

import type { Tx } from '@proveeduria/agent';

export interface AttachmentBlob {
  /** `attachments.content_type`; puede ser `null` si nunca se registro (dato historico). */
  readonly contentType: string | null;
  readonly bytes: Buffer;
}

export interface AttachmentBlobStore {
  /** `null` si el adjunto no existe o no tiene blob asociado (join vacio). */
  obtener(attachmentId: string): Promise<AttachmentBlob | null>;
}

const SQL_SELECT =
  'SELECT a.content_type, b.bytes ' +
  'FROM attachments a ' +
  'JOIN attachment_blobs b ON b.attachment_id = a.id ' +
  'WHERE a.id = $1';

interface FilaBlob {
  readonly content_type: string | null;
  readonly bytes: Buffer;
}

export class PgAttachmentBlobStore implements AttachmentBlobStore {
  constructor(private readonly db: Tx) {}

  async obtener(attachmentId: string): Promise<AttachmentBlob | null> {
    const res = await this.db.query<FilaBlob>(SQL_SELECT, [attachmentId]);
    const fila = res.rows[0];
    if (fila === undefined) return null;
    return { contentType: fila.content_type, bytes: fila.bytes };
  }
}

/** Impl en memoria para tests: sin `pg`, sin schema real. */
export class FakeAttachmentBlobStore implements AttachmentBlobStore {
  private readonly blobs = new Map<string, AttachmentBlob>();

  /** Simula un adjunto con blob ya persistido. */
  sembrar(attachmentId: string, blob: AttachmentBlob): void {
    this.blobs.set(attachmentId, blob);
  }

  async obtener(attachmentId: string): Promise<AttachmentBlob | null> {
    return this.blobs.get(attachmentId) ?? null;
  }
}
