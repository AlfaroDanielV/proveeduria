# Guia del codebase — Proveeduria Proyekta

Esta guia es para navegar el repo sin tener que reconstruir la arquitectura desde cero.
La fuente de verdad de comportamiento sigue siendo `docs/specs/` y el plan objetivo es
`docs/EXECUTION_PLAN.md`.

## Estado rapido

Hay dos sistemas conviviendo:

- **Prototipo legado**: `server.js` + `dashboard/`. Funciona como referencia de comportamiento,
  pero no debe crecer con nuevas features de produccion.
- **Sistema nuevo Modulo 1**: monorepo TypeScript en `packages/*` y `apps/*`. Este es el camino
  de produccion definido por `docs/EXECUTION_PLAN.md`.

El sistema nuevo esta en **Fase 2a**. Ya existe la capa deterministica de tools para pedido/RFQ/
cotizaciones hasta `pedido.estado = en_revision` con comparativo generado, pero aun falta
conectarla al worker, al router, al loop Claude y al portal.

## Mapa principal

### `docs/`

- `docs/EXECUTION_PLAN.md`: arquitectura y roadmap por fases. Usalo para saber en que etapa va el
  proyecto y que queda fuera de alcance.
- `docs/specs/`: contratos normativos del dominio.
  - `tools.md`: tools del agente, roles, inputs y efectos.
  - `state-machine.md`: estados/transiciones del pedido.
  - `data-model.md`: tablas y cardinalidades.
  - `exceptions.md`: reglas E1-E13.
  - `templates-whatsapp.md`: plantillas candidatas de WhatsApp.
- `docs/handoff/FASE2A-current-status.md`: estado operativo actual para continuar Fase 2a.
- `docs/handoff/FASE2A-slice1-pedido.md`: work order original de Slice 1.
- `docs/AI_ASSISTED_DEVELOPMENT.md`: disciplina de trabajo con agentes.
- `docs/DEPLOYMENT_COOKBOOK.md`: notas de despliegue/WhatsApp/Azure.

### `packages/core/`

Dominio puro, sin IO.

- `src/types.ts`: vocabulario congelado del dominio: roles, estados, codigos de excepcion,
  tipos de aprobacion, umbrales.
- `src/roles.ts`: matriz tool -> roles permitidos y `puedeUsarTool`.
- `src/state-machine.ts`: tabla de transiciones y `puedeTransicionar`.
- `src/numbering.ts`: formateo/parsing PED/OC; el lock real vive en DB.
- `src/exceptions.ts`: reglas deterministicas E1, E2, E4, E5, E9, E10, E12, E13.
- `src/policy.ts`: acciones que requieren `approval_events`.

Regla: si una regla de negocio cambia, primero cambia la spec y despues los tests/core.

### `packages/db/`

Migraciones SQL versionadas e idempotent seeds.

- `migrations/001_*`: extensiones, identidad/acceso, maestros, config, numeracion con
  `siguiente_numero(prefijo, anio)` y `FOR UPDATE`.
- `migrations/002_*`: `pedidos`, `pedido_items`, cotizaciones y trigger de transiciones.
- `migrations/003_*`: OC, facturas, recepcion, notas de credito, equipos.
- `migrations/004_*`: inbound/outbox, review queue, approval/audit append-only, vistas.
- `migrations/005_pedidos_confirmacion.sql`: `confirmado_at` / `confirmado_por`.
- `seeds/001_base.sql`: roles, usuarios, proyectos y proveedores de prueba.
- `scripts/migrate.mjs`: aplica migraciones y seeds.

Regla: no edites migraciones ya aplicadas; agrega `006_*.sql` si falta schema.

### `packages/agent/`

Runtime y tools deterministicas del agente.

- `src/runtime/types.ts`: contratos de `Actor`, `Ctx`, repos, audit/outbox/approval y entidades.
- `src/runtime/tx.ts`: `withTx(pool, fn)` abre una transaccion por tool.
- `src/runtime/context.ts`: construye `Ctx` real con repos PG.
- `src/runtime/audit.ts`: inserta `audit_events`.
- `src/runtime/outbox.ts`: inserta `outbox_messages`.
- `src/runtime/approval.ts`: inserta `approval_events`.
- `src/runtime/repos.ts`: implementaciones PG parametrizadas.
- `src/runtime/fakes.ts`: fakes con snapshot/rollback para unit tests.
- `src/tools/pedido.ts`: tools ya implementadas:
  - `crearPedido`
  - `confirmarPedido`
  - `sugerirProveedores`
  - `enviarRfq`
  - `registrarCotizacion`
  - `generarComparativo`
- `src/tools/pedido.test.ts`: contrato unitario con fakes.
- `src/tools/pedido.integration.test.ts`: flujo real contra Postgres efimero.

Hoy estas tools se prueban directamente; todavia no estan conectadas al worker.

### `apps/api/`

Webhook production-safe.

- `src/webhook/verify.ts`: verifica firma `X-Hub-Signature-256`.
- `src/webhook/parse.ts`: parsea payload Meta.
- `src/webhook/ingest.ts`: persiste inbound y encola solo si `wamid` es nuevo.
- `src/db/inbound.ts`: `PgInboundStore` + fake.
- `src/queue/`: interfaz de cola y stub Azure.
- `src/config.ts`: fail-closed para secretos/config.

Flujo actual: payload Meta -> verificar/parsear -> `inbound_messages` -> queue.

### `apps/worker/`

Consumidor de cola y futuro motor de dominio.

- `src/consumer.ts`: loop generico `poll -> handler -> ack/nack`.
- `src/handlers/echo.ts`: handler minimo actual.
- `src/queue/`: consumidor in-memory para tests/stub.
- `src/config.ts`: config del worker.

Hoy es un stub navegable. El siguiente salto real es reemplazar `echo` por un handler que lea
`inbound_messages`, resuelva remitente/contexto, abra `withTx`, cree `Ctx` e invoque tools.

### `server.js` y `dashboard/`

Prototipo legado.

- `server.js`: webhook, Claude loop, tools y Supabase en un archivo. Es referencia de comportamiento,
  no destino de nuevas features de produccion.
- `dashboard/`: React/Vite legacy con lecturas anon Supabase. El portal nuevo debe consumir API
  autenticada, no Postgres anon directo.

## Como funciona hoy

### Camino probado del sistema nuevo

El flujo deterministico ya probado contra Postgres efimero es:

1. `crearPedido`
   - actor interno autorizado crea `pedidos` en `borrador`.
   - DB genera numero `PED-YYYY-NNN` con `siguiente_numero`.
   - inserta `pedido_items`.
   - registra audit.
2. `confirmarPedido`
   - solicitante original confirma resumen.
   - fija `confirmado_at`/`confirmado_por`.
   - notifica a Proveeduria via outbox.
3. `sugerirProveedores`
   - lee items/proveedores activos con opt-in.
   - devuelve ranking editable.
   - registra audit.
4. `enviarRfq`
   - registra `approval_events(lista_proveedores)`.
   - crea `quote_requests`.
   - encola `rfq_solicitud` por proveedor.
   - transiciona `borrador -> cotizando`.
5. `registrarCotizacion`
   - guarda `quote_responses` y `quote_items`.
   - si incompleta: E2 con repregunta por outbox o `review_queue` si agoto intentos.
   - si completa: marca RFQ `respondida`.
   - cuando todas respondieron: transiciona `cotizando -> en_revision`.
6. `generarComparativo`
   - calcula SQL deterministico item x proveedor desde `pedido_items`, RFQs y la ultima
     respuesta completa por proveedor.
   - marca faltantes por sin respuesta, sin item, precio/cantidad faltante, cantidad menor
     a la solicitada o `disponible=false`.
   - registra audit y encola `notificacion_interna` con payload para WhatsApp/portal.
   - tambien se ejecuta automaticamente dentro de la transaccion de la ultima cotizacion
     completa que mueve el pedido a `en_revision`.

Todo eso corre dentro de transacciones cuando se usa `withTx`; los tests con fakes verifican
rollback de dominio + audit/outbox/approval/review.

### Camino actual del webhook

`apps/api` ya implementa la parte segura de entrada: verificar firma, deduplicar por `wamid`,
persistir antes de procesar y encolar. `apps/worker` todavia no invoca `packages/agent`.

## Como va a funcionar end-to-end completo

El flujo objetivo del Modulo 1 es:

1. WhatsApp envia mensaje a `apps/api`.
2. `apps/api` verifica firma, parsea payload, inserta `inbound_messages` con idempotencia por
   `wamid`, encola job y responde 200 rapido.
3. `apps/worker` consume job.
4. Worker lee mensaje persistido, resuelve remitente:
   - usuario interno: `users` + `user_roles`.
   - proveedor: `supplier_contacts`.
   - desconocido: E11 sin datos sensibles.
5. Worker/router decide contexto conversacional y crea `Ctx`:
   - `Actor`
   - `Tx`
   - reloj inyectado
   - repos PG
   - audit/outbox/approval helpers
6. Loop Claude decide tool call dentro del contrato humano del prompt.
7. Tool deterministica valida rol, input y guardas de estado.
8. Tool escribe dominio + audit + outbox/approval/review en una sola transaccion.
9. Dispatcher del outbox envia WhatsApp y registra `wamid_salida`, intentos y reintentos.
10. Portal consume API autenticada para ver pedidos, comparativos, review queue y dashboards.

## Flujo objetivo de Fase 2a

Para completar el prototipo navegable:

1. Conectar worker/router al flujo de tools.
2. Integrar extractor estructurado para texto/voz/foto de pedido/cotizacion.
3. Hacer que Claude invoque tools, pero sin decidir permisos ni saltarse guardas.
4. Portal: lista de pedidos, detalle, comparativo.

## Comandos de verificacion

Desde la raiz:

```bash
npm run build:all
npm run typecheck
npm run test:all
```

Postgres efimero para integration tests:

```bash
CID=$(docker run -d --rm -e POSTGRES_PASSWORD=provee -e POSTGRES_USER=provee \
  -e POSTGRES_DB=provee_test -p 55432:5432 postgres:16)
export DATABASE_URL=postgres://provee:provee@127.0.0.1:55432/provee_test
timeout 90 bash -c 'until psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; do :; done'
npm run migrate
npm run seed
npm run test -w @proveeduria/agent -- --run src/tools/pedido.integration.test.ts
docker stop "$CID"
```

En este entorno puede hacer falta ejecutar Docker/psql con permisos elevados para acceder al socket
Docker o al puerto local del contenedor.

## Reglas para navegar sin romper contratos

- Si cambias comportamiento, actualiza primero `docs/specs/`.
- Si necesitas schema, crea una migracion nueva.
- No envies WhatsApp directo desde tools: siempre `outbox_messages`.
- No hagas transiciones manuales: usa `@proveeduria/core` y deja que DB sea segunda barrera.
- No pongas decisiones criticas en Claude: la tool valida roles, estados y excepciones.
- No expandas `server.js`; el nuevo sistema vive en `apps/*` y `packages/*`.
- Mantene dominio/copy en español y tono de vos para mensajes al usuario.
