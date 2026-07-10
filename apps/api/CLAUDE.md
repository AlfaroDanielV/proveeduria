# apps/api — ingesta del webhook + REST del portal

Container App con ingress externo. En el Modulo 1 su unica responsabilidad de escritura
es **ingerir el webhook de WhatsApp de forma segura y encolar**; el procesamiento de IA/OCR
y la maquina de estados corren en `apps/worker`. Tambien expone REST para el portal Fase 2a.
El seam navegable de auth interna es `X-User-Id`; sesiones/cookies quedan para fase posterior
antes de produccion.

## Controles NO negociables del webhook (EXECUTION_PLAN §1; data-model.md)

El handler del webhook, en este orden estricto, y **antes** de cualquier procesamiento:

1. **Verificar firma** `X-Hub-Signature-256` = `sha256=HMAC_SHA256(appSecret, rawBody)`.
   Comparar en tiempo constante (`crypto.timingSafeEqual`). Firma invalida → 401, sin efecto.
   Usar el **cuerpo crudo (bytes)**, no el JSON re-serializado.
2. **GET de verificacion** (`hub.mode=subscribe`): validar `hub.verify_token` y devolver
   `hub.challenge`.
3. **Dedup + persistencia**: `INSERT INTO inbound_messages (wamid, ...) ON CONFLICT (wamid)
   DO NOTHING`. La idempotencia es por `wamid`. Persistir SIEMPRE antes de encolar.
4. **Encolar solo si se inserto** (fila nueva): empujar el job a la cola (`QueueClient`).
   Si el `INSERT` no afecto filas (duplicado de Meta), no encolar → un solo efecto.
5. **Responder 200 rapido** a Meta. Nada de IA/OCR/red externa en el hilo del webhook.

Fallar-cerrado: si falta el app secret o la firma, se rechaza; nunca se procesa sin verificar.

## Estructura sugerida (testeable sin socket ni Azure)

- `src/webhook/verify.ts` — verificacion de firma y del challenge (funciones **puras**;
  test: firma valida, invalida, ausente, cuerpo alterado).
- `src/webhook/parse.ts` — normaliza el payload de Meta a un `MensajeEntrante` tipado.
- `src/webhook/ingest.ts` — orquesta persistir→encolar dado `{ db, queue }` inyectados
  (interfaces), para poder testear con fakes en memoria (test: wamid duplicado = 1 encolado).
- `src/queue/` — interfaz `QueueClient` + impl in-memory (tests) y stub Azure Storage
  Queues / Postgres (prod). Aisla la cola detras de una interfaz (cookbook §1.4).
- `src/db/` — acceso `pg` para `inbound_messages` (parametrizado, nunca SQL por string).
- `src/portal/` — API read-only del portal: `/api/portal/me`, lista/detalle de pedidos y
  comparativo deterministico. Usa `X-User-Id`, roles de `@proveeduria/core`/DB y alcance por
  `user_roles.project_id`; no expone Postgres directo al navegador.
- `src/index.ts` — `node:http` server que ata todo y lee config de env.

No usar frameworks pesados; `node:http` alcanza. La logica va en funciones puras/inyectadas
para que los tests de `vitest` no abran sockets ni toquen la red.

## TS / imports

ESM + NodeNext: imports relativos con extension `.js`. `import type` para tipos.
`@proveeduria/core` y `@proveeduria/agent` resuelven via workspace build; en tests se usa
alias de vitest cuando aplica.
