# Spec: Outbox y envío de WhatsApp

Contrato del dispatcher de `outbox_messages` (worker) y del sender real de Meta Cloud API,
más el tracking de entrega (`statuses` del webhook). Complementa `broker-colas.md` (ingesta
entrante) y `data-model.md`. Invariante intocable: **ningún envío de WhatsApp fuera de
`outbox_messages`**; el dispatcher es el único que habla con Meta.

## Esquema (migración 007)

`outbox_messages` gana:

| Columna | Tipo | Uso |
|---|---|---|
| `attachment_id` | uuid FK `attachments` null | Documento a adjuntar (header de plantilla, ej. PDF de OC — se activa con B4) |
| `max_intentos` | int not null default 8 | Tope de reintentos transitorios por fila |
| `claimed_at` | timestamptz | Lease del claim (estado `enviando`) |
| `error_ultimo` | text | Diagnóstico del último fallo |
| `entrega_estado` | text check `sent\|delivered\|read\|failed` | Último status reportado por Meta |
| `entrega_actualizada_at` | timestamptz | Momento del último status |
| `entrega_error` | jsonb | `errors[]` de Meta cuando `failed` |

`estado` amplía su check a `pendiente|enviando|enviado|fallido|descartado`. Índice nuevo por
`wamid_salida` (lookup de statuses); el índice parcial de pendientes cubre también `enviando`.

## Ciclo de vida

```
pendiente ──claim──► enviando ──ok──► enviado ──statuses──► (entrega_estado)
                        │ error transitorio (intentos < max) ──► fallido ──next_retry──► claim
                        │ error permanente, o intentos ≥ max ──► descartado (terminal + audit)
enviando huérfano (crash): reclamable cuando claimed_at ≤ now − lease
```

- El **claim incrementa `intentos`** (un crash a mitad de envío consume un intento: acota
  duplicados y reintentos).
- `descartado` es terminal: registra `audit_event(outbox_descartado)` (actor sistema,
  entidad `outbox_message`, `pedido_id` desde `payload.pedido_id` si existe). Aparece en el
  resumen diario y el Centro de Control; la reactivación manual será acción del portal (C3).
- `enviado` significa "aceptado por Meta" (hay `wamid_salida`); la entrega real la reportan
  los statuses (`entrega_estado`).

## Dispatcher: claim → send → mark (transacciones separadas)

1. **Claim** (tx corta): `UPDATE ... SET estado='enviando', claimed_at=now, intentos=intentos+1`
   sobre un subselect `FOR UPDATE SKIP LOCKED` que toma `pendiente`, `fallido` con
   `next_retry_at` vencido, y `enviando` con lease vencido (`OUTBOX_CLAIM_LEASE_S`, default
   300s). Orden `created_at, id`. Límite `OUTBOX_BATCH` (default 20).
2. **Send** fuera de toda transacción (nunca se sostienen locks durante HTTP).
3. **Mark** (tx corta por mensaje): `enviado` con `wamid_salida` / `fallido` con backoff /
   `descartado` con audit.
4. **Rate limit**: el mensaje afectado queda `fallido` con `next_retry_at =
   max(Retry-After, backoff)` y el resto del batch reclamado se **libera** de vuelta a
   `pendiente` (`claimed_at=null`, revirtiendo el `intentos` que el claim les sumó: no
   hubo intento de envío) — no se martilla a Meta ni se desperdicia el lease.

Garantía: **at-least-once**. Un crash entre el accept de Meta y el mark produce a lo sumo un
duplicado tras vencer el lease (Meta no ofrece clave de idempotencia); el incremento de
`intentos` en el claim lo acota a `max_intentos` en el peor caso.

Backoff transitorio: `min(60s × 2^(intentos−1), 15min)`.

## Contenido del mensaje (Meta Cloud API)

- **Texto de sesión** (`texto ≠ null`): `type: text`. Cuerpos > 4096 chars se parten en
  chunks secuenciales; `wamid_salida` = wamid del **primer** chunk (fallo parcial de chunks
  posteriores = error del envío completo; el reintento puede duplicar chunks — aceptado,
  los textos del dominio son cortos).
- **Plantilla** (`template ≠ null`): `type: template`, `language.code = payload.idioma ??
  'es'`, `components.body.parameters` = `payload.variables` (array posicional de strings,
  mapea a `{{1}}..{{n}}` de `templates-whatsapp.md`; **convención que las tools ya
  escriben**). Plantilla sin `payload.variables` (array de strings) ⇒ error **permanente**.
- **Documento** (header de plantilla, ej. `oc_emitida`): dos caminos, en orden de
  precedencia en el sender:
  1. `outbox_messages.attachment_id` ≠ null → el sender construye el link **al momento del
     envío**: `GET {PUBLIC_API_URL}/api/attachments/:id?f=<firma>` con firma HMAC
     (`ATTACHMENTS_LINK_SECRET`, compartido api/worker; JWT HS256 con `sub=attachment_id`,
     vida 72h — cubre los reintentos del dispatcher con margen). `filename` =
     `payload.documento_nombre` o `documento.pdf`. Meta descarga el documento de ese link
     al entregar la plantilla.
  2. `payload.documento = { link, filename }` explícito (links ya públicos).

## Documentos adjuntos (PDF de OC — Módulo 1 sin Blob)

Mientras no exista Azure Blob (D-2), los bytes viven en Postgres: tabla
`attachment_blobs(attachment_id PK/FK, bytes bytea)` (migración 010) y
`attachments.blob_path = 'pg://attachment_blobs/<id>'`. Volumen esperado (~80 OCs/mes de
~100KB) es trivial para Postgres. `apps/api` expone `GET /api/attachments/:id?f=<firma>`
**sin cookie de sesión** (Meta lo descarga): valida la firma HMAC y el vencimiento,
responde `content_type` + bytes; firma inválida/vencida → 404 uniforme. Upgrade path: al
llegar Blob, `blob_path` pasa a `azure://...` y el mismo endpoint redirige a un SAS corto —
el contrato del link no cambia.
- **Ventana 24h**: la prevención activa (consultar `conversations`) llega con A4. Hasta
  entonces, el error 131047 de Meta se trata como permanente → `descartado` + audit; nunca
  reintento infinito.

## Taxonomía de errores (contrato sender → dispatcher)

El sender lanza `ErrorEnvio { tipo, codigo?, retryAfterMs?, detalle }`:

| `tipo` | Códigos Meta (`error.code`) | Acción del dispatcher |
|---|---|---|
| `permanente` | 100 (payload/param), 131026 (no entregable), 131047 (fuera de ventana), 131051 (tipo no soportado), 132000/132001 (plantilla no existe), 132005/132007/132012 (plantilla inválida/formato/params) | `descartado` inmediato + audit |
| `rate_limit` | 4 (throttled), 80007, 130429, 131048, 131056 | `fallido` con `max(Retry-After, backoff)`; corta el batch y libera el resto |
| `transitorio` | red/timeout, HTTP 5xx, y **cualquier código no listado** | `fallido` + backoff; a `descartado` si `intentos ≥ max_intentos` |

Cualquier excepción no tipada del sender se clasifica `transitorio`. El `ConsoleSender`
(dev) nunca falla; el modo `off` no corre el dispatcher.

## Statuses de Meta (`apps/api`)

El webhook trae `value.statuses[]` (`{ id, status, timestamp, recipient_id, errors? }`,
donde `id` es el `wamid_salida`). Hoy se descartan; pasan a procesarse **inline** en el
webhook (un solo UPDATE indexado, sin IA — no amerita cola):

- `UPDATE outbox_messages SET entrega_estado, entrega_actualizada_at, entrega_error` por
  `wamid_salida`, con guard **monotónico**: `sent < delivered < read` (un status de rango
  menor no pisa uno mayor); `failed` siempre se registra y guarda `errors` en
  `entrega_error`.
- Statuses con `wamid` desconocido se ignoran con log (tráfico del legado u otros).
- Idempotente: reentregas de Meta re-aplican el mismo UPDATE sin efecto adicional.

## Configuración (worker salvo indicado)

| Var | Default | Nota |
|---|---|---|
| `WORKER_OUTBOX_MODE` | `off` | `off` \| `console` (dev, no envía) \| `meta` (real) |
| `META_PHONE_NUMBER_ID` | — | Requerida en modo `meta` (falla-cerrado al armar el plan) |
| `META_ACCESS_TOKEN` | — | Requerida en modo `meta`; secreto (Key Vault en Azure) |
| `META_GRAPH_URL` | `https://graph.facebook.com/v23.0` | Base del API; sobreescribible en tests |
| `WORKER_OUTBOX_POLL_MS` | 2000 | Intervalo del loop |
| `OUTBOX_CLAIM_LEASE_S` | 300 | Reclaim de `enviando` huérfanos; > peor envío posible |
| `OUTBOX_BATCH` | 20 | Tamaño de claim |

Pendiente de copy (no bloquea A3): la variable 4 de `rfq_solicitud` hoy se encola como
ISO-8601 crudo (`plazoAt.toISOString()`); formatear fecha legible es tarea de pulido junto
con las plantillas aprobadas.
