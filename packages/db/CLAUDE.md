# packages/db — esquema y migraciones

Fuente de verdad del esquema: `docs/specs/data-model.md`. SQL plano versionado, aplicado
por `scripts/migrate.mjs` (no ORM, no SQL manual en editores). Reemplaza el flujo
"aplicar a mano en Supabase" del prototipo.

## Estructura

- `migrations/NNN_nombre.sql` — DDL incremental, numerado (`001_...`, `002_...`).
  Cada archivo corre en **una transaccion** y se registra en `schema_migrations`.
  Nunca editar una migracion ya aplicada; agregar una nueva.
  **Bloques de numeracion reservados por workstream** (el runner es forward-only y sin
  checksums: dos ramas creando el mismo `NNN` colisionan en silencio — ver
  `docs/PLAN_FASE2A_2B_CONTROL_CENTER.md` §F0.3): `006` auth portal (aplicada), `007`
  outbox productivo (aplicada), `008` agent_control + config E3 (aplicada; conversaciones
  quedaron sin cambios de schema), `009` guardias OC/equipos (aplicada), `010`
  attachment_blobs (aplicada), `011+` libre.
- `seeds/NNN_nombre.sql` — datos base **idempotentes** (`ON CONFLICT DO NOTHING`):
  roles, los 5 usuarios/actores del PDF §4.1, proyectos, proveedores de ejemplo.
- `scripts/migrate.mjs` — runner (`up` | `status` | `seed`). Lo mantiene el humano.
- `tests/*.test.mjs` — smoke tests de esquema (node:test) contra `DATABASE_URL`; solo se
  corren en el job `migrations-gate` de CI (script `test:schema`), no en `test:all`.

## Comandos

```
DATABASE_URL=postgres://... npm run migrate       # aplica pendientes
DATABASE_URL=postgres://... npm run migrate:status
DATABASE_URL=postgres://... npm run seed
```

## Invariantes que el esquema DEBE imponer (data-model.md + EXECUTION_PLAN §1)

- `audit_events` **append-only**: sin UPDATE/DELETE (revocar por permisos + trigger que
  bloquea). Esta es la migracion mas sensible; no relajarla.
- Transiciones de `pedidos.estado` validadas tambien por trigger (defensa en profundidad
  frente a `packages/core`).
- Numeracion `PED-YYYY-NNN` / `OC-YYYY-NNN` via tabla de secuencias por año con
  `SELECT ... FOR UPDATE`; nunca `max()+1`.
- `inbound_messages.wamid` UNIQUE (clave de idempotencia del webhook).
- `outbox_messages` insertado en la misma transaccion que el efecto de dominio.
- `equipment_rentals.cantidad_activa` CHECK >= 0.
- Sin politicas RLS anonimas: al portal accede solo la API con su rol.
