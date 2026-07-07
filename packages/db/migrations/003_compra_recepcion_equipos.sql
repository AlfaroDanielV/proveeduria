-- 003_compra_recepcion_equipos.sql
-- Compra y recepcion (OC, facturas, NC) + equipos de alquiler.
-- Fuente: docs/specs/data-model.md §Compra y recepcion / §Equipos de alquiler,
-- docs/specs/state-machine.md §Ciclo paralelo.

-- ---------------------------------------------------------------------------
-- Ordenes de compra (pedido->OC 1:N)
-- ---------------------------------------------------------------------------
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, -- OC-YYYY-NNN (siguiente_numero())
  pedido_id uuid not null references pedidos(id),
  supplier_id uuid not null references suppliers(id),
  estado text not null default 'emitida'
    check (estado in ('emitida', 'confirmada', 'recibida_parcial', 'recibida_total', 'anulada')),
  monto_total numeric(14, 2) not null default 0,
  confirmada_por_proveedor_at timestamptz,
  pdf_attachment_id uuid references attachments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_orders_pedido_idx on purchase_orders (pedido_id);
create index purchase_orders_supplier_idx on purchase_orders (supplier_id);

create table po_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  pedido_item_id uuid references pedido_items(id),
  cantidad numeric(14, 3) not null,
  precio_unitario numeric(14, 2) not null, -- de la cotizacion aprobada
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index po_items_po_idx on po_items (po_id);

-- ---------------------------------------------------------------------------
-- Facturas (OC->factura 1:N; una factura puede cubrir parcialmente una OC)
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  numero_factura text,
  supplier_id uuid not null references suppliers(id),
  project_id uuid references projects(id),
  fecha date,
  monto_total numeric(14, 2) not null default 0,
  moneda text not null default 'CRC',
  fuente_attachment_id uuid references attachments(id),
  confianza_extraccion numeric(3, 2),
  estado text not null default 'pendiente_revision'
    check (estado in ('pendiente_revision', 'conciliada', 'disputada')),
  registrada_por uuid references users(id), -- bodeguero
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoices_supplier_idx on invoices (supplier_id);
create index invoices_project_idx on invoices (project_id);
create index invoices_estado_idx on invoices (estado);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  descripcion text not null,
  cantidad numeric(14, 3),
  precio_unitario numeric(14, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invoice_items_invoice_idx on invoice_items (invoice_id);

-- N:M factura<->OC con monto asignado (una factura cubre parte de una OC y una
-- OC recibe varias facturas).
create table invoice_po_links (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  po_id uuid not null references purchase_orders(id),
  monto_asignado numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, po_id)
);

create index invoice_po_links_po_idx on invoice_po_links (po_id);

create table receipt_confirmations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  bodeguero_user_id uuid references users(id),
  cantidades jsonb, -- confirmadas por item
  diferencias_detectadas jsonb, -- E5
  confirmado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index receipt_confirmations_invoice_idx on receipt_confirmations (invoice_id);

-- ---------------------------------------------------------------------------
-- Notas de credito (factura->NC 1:N)
-- ---------------------------------------------------------------------------
create table credit_notes (
  id uuid primary key default gen_random_uuid(),
  numero text,
  invoice_id uuid references invoices(id), -- nullable: E6 pendiente_asociacion
  monto numeric(14, 2) not null,
  motivo text,
  attachment_id uuid references attachments(id),
  estado text not null default 'pendiente_asociacion'
    check (estado in ('pendiente_asociacion', 'aplicada')),
  aplicada_por uuid references users(id),
  aplicada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index credit_notes_invoice_idx on credit_notes (invoice_id);

create table credit_note_items (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references credit_notes(id) on delete cascade,
  descripcion text,
  cantidad numeric(14, 3),
  precio_unitario numeric(14, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index credit_note_items_nc_idx on credit_note_items (credit_note_id);

-- ---------------------------------------------------------------------------
-- Equipos de alquiler (data-model.md §4.4; state-machine.md ciclo paralelo)
-- ---------------------------------------------------------------------------
create table equipment_rentals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  supplier_id uuid not null references suppliers(id),
  descripcion_equipo text not null,
  cantidad_inicial numeric(14, 3) not null,
  cantidad_activa numeric(14, 3) not null check (cantidad_activa >= 0),
  boleta_attachment_id uuid references attachments(id),
  estado text not null default 'activo' check (estado in ('activo', 'cerrado')),
  abierto_at timestamptz not null default now(),
  cerrado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index equipment_rentals_project_idx on equipment_rentals (project_id);
create index equipment_rentals_supplier_idx on equipment_rentals (supplier_id);

create table equipment_movements (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references equipment_rentals(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'devolucion')),
  cantidad numeric(14, 3) not null check (cantidad > 0),
  boleta_attachment_id uuid references attachments(id),
  registrado_por uuid references users(id),
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index equipment_movements_rental_idx on equipment_movements (rental_id);

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
