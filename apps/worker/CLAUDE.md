# apps/worker — consumidor de cola y motor de dominio

Container App sin ingress (KEDA escala por profundidad de cola; min 1 replica en prod).
Consume los jobs que `apps/api` encola y ejecuta **todo el trabajo pesado**: agente Claude
(router + tools de `@proveeduria/agent`), OCR (Document Intelligence / Vision), la maquina
de estados de `@proveeduria/core`, el dispatcher del `outbox` a WhatsApp, y los cron
(vencimiento de plazos E1, atascos E13, resumen diario).

## Estado actual Fase 2a

El esqueleto del consumidor sigue arrancando con `echo` por defecto, pero ya existe el
primer handler de dominio en `src/domain/`:

- Lee `inbound_messages` por `wamid` con `FOR UPDATE`.
- Respeta idempotencia por `processed_at`.
- Toma lock advisory por `pedido_id` cuando el job lo trae.
- Resuelve remitente `interno|proveedor|desconocido` contra `users` y `supplier_contacts`.
- Para internos crea `Ctx` real de `@proveeduria/agent` con origen `wamid`.
- Para desconocidos aplica E11: audit + outbox generico, sin ejecutar tools.
- Delega a un `DomainEngine` inyectable; el engine estructurado actual solo acepta payloads
  `tool_call` ya normalizados y no reemplaza al loop Claude ni a extractores.

Pendiente para completar el camino runtime: consumidor real del broker, Claude/tool loop,
extractores y dispatcher del outbox.

## Invariantes del dominio

- **Orden por pedido**: lock advisory de Postgres por `pedido_id` (no sesiones de broker).
- **Idempotencia**: un job ya procesado (`inbound_messages.processed_at`) no se reprocesa.
- **Outbox**: ningun envio de WhatsApp directo; se inserta en `outbox_messages` en la misma
  transaccion que el efecto de dominio y un dispatcher lo envia y registra `wamid_salida`.
- **Transiciones** solo via `@proveeduria/core` (que ademas valida el trigger de la BD).
- **Reintentos**: fallo transitorio → re-encola con backoff; nunca pierde ni duplica efecto.

## TS / imports

ESM + NodeNext (imports relativos con `.js`, `import type` para tipos). `@proveeduria/core`
y `@proveeduria/agent` resuelven a fuente via `paths` (typecheck) y alias de vitest (tests).
