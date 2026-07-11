-- ---------------------------------------------------------------------------
-- 009: Guardias de Fase 2b (defensa en profundidad, specs actualizadas hoy):
--  1) Trigger de transiciones de OC (state-machine.md §Ciclo de la OC), espejo
--     del patron de pedidos_guardia_transicion (002).
--  2) Trigger que recalcula equipment_rentals.cantidad_activa desde la suma de
--     movimientos (data-model.md §Equipos): la fuente de verdad son los
--     movimientos, no la aplicacion; el CHECK >= 0 queda como segunda barrera.
--
-- Nota: la guardia "anulada solo sin recepciones" (regla dura 1 de la OC) exige
-- joins y vive en packages/core + tool; aqui solo se valida la forma de la
-- transicion.
-- ---------------------------------------------------------------------------

create or replace function purchase_orders_guardia_transicion()
returns trigger
language plpgsql
as $$
begin
  -- Regla dura 2 de la OC: recibida_total y anulada son terminales e inmutables.
  if old.estado in ('recibida_total', 'anulada') then
    raise exception
      'OC % en estado terminal % es inmutable (state-machine.md, Ciclo de la OC)',
      old.numero, old.estado
      using errcode = 'check_violation';
  end if;

  -- Sin cambio de estado: se permite actualizar otras columnas
  -- (p.ej. confirmada_por_proveedor_at, pdf_attachment_id).
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  if (old.estado, new.estado) in (
    ('emitida', 'confirmada'),
    ('emitida', 'recibida_parcial'),
    ('emitida', 'recibida_total'),
    ('emitida', 'anulada'),
    ('confirmada', 'recibida_parcial'),
    ('confirmada', 'recibida_total'),
    ('confirmada', 'anulada'),
    ('recibida_parcial', 'recibida_total')
  ) then
    return new;
  end if;

  raise exception
    'Transicion de OC invalida: % -> % (OC %; state-machine.md, Ciclo de la OC)',
    old.estado, new.estado, old.numero
    using errcode = 'check_violation';
end;
$$;

create trigger purchase_orders_guardia_transicion
  before update on purchase_orders
  for each row
  execute function purchase_orders_guardia_transicion();

-- ---------------------------------------------------------------------------
-- cantidad_activa = suma de movimientos, recalculada por trigger en la misma
-- transaccion del INSERT del movimiento. Los movimientos son inmutables por
-- diseño (correcciones = movimiento compensatorio, tools.md paridad), asi que
-- basta engancharse al INSERT.
-- ---------------------------------------------------------------------------

create or replace function equipment_movements_recalcula_activo()
returns trigger
language plpgsql
as $$
begin
  update equipment_rentals r
     set cantidad_activa = (
       select coalesce(
         sum(case m.tipo when 'entrada' then m.cantidad else -m.cantidad end), 0)
         from equipment_movements m
        where m.rental_id = new.rental_id
     )
   where r.id = new.rental_id;
  return new;
end;
$$;

create trigger equipment_movements_recalcula_activo
  after insert on equipment_movements
  for each row
  execute function equipment_movements_recalcula_activo();

-- Bloquear UPDATE/DELETE de movimientos: son el libro contable del alquiler
-- (correccion = movimiento compensatorio auditado, nunca edicion).
create or replace function equipment_movements_inmutables()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'equipment_movements es inmutable: correccion = movimiento compensatorio (tools.md)'
    using errcode = 'check_violation';
end;
$$;

create trigger equipment_movements_sin_update
  before update on equipment_movements
  for each row execute function equipment_movements_inmutables();

create trigger equipment_movements_sin_delete
  before delete on equipment_movements
  for each row execute function equipment_movements_inmutables();
