-- ---------------------------------------------------------------------------
-- 007: Outbox productivo (docs/specs/outbox-whatsapp.md).
-- Claim con lease (estado 'enviando'), estado terminal 'descartado', tope de
-- reintentos por fila, documento adjunto y tracking de entrega (statuses Meta).
-- ---------------------------------------------------------------------------

alter table outbox_messages
  add column attachment_id uuid references attachments(id),
  add column max_intentos integer not null default 8 check (max_intentos > 0),
  add column claimed_at timestamptz,
  add column error_ultimo text,
  add column entrega_estado text
    check (entrega_estado in ('sent', 'delivered', 'read', 'failed')),
  add column entrega_actualizada_at timestamptz,
  add column entrega_error jsonb;

-- Estado amplia su check: 'enviando' (claim en curso, reclaim por lease vencido)
-- y 'descartado' (terminal: error permanente o intentos agotados).
alter table outbox_messages drop constraint outbox_messages_estado_check;
alter table outbox_messages add constraint outbox_messages_estado_check
  check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'descartado'));

-- Lookup de statuses del webhook por wamid de salida.
create index outbox_messages_wamid_salida_idx
  on outbox_messages (wamid_salida)
  where wamid_salida is not null;

-- El indice parcial de despachables debe cubrir tambien 'enviando' (reclaim).
drop index outbox_messages_pendientes_idx;
create index outbox_messages_pendientes_idx
  on outbox_messages (next_retry_at)
  where estado in ('pendiente', 'fallido', 'enviando');
