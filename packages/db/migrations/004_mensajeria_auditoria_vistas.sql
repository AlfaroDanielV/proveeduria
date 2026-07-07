-- 004_mensajeria_auditoria_vistas.sql
-- Mensajeria y operacion + auditoria append-only + vistas de reporte.
-- Fuente: docs/specs/data-model.md §Mensajeria y operacion / §Invariantes globales.

-- ---------------------------------------------------------------------------
-- Conversaciones (reemplaza el Map en memoria de server.js:958)
-- ---------------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  user_id uuid references users(id),
  supplier_contact_id uuid references supplier_contacts(id),
  contexto jsonb not null default '{}',
  last_message_at timestamptz,
  ventana_24h_expira_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_phone_idx on conversations (phone);

-- ---------------------------------------------------------------------------
-- Mensajes entrantes: wamid UNIQUE = clave de idempotencia del webhook.
-- ---------------------------------------------------------------------------
create table inbound_messages (
  id uuid primary key default gen_random_uuid(),
  wamid text not null unique,
  from_phone text,
  tipo text,
  payload jsonb,
  attachment_id uuid references attachments(id),
  conversation_id uuid references conversations(id),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inbound_messages_conversation_idx on inbound_messages (conversation_id);

-- ---------------------------------------------------------------------------
-- Outbox: todo envio WhatsApp sale de aqui, insertado en la misma transaccion
-- que el efecto de dominio (data-model.md invariante 2).
-- ---------------------------------------------------------------------------
create table outbox_messages (
  id uuid primary key default gen_random_uuid(),
  destino text not null,
  template text,
  texto text,
  payload jsonb,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'enviado', 'fallido')),
  wamid_salida text,
  intentos integer not null default 0 check (intentos >= 0),
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbox_messages_pendientes_idx
  on outbox_messages (next_retry_at)
  where estado in ('pendiente', 'fallido');

-- ---------------------------------------------------------------------------
-- Cola de revision (exceptions.md): referencia polimorfica entidad+entidad_id.
-- ---------------------------------------------------------------------------
create table review_queue (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in (
    'factura_sin_oc', 'diferencia_monto', 'nc_ambigua',
    'cotizacion_incompleta', 'extraccion_baja_confianza', 'material_no_coincide'
  )),
  entidad text not null,
  entidad_id uuid not null,
  pedido_id uuid references pedidos(id),
  detalle jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'resuelta')),
  resuelta_por uuid references users(id),
  resolucion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index review_queue_estado_idx on review_queue (estado);
create index review_queue_entidad_idx on review_queue (entidad, entidad_id);

-- ---------------------------------------------------------------------------
-- Aprobaciones humanas obligatorias (EXECUTION_PLAN §1.5)
-- ---------------------------------------------------------------------------
create table approval_events (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in (
    'lista_proveedores', 'ganador', 'emision_oc', 'recepcion', 'nc', 'cierre'
  )),
  pedido_id uuid references pedidos(id),
  aprobado_por uuid references users(id),
  canal text not null check (canal in ('whatsapp', 'web')),
  detalle jsonb,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index approval_events_pedido_idx on approval_events (pedido_id);

-- ---------------------------------------------------------------------------
-- Auditoria APPEND-ONLY (data-model.md: la tabla mas sensible).
-- Sin UPDATE/DELETE: revocacion de permisos + trigger que lanza excepcion.
-- ---------------------------------------------------------------------------
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id), -- null => sistema
  actor_sistema boolean not null default false,
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  pedido_id uuid references pedidos(id),
  antes jsonb,
  despues jsonb,
  origen text not null check (origen in ('wamid', 'web', 'cron', 'system')),
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index audit_events_entidad_idx on audit_events (entidad, entidad_id);
create index audit_events_pedido_idx on audit_events (pedido_id);

create or replace function audit_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'audit_events es append-only: % no permitido (data-model.md §Invariantes)',
    tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update
  before update on audit_events
  for each row
  execute function audit_events_append_only();

create trigger audit_events_no_delete
  before delete on audit_events
  for each row
  execute function audit_events_append_only();

-- TRUNCATE no dispara triggers de fila; se bloquea a nivel de sentencia para cerrar esa via
-- incluso para el owner de la tabla (audit_events es append-only sin excepcion).
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement
  execute function audit_events_append_only();

-- Defensa por permisos ademas del trigger (el owner cae en el trigger igual).
revoke update, delete, truncate on audit_events from public;

-- ---------------------------------------------------------------------------
-- Feedback (paridad con registrar_retroalimentacion del prototipo)
-- ---------------------------------------------------------------------------
create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  tipo text not null check (tipo in ('error', 'sugerencia')),
  texto text not null,
  contexto jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Vistas de reporte (data-model.md). Costo real SIEMPRE calculado, nunca
-- columna materializada editable.
-- ---------------------------------------------------------------------------

-- Costo real del pedido = Σ facturas conciliadas − Σ NC aplicadas.
create view v_pedido_costo_real as
with facturado as (
  select po.pedido_id,
         sum(ipl.monto_asignado) as total_facturado
    from invoice_po_links ipl
    join purchase_orders po on po.id = ipl.po_id
    join invoices i on i.id = ipl.invoice_id
   where i.estado = 'conciliada'
   group by po.pedido_id
),
-- Asignacion de cada factura a cada pedido (via sus OC) y total asignado de la factura.
alloc as (
  select ipl.invoice_id,
         po.pedido_id,
         sum(ipl.monto_asignado) as asignado_pedido
    from invoice_po_links ipl
    join purchase_orders po on po.id = ipl.po_id
   group by ipl.invoice_id, po.pedido_id
),
alloc_total as (
  select invoice_id, sum(asignado_pedido) as asignado_total
    from alloc
   group by invoice_id
),
-- NC aplicada PRORATEADA por la fraccion de la factura asignada a cada pedido: una factura
-- que cubre OC de varios pedidos reparte la NC en proporcion, sin restarla integra en cada uno.
notas_credito as (
  select a.pedido_id,
         sum(cn.monto * a.asignado_pedido / nullif(atot.asignado_total, 0)) as total_nc
    from credit_notes cn
    join alloc a on a.invoice_id = cn.invoice_id
    join alloc_total atot on atot.invoice_id = cn.invoice_id
   where cn.estado = 'aplicada'
   group by a.pedido_id
)
select p.id as pedido_id,
       p.numero,
       p.project_id,
       coalesce(f.total_facturado, 0) as total_facturado,
       coalesce(n.total_nc, 0) as total_notas_credito,
       coalesce(f.total_facturado, 0) - coalesce(n.total_nc, 0) as costo_real
  from pedidos p
  left join facturado f on f.pedido_id = p.id
  left join notas_credito n on n.pedido_id = p.id;

-- Compras por proveedor (grano proveedor x proyecto x mes), solo conciliadas.
create view v_compras_por_proveedor as
select i.supplier_id,
       s.nombre as proveedor,
       i.project_id,
       pr.nombre as proyecto,
       date_trunc('month', i.fecha) as mes,
       count(*) filter (where i.estado = 'conciliada') as facturas_conciliadas,
       coalesce(sum(i.monto_total) filter (where i.estado = 'conciliada'), 0) as total_comprado
  from invoices i
  join suppliers s on s.id = i.supplier_id
  left join projects pr on pr.id = i.project_id
 group by i.supplier_id, s.nombre, i.project_id, pr.nombre, date_trunc('month', i.fecha);

-- Ejecucion de presupuesto por proyecto.
create view v_ejecucion_presupuesto as
select pr.id as project_id,
       pr.nombre,
       pr.presupuesto_referencia,
       coalesce(sum(cr.costo_real), 0) as ejecutado,
       pr.presupuesto_referencia - coalesce(sum(cr.costo_real), 0) as disponible
  from projects pr
  left join pedidos p on p.project_id = pr.id
  left join v_pedido_costo_real cr on cr.pedido_id = p.id
 group by pr.id, pr.nombre, pr.presupuesto_referencia;

-- Inventario de equipos de alquiler (activos y cerrados).
create view v_inventario_equipos as
select r.id as rental_id,
       r.project_id,
       pr.nombre as proyecto,
       r.supplier_id,
       s.nombre as proveedor,
       r.descripcion_equipo,
       r.cantidad_inicial,
       r.cantidad_activa,
       r.estado,
       r.abierto_at,
       r.cerrado_at
  from equipment_rentals r
  left join projects pr on pr.id = r.project_id
  left join suppliers s on s.id = r.supplier_id;

-- Adjunta set_updated_at a tablas nuevas con updated_at (excluye append-only).
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
