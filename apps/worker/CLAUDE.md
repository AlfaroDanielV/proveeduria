# apps/worker — consumidor de cola y motor de dominio

Container App sin ingress (KEDA escala por profundidad de cola; min 1 replica en prod).
Consume los jobs que `apps/api` encola y ejecuta **todo el trabajo pesado**: agente Claude
(router + tools de `@proveeduria/agent`), OCR (Document Intelligence / Vision), la maquina
de estados de `@proveeduria/core`, el dispatcher del `outbox` a WhatsApp, y los cron
(vencimiento de plazos E1, atascos E13, resumen diario).

## Estado actual Fase 2a

El composition root (`src/index.ts`) ya monta el runtime real segun la config
(`planificarArranque`, funcion pura testeable): sin `DATABASE_URL` queda el stub dev
(echo + InMemory); con `DATABASE_URL` monta el domain handler real, y con
`AZURE_STORAGE_QUEUE_CONNECTION` el consumidor durable de Azure Storage Queues
(`src/queue/azure.ts`: visibility timeout, `dequeueCount`→`intento`, cola de veneno
`<nombre>-poison`, backoff en nack — contrato en `docs/specs/broker-colas.md`). El loop de
consumo sobrevive blips del broker (`error_broker`, nunca tumba el proceso). Apagado
ordenado por SIGTERM/SIGINT. El dispatcher de outbox corre en loop solo con
`WORKER_OUTBOX_MODE=console` (dev: `ConsoleSender` marca enviado SIN enviar; el sender
real de Meta es A3 del plan).

El handler de dominio en `src/domain/`:

- Lee `inbound_messages` por `wamid` con `FOR UPDATE`.
- Respeta idempotencia por `processed_at`.
- Toma lock advisory por `pedido_id` cuando el job lo trae.
- Resuelve remitente `interno|proveedor|desconocido` contra `users` y `supplier_contacts`.
- Para internos crea `Ctx` real de `@proveeduria/agent` con origen `wamid`.
- Para desconocidos aplica E11: audit + outbox generico, sin ejecutar tools.
- Delega a un `DomainEngine` inyectable; el engine estructurado actual solo acepta payloads
  `tool_call` ya normalizados mediante `@proveeduria/agent` y no reemplaza al loop Claude
  model-backed ni a extractores.
- `src/outbox/dispatcher.ts` implementa el dispatcher transaccional de `outbox_messages`:
  toma pendientes/fallidos con `FOR UPDATE SKIP LOCKED`, usa un `OutboxSender` inyectable,
  marca `enviado` con `wamid_salida` o `fallido` con backoff exponencial.

El outbox ya es productivo (A3, `docs/specs/outbox-whatsapp.md`): dispatcher
claim→send→mark en transacciones separadas con taxonomia de errores Meta
(permanente→`descartado`+audit, rate-limit corta el batch, transitorio con backoff y tope
`max_intentos`), y `MetaOutboxSender` real (`src/outbox/meta-sender.ts`: texto con chunking
4096, plantillas con `payload.variables`, documento por link, `WORKER_OUTBOX_MODE=meta`
fail-closed en config).

Pendiente para completar el camino runtime productivo: persistencia de conversaciones (A4),
Claude/tool loop model-backed (A5), extractores y camino del proveedor (A6) y cron E1 (A7)
— ver `docs/PLAN_FASE2A_2B_CONTROL_CENTER.md`. El consumidor Azure y el sender Meta estan
validados con fakes; falta validarlos contra Azurite/Meta real al desplegar (D-3 del plan).

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
