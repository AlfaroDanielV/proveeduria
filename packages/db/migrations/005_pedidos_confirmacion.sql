-- 005_pedidos_confirmacion.sql
-- Confirmacion explicita del resumen de pedido sin transicionar estado.
-- Fuente: docs/specs/data-model.md §Flujo de pedido, docs/specs/tools.md confirmar_pedido.

alter table pedidos
  add column confirmado_at timestamptz,
  add column confirmado_por uuid references users(id);
