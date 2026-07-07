# apps/worker — consumidor de cola y motor de dominio

Container App sin ingress (KEDA escala por profundidad de cola; min 1 replica en prod).
Consume los jobs que `apps/api` encola y ejecuta **todo el trabajo pesado**: agente Claude
(router + tools de `@proveeduria/agent`), OCR (Document Intelligence / Vision), la maquina
de estados de `@proveeduria/core`, el dispatcher del `outbox` a WhatsApp, y los cron
(vencimiento de plazos E1, atascos E13, resumen diario).

## Estado en este incremento (Fase 1)

**Stub navegable**: el esqueleto del consumidor existe y arranca, pero los handlers de
dominio aun no estan implementados (Fase 2). El objetivo Fase-1 es cerrar el lazo
"mensaje entra en api → se persiste → worker lo toma → responde" con un handler minimo.

## Invariantes cuando se implemente el dominio

- **Orden por pedido**: lock advisory de Postgres por `pedido_id` (no sesiones de broker).
- **Idempotencia**: un job ya procesado (`inbound_messages.processed_at`) no se reprocesa.
- **Outbox**: ningun envio de WhatsApp directo; se inserta en `outbox_messages` en la misma
  transaccion que el efecto de dominio y un dispatcher lo envia y registra `wamid_salida`.
- **Transiciones** solo via `@proveeduria/core` (que ademas valida el trigger de la BD).
- **Reintentos**: fallo transitorio → re-encola con backoff; nunca pierde ni duplica efecto.

## TS / imports

ESM + NodeNext (imports relativos con `.js`, `import type` para tipos). `@proveeduria/core`
y `@proveeduria/agent` resuelven a fuente via `paths` (typecheck) y alias de vitest (tests).
