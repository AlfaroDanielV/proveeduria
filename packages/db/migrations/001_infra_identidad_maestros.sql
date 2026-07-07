-- 001_infra_identidad_maestros.sql
-- Infraestructura del esquema + identidad/acceso + maestros + config + numeracion.
-- Fuente de verdad: docs/specs/data-model.md, docs/specs/exceptions.md §3.
-- Corre en UNA transaccion (scripts/migrate.mjs).

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Helper: updated_at automatico (data-model.md: timestamps created_at/updated_at)
-- El trigger se ADJUNTA al final de cada migracion a toda tabla con columna
-- updated_at (bloque DO idempotente), evitando boilerplate por tabla.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Numeracion correlativa transaccional por anio (data-model.md regla dura 4).
-- Formato PED-YYYY-NNN / OC-YYYY-NNN. NUNCA max()+1: se usa SELECT ... FOR UPDATE
-- sobre la fila (prefijo, anio) para serializar concurrentes.
-- ---------------------------------------------------------------------------
create table numeracion_secuencias (
  prefijo text not null check (prefijo in ('PED', 'OC')),
  anio integer not null,
  ultimo_valor integer not null default 0 check (ultimo_valor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prefijo, anio)
);

create or replace function siguiente_numero(p_prefijo text, p_anio integer)
returns text
language plpgsql
as $$
declare
  v_val integer;
begin
  if p_prefijo not in ('PED', 'OC') then
    raise exception 'Prefijo de numeracion invalido: % (esperado PED u OC)', p_prefijo
      using errcode = 'check_violation';
  end if;

  -- Garantiza la fila del anio sin pisar un valor existente.
  insert into numeracion_secuencias (prefijo, anio, ultimo_valor)
    values (p_prefijo, p_anio, 0)
    on conflict (prefijo, anio) do nothing;

  -- Lock de fila: correlativos sin carreras (NUNCA max()+1).
  select ultimo_valor into v_val
    from numeracion_secuencias
    where prefijo = p_prefijo and anio = p_anio
    for update;

  v_val := v_val + 1;

  update numeracion_secuencias
    set ultimo_valor = v_val, updated_at = now()
    where prefijo = p_prefijo and anio = p_anio;

  return format('%s-%s-%s', p_prefijo, p_anio::text, lpad(v_val::text, 3, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Config: umbrales de exceptions.md §3 (editable por superadmin; seed = valores
-- iniciales de la spec). Valor jsonb para admitir numeros/strings/bool.
-- ---------------------------------------------------------------------------
create table config (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Identidad y acceso (data-model.md §Identidad y acceso)
-- ---------------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique
    check (clave in ('superadmin', 'admin_materiales', 'admin_equipos', 'ingeniero', 'bodeguero')),
  descripcion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono_whatsapp text unique, -- E.164
  email text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo text not null unique,
  presupuesto_referencia numeric(14, 2) not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id),
  project_id uuid references projects(id), -- ingeniero/bodeguero acotables a proyecto
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, role_id, project_id)
);

create table dashboard_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  project_id uuid not null references projects(id),
  expires_at timestamptz not null, -- 24h renovable (§4.5)
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Maestros (data-model.md §Maestros)
-- ---------------------------------------------------------------------------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cedula_juridica text,
  categorias text[] not null default '{}',
  activo boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  nombre text,
  telefono_whatsapp text not null unique, -- E.164
  optin_at timestamptz,
  es_principal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- materials_catalog: fase 2 (opcional), sin FK a pedido_items en Modulo 1.
create table materials_catalog (
  id uuid primary key default gen_random_uuid(),
  descripcion text not null,
  unidad text,
  categoria text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Adjuntos (data-model.md §Mensajeria y operacion). Referenciado por multiples
-- tablas de documentos; se crea temprano. Blobs privados; acceso por SAS corto.
-- ---------------------------------------------------------------------------
create table attachments (
  id uuid primary key default gen_random_uuid(),
  blob_path text not null,
  content_type text,
  sha256 text,
  origen text, -- wamid de origen
  bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attachments_sha256_idx on attachments (sha256);

-- ---------------------------------------------------------------------------
-- Adjunta set_updated_at a toda tabla con columna updated_at que no lo tenga.
-- ---------------------------------------------------------------------------
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
end;
$$;
