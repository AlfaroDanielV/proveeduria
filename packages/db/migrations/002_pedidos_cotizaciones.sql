-- 002_pedidos_cotizaciones.sql
-- Flujo de pedido: pedidos (con guardia de estados) + items + cotizaciones.
-- Fuente: docs/specs/data-model.md §Flujo de pedido, docs/specs/state-machine.md.

-- ---------------------------------------------------------------------------
-- pedidos (data-model.md; estado enum de state-machine.md)
-- ---------------------------------------------------------------------------
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, -- PED-YYYY-NNN (siguiente_numero())
  project_id uuid not null references projects(id),
  solicitante_user_id uuid references users(id),
  estado text not null default 'borrador'
    check (estado in (
      'borrador', 'cotizando', 'en_revision', 'aprobado', 'ordenado',
      'recepcion_parcial', 'recepcion_total', 'cerrado', 'cancelado'
    )),
  fecha_requerida date,
  urgencia text,
  plazo_cotizacion_at timestamptz,
  cerrado_por uuid references users(id),
  cerrado_at timestamptz,
  cancelado_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pedidos_project_idx on pedidos (project_id);
create index pedidos_estado_idx on pedidos (estado);

-- ---------------------------------------------------------------------------
-- Guardia de transiciones (state-machine.md). Defensa en profundidad frente a
-- packages/core: el trigger RECHAZA toda transicion fuera de la tabla, hace
-- inmutables cerrado/cancelado, y bloquea cancelar desde ordenado+.
-- ---------------------------------------------------------------------------
create or replace function pedidos_guardia_transicion()
returns trigger
language plpgsql
as $$
begin
  -- Regla dura 2: cerrado y cancelado son terminales e inmutables (ninguna
  -- escritura, cambie o no el estado).
  if old.estado in ('cerrado', 'cancelado') then
    raise exception
      'Pedido % en estado terminal % es inmutable (state-machine.md regla 2)',
      old.numero, old.estado
      using errcode = 'check_violation';
  end if;

  -- Sin cambio de estado: se permite actualizar otras columnas.
  -- Cubre la auto-transicion recepcion_parcial->recepcion_parcial (mismo valor).
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  -- Transiciones validas (state-machine.md §Transiciones validas).
  -- Nota: ordenado, recepcion_parcial y recepcion_total NO admiten cancelado
  -- (regla dura 1) por su ausencia deliberada en esta lista.
  if (old.estado, new.estado) in (
    ('borrador', 'cotizando'),
    ('cotizando', 'en_revision'),
    ('en_revision', 'cotizando'),
    ('en_revision', 'aprobado'),
    ('aprobado', 'ordenado'),
    ('ordenado', 'recepcion_parcial'),
    ('ordenado', 'recepcion_total'),
    ('recepcion_parcial', 'recepcion_total'),
    ('recepcion_total', 'cerrado'),
    ('borrador', 'cancelado'),
    ('cotizando', 'cancelado'),
    ('en_revision', 'cancelado'),
    ('aprobado', 'cancelado')
  ) then
    return new;
  end if;

  raise exception
    'Transicion de pedido invalida: % -> % (state-machine.md; exceptions.md E12)',
    old.estado, new.estado
    using errcode = 'check_violation';
end;
$$;

create trigger pedidos_guardia_transicion
  before update on pedidos
  for each row
  execute function pedidos_guardia_transicion();

-- ---------------------------------------------------------------------------
-- pedido_items (texto libre normalizado; sin FK a catalogo en Modulo 1)
-- ---------------------------------------------------------------------------
create table pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  descripcion text not null,
  cantidad numeric(14, 3) not null,
  unidad text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pedido_items_pedido_idx on pedido_items (pedido_id);

-- ---------------------------------------------------------------------------
-- Cotizaciones (data-model.md §Flujo de pedido)
-- ---------------------------------------------------------------------------
create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  supplier_id uuid not null references suppliers(id),
  enviado_at timestamptz, -- via outbox
  plazo_at timestamptz,
  estado text not null default 'enviada'
    check (estado in ('enviada', 'respondida', 'vencida', 'declinada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quote_requests_pedido_idx on quote_requests (pedido_id);
create index quote_requests_plazo_idx on quote_requests (plazo_at) where estado = 'enviada';

create table quote_responses (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references quote_requests(id) on delete cascade,
  recibido_at timestamptz,
  fuente text check (fuente in ('texto', 'imagen', 'pdf', 'audio')),
  attachment_id uuid references attachments(id),
  condiciones text,
  plazo_entrega text,
  confianza_extraccion numeric(3, 2),
  estado text not null default 'completa'
    check (estado in ('completa', 'incompleta', 'descartada')),
  -- E2: repreguntas al proveedor (max 2 antes de escalar), contadas aqui.
  intentos_repregunta integer not null default 0 check (intentos_repregunta >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quote_responses_request_idx on quote_responses (quote_request_id);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_response_id uuid not null references quote_responses(id) on delete cascade,
  -- nullable: el proveedor pudo cotizar algo no pedido.
  pedido_item_id uuid references pedido_items(id),
  precio_unitario numeric(14, 2),
  cantidad numeric(14, 3),
  disponible boolean,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quote_items_response_idx on quote_items (quote_response_id);

-- Adjunta set_updated_at a tablas nuevas con updated_at.
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
