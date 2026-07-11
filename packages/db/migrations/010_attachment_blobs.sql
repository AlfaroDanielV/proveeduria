-- ---------------------------------------------------------------------------
-- 010: Bytes de adjuntos en Postgres (docs/specs/outbox-whatsapp.md
-- §Documentos adjuntos): mientras no exista Azure Blob (D-2 del plan), los
-- documentos generados (PDF de OC) viven aqui y `attachments.blob_path` usa la
-- convencion 'pg://attachment_blobs/<id>'. Volumen esperado trivial
-- (~80 OCs/mes de ~100KB). Al migrar a Blob la tabla se vacia y blob_path pasa
-- a 'azure://...' sin cambiar el contrato del link firmado.
-- ---------------------------------------------------------------------------

create table attachment_blobs (
  attachment_id uuid primary key references attachments(id) on delete cascade,
  bytes bytea not null,
  created_at timestamptz not null default now()
);
