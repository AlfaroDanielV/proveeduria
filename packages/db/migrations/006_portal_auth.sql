-- ---------------------------------------------------------------------------
-- 006: Autenticacion del Centro de Control (docs/specs/control-center.md).
-- Credenciales separadas de `users` (no todo actor WhatsApp tiene acceso web)
-- y sesiones de refresh con rotacion/revocacion.
-- ---------------------------------------------------------------------------

create table user_credentials (
  user_id uuid primary key references users(id),
  -- Formato versionado: scrypt$N$r$p$<salt-b64>$<hash-b64> (crypto.scrypt de Node).
  password_hash text not null,
  must_change_password boolean not null default true,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table portal_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  -- sha256 del refresh token opaco; el token en claro nunca se persiste.
  refresh_token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index portal_sessions_user_idx on portal_sessions (user_id);
create index portal_sessions_vigentes_idx on portal_sessions (expires_at)
  where revoked_at is null;

-- Adjunta set_updated_at a las tablas nuevas con updated_at (patron de 001-004).
do $$
declare
  t record;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.column_name = 'updated_at'
        and not exists (
          select 1
            from pg_trigger tg
            join pg_class cl on cl.oid = tg.tgrelid
            join pg_namespace ns on ns.oid = cl.relnamespace
            where ns.nspname = 'public'
              and cl.relname = c.table_name
              and tg.tgname = 'set_updated_at'
        )
  loop
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function set_updated_at()',
      t.table_name
    );
  end loop;
end $$;
