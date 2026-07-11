-- ---------------------------------------------------------------------------
-- 011: Una conversacion viva por telefono (docs/specs/agente-conversacional.md
-- §A4): el upsert del worker necesita unicidad por phone. Reemplaza el indice
-- no-unico de 004.
-- ---------------------------------------------------------------------------

drop index conversations_phone_idx;
create unique index conversations_phone_idx on conversations (phone);
