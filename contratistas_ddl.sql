-- ============================================================
-- MÓDULO: Contratistas / Contratos / Órdenes de cambio / Pagos
-- Ejecutar en Supabase SQL Editor DESPUÉS del schema base
-- (asume proyectos, usuarios, y public.handle_updated_at() ya existen)
-- ============================================================

-- 1. TABLA: contratistas — catálogo maestro
create table public.contratistas (
  id uuid default gen_random_uuid() primary key,
  nombre text not null,
  especialidad text,
  telefono text,
  notas text,
  activo boolean default true,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.contratistas is 'Catálogo maestro de contratistas (personas o empresas)';

create index idx_contratistas_nombre_lower on public.contratistas (lower(nombre));
create index idx_contratistas_activo on public.contratistas (activo);

-- 2. TABLA: contratos — une contratista con proyecto y monto
create table public.contratos (
  id uuid default gen_random_uuid() primary key,
  contratista_id uuid not null references public.contratistas(id),
  proyecto_id uuid not null references public.proyectos(id),
  descripcion text,
  monto_original numeric(12,2) not null,
  fecha_inicio date,
  fecha_fin_estimada date,
  estado text not null default 'activo' check (estado in ('activo', 'finalizado', 'cancelado')),
  notas text,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.contratos is 'Contratos entre contratistas y proyectos';

create index idx_contratos_contratista on public.contratos (contratista_id);
create index idx_contratos_proyecto on public.contratos (proyecto_id);
create index idx_contratos_estado on public.contratos (estado);

-- 3. TABLA: ordenes_cambio — ajustes (+/-) al monto de un contrato
create table public.ordenes_cambio (
  id uuid default gen_random_uuid() primary key,
  contrato_id uuid not null references public.contratos(id),
  descripcion text not null,
  monto numeric(12,2) not null,  -- positivo o negativo
  fecha date default current_date,
  creado_por uuid references public.usuarios(id),
  created_at timestamptz default now()
);

comment on table public.ordenes_cambio is 'Ajustes al monto de un contrato (positivos o negativos)';

create index idx_ordenes_cambio_contrato on public.ordenes_cambio (contrato_id);
create index idx_ordenes_cambio_fecha on public.ordenes_cambio (fecha);

-- 4. TABLA: pagos_contratista — cada cuota/abono pagado
create table public.pagos_contratista (
  id uuid default gen_random_uuid() primary key,
  contrato_id uuid not null references public.contratos(id),
  monto numeric(12,2) not null check (monto > 0),
  fecha_pago date default current_date,
  numero_cuota int,
  descripcion text,
  registrado_por uuid references public.usuarios(id),
  created_at timestamptz default now()
);

comment on table public.pagos_contratista is 'Pagos (cuotas/abonos) realizados a contratistas por contrato';

create index idx_pagos_contratista_contrato on public.pagos_contratista (contrato_id);
create index idx_pagos_contratista_fecha on public.pagos_contratista (fecha_pago);

-- 5. TRIGGERS: updated_at
create trigger set_updated_at_contratistas
  before update on public.contratistas
  for each row execute function public.handle_updated_at();

create trigger set_updated_at_contratos
  before update on public.contratos
  for each row execute function public.handle_updated_at();

-- 6. RLS — habilitado pero con policies permisivas para authenticated
alter table public.contratistas enable row level security;
alter table public.contratos enable row level security;
alter table public.ordenes_cambio enable row level security;
alter table public.pagos_contratista enable row level security;

create policy "Contratistas visibles para autenticados"
  on public.contratistas for select
  to authenticated
  using (true);

create policy "Contratos visibles para autenticados"
  on public.contratos for select
  to authenticated
  using (true);

create policy "Ordenes de cambio visibles para autenticados"
  on public.ordenes_cambio for select
  to authenticated
  using (true);

create policy "Pagos contratista visibles para autenticados"
  on public.pagos_contratista for select
  to authenticated
  using (true);

-- 7. VISTA: v_resumen_contratos
-- monto_vigente = monto_original + SUM(ordenes_cambio.monto)
-- total_pagado  = SUM(pagos_contratista.monto)
-- saldo_pendiente = monto_vigente - total_pagado
-- porcentaje_pagado = (total_pagado / monto_vigente) * 100
create or replace view public.v_resumen_contratos as
with ajustes as (
  select contrato_id, coalesce(sum(monto), 0) as total_ajustes
  from public.ordenes_cambio
  group by contrato_id
),
pagos as (
  select contrato_id, coalesce(sum(monto), 0) as total_pagado
  from public.pagos_contratista
  group by contrato_id
)
select
  c.id                                                 as contrato_id,
  c.contratista_id,
  ct.nombre                                            as contratista_nombre,
  ct.especialidad,
  ct.telefono                                          as contratista_telefono,
  c.proyecto_id,
  p.nombre                                             as proyecto_nombre,
  c.descripcion,
  c.monto_original,
  c.monto_original + coalesce(a.total_ajustes, 0)      as monto_vigente,
  coalesce(pg.total_pagado, 0)                         as total_pagado,
  (c.monto_original + coalesce(a.total_ajustes, 0))
    - coalesce(pg.total_pagado, 0)                     as saldo_pendiente,
  case
    when (c.monto_original + coalesce(a.total_ajustes, 0)) = 0 then 0
    else round(
      100.0 * coalesce(pg.total_pagado, 0)
      / nullif(c.monto_original + coalesce(a.total_ajustes, 0), 0),
      2
    )
  end                                                  as porcentaje_pagado,
  c.fecha_inicio,
  c.fecha_fin_estimada,
  c.estado,
  c.created_at
from public.contratos c
join public.contratistas ct on ct.id = c.contratista_id
join public.proyectos p     on p.id = c.proyecto_id
left join ajustes a         on a.contrato_id = c.id
left join pagos pg          on pg.contrato_id = c.id;

comment on view public.v_resumen_contratos is 'Resumen de cada contrato: monto vigente, pagado, saldo pendiente, % pagado';
