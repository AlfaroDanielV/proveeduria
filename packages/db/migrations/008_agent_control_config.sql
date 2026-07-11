-- ---------------------------------------------------------------------------
-- 008: Control del agente (docs/specs/control-center.md §Pausa del agente) y
-- clave de config del umbral E3 (docs/specs/exceptions.md, actualizado hoy).
--
-- `agent_control` registra pausas del agente por alcance. Una pausa esta
-- VIGENTE cuando `reanudado_at IS NULL`. El worker consulta las pausas
-- vigentes ANTES de delegar al engine (predicado determinista, jamas del LLM):
-- un mensaje entrante bajo pausa se persiste y notifica, no ejecuta tools.
-- Historial completo: reanudar NO borra la fila, fija `reanudado_at`.
-- ---------------------------------------------------------------------------

create table agent_control (
  id uuid primary key default gen_random_uuid(),
  alcance text not null check (alcance in ('global', 'telefono', 'pedido')),
  -- Telefono E.164 o pedido_id (uuid en texto) segun alcance; null para global.
  referencia text,
  motivo text not null,
  pausado_por uuid not null references users(id),
  pausado_at timestamptz not null default now(),
  reanudado_por uuid references users(id),
  reanudado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_control_referencia_chk check (
    (alcance = 'global' and referencia is null)
    or (alcance <> 'global' and referencia is not null)
  )
);

-- Lookup del worker: pausas vigentes por alcance/referencia.
create index agent_control_vigentes_idx
  on agent_control (alcance, referencia)
  where reanudado_at is null;

-- A lo sumo UNA pausa global vigente a la vez.
create unique index agent_control_global_unica_idx
  on agent_control (alcance)
  where alcance = 'global' and reanudado_at is null;

-- Umbral E3 (exceptions.md §3: se siembra aqui; editable por superadmin).
insert into config (clave, valor, descripcion) values
  ('umbral_similitud_factura_oc', '0.6',
   'E3: score minimo de similitud factura<->OC para match automatico; bajo esto -> review_queue(factura_sin_oc).')
on conflict (clave) do nothing;

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
