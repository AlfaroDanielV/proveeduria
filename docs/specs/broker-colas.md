# Spec: Broker de colas (ingesta webhook → worker)

Contrato del transporte entre `apps/api` (productor) y `apps/worker` (consumidor) sobre
**Azure Storage Queues** (EXECUTION_PLAN §1: at-least-once + idempotencia por `wamid`; el
orden por pedido lo garantiza el lock advisory del worker, no el broker). Las
implementaciones en memoria para tests conservan este mismo contrato.

## Cola y nombres

- Cola de ingesta: **`ingesta`** (default). Configurable: `AZURE_STORAGE_QUEUE_NAME` en
  `apps/api` y `WORKER_QUEUE_NAME` en `apps/worker`; **deben coincidir** (el default del
  worker se alinea a `ingesta`; el valor previo `proveeduria-inbound` queda obsoleto).
- Cola de veneno: `<nombre>-poison` (ej. `ingesta-poison`). La crea el consumidor con
  `createIfNotExists`; su revisión es manual por ahora (futuro: alerta + Centro de Control).

## Formato de mensaje (wire)

JSON UTF-8 codificado en **base64** (convención de Azure Storage Queues):

```json
{ "v": 1, "wamid": "wamid.XXX", "pedidoId": "uuid opcional" }
```

- `v`: versión del contrato (hoy `1`). Versión desconocida → veneno.
- `wamid`: clave de idempotencia; referencia al `inbound_messages` **ya persistido**.
- `pedidoId`: reservado; hoy el productor no lo llena (la resolución de pedido para el
  lock advisory puede hacerse en el worker en una fase posterior).

**El job NO transporta el efecto de dominio.** El handler relee `fromPhone`, `tipo`,
`payload` y timestamps desde `inbound_messages` con `FOR UPDATE` — así no existen copias
stale entre broker y BD. En el worker, `Job` se adelgaza a
`{ id, wamid, intento, pedidoId? }` (el `id` identifica el intento de entrega del broker,
no el mensaje).

## Productor (`apps/api`)

1. Encola **solo si** el `INSERT` de `inbound_messages` insertó fila nueva (ya implementado
   en `ingest.ts`; duplicado de Meta = 0 encolados).
2. `enqueue` = `sendMessage(base64(json))`. Sin reintentos internos: si falla, la excepción
   sube, el webhook responde 500 y **Meta reintenta** (seguro por dedup de `wamid`; el
   webhook se mantiene rápido).
3. `NODE_ENV=production` sin cola real sigue siendo arranque rechazado (falla-cerrado,
   `config.ts`).

## Consumidor (`apps/worker`)

- `poll()`: `receiveMessages(1, visibilityTimeout = WORKER_VISIBILITY_S, default 120s)`.
  Decodifica y valida el wire; `intento = dequeueCount`.
- **Malformado** (base64/JSON inválido, `v` desconocida, `wamid` vacío): copia el cuerpo
  original a la cola de veneno y borra el mensaje. Nunca se pierde, nunca se reintenta.
- **Agotado** (`dequeueCount > WORKER_MAX_DEQUEUE`, default 5): veneno + borrar. El
  reproceso es manual (el mensaje sigue persistido en `inbound_messages`).
- `ack(job)`: `deleteMessage(messageId, popReceipt)`. El `popReceipt` es interno del
  consumidor (mapa `id → popReceipt`); no viaja en `Job`.
- `nack(job)`: backoff controlado con `updateMessage(visibilityTimeout =
  min(300s, 5s × 2^(intento−1)))`; si `updateMessage` falla, se deja expirar la
  visibilidad (el mensaje reaparece solo).
- Reentrega tras crash: segura — el handler es idempotente por `processed_at` + `wamid`.

## Garantías y no-garantías

| Garantía | Cómo |
|---|---|
| At-least-once | Storage Queues + visibility timeout |
| Sin duplicar efecto | Dedup `wamid` (api) + `processed_at` (worker) |
| Orden por pedido | `pg_advisory_xact_lock` en el handler — **no** el broker |
| Nunca perder un job | Veneno durable en `-poison`; el mensaje original queda en `inbound_messages` |
| FIFO global | **No garantizado** (no se necesita) |

## Configuración

| Var | App | Default | Nota |
|---|---|---|---|
| `AZURE_STORAGE_QUEUE_CONNECTION` | api y worker | — | Sin ella: InMemory (solo dev/test) |
| `AZURE_STORAGE_QUEUE_NAME` | api | `ingesta` | |
| `WORKER_QUEUE_NAME` | worker | `ingesta` | Debe coincidir con la de api |
| `WORKER_VISIBILITY_S` | worker | `120` | Presupuesto de procesamiento por intento |
| `WORKER_MAX_DEQUEUE` | worker | `5` | Umbral de veneno |
| `WORKER_POLL_EMPTY_MS` | worker | `1000` | Espera con cola vacía |
