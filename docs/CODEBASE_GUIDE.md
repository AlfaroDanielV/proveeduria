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

El sistema nuevo cerro gran parte de Fase 2a y arranco 2b/Centro de Control (ver
`docs/PLAN_FASE2A_2B_CONTROL_CENTER.md` §Progreso y `docs/handoff/FASE2A-current-status.md`):
tools deterministicas hasta `en_revision` + comparativo, broker durable de Azure Storage
Queues (producer+consumer reales), outbox productivo con sender real de Meta
(claim→send→mark, taxonomia de errores, statuses), composition root real del worker, portal
React+Vite con auth real (login scrypt + JWT cookie; el seam `X-User-Id` fue eliminado),
CRUD de proveedores y cola de revision, y los helpers 2b de core (OC, cobertura, E3/E9/E13,
pausa). Falta: conversaciones (A4), loop Claude model-backed (A5), extractores (A6), cron E1
(A7), cadena de tools B3-B8 y despliegue (D).

## Mapa principal

### `docs/`

- `docs/EXECUTION_PLAN.md`: arquitectura y roadmap por fases. Usalo para saber en que etapa va el
  proyecto y que queda fuera de alcance.
- `docs/specs/`: contratos normativos del dominio.
  - `tools.md`: tools del agente, roles, inputs y efectos.
  - `state-machine.md`: estados/transiciones del pedido.
  - `data-model.md`: tablas y cardinalidades.
  - `exceptions.md`: reglas E1-E13.
  - `portal-api.md`: contrato REST del portal Fase 2a.
  - `templates-whatsapp.md`: plantillas candidatas de WhatsApp.
  - `broker-colas.md`: contrato del broker de ingesta api→worker (wire format, visibility, veneno).
  - `outbox-whatsapp.md`: dispatcher claim→send→mark, taxonomia de errores Meta, statuses.
  - `control-center.md`: portal interno — auth real, matriz de permisos web, pantallas por olas.
- `docs/handoff/FASE2A-current-status.md`: estado operativo actual para continuar Fase 2a.
- `docs/handoff/FASE2A-next-session-prompt.md`: prompt copy-paste para arrancar una sesion
  nueva desde el punto exacto del cierre Fase 2a navegable.
- `docs/handoff/FASE2A-slice1-pedido.md`: work order original de Slice 1.
- `docs/AI_ASSISTED_DEVELOPMENT.md`: disciplina de trabajo con agentes.
- `docs/DEPLOYMENT_COOKBOOK.md`: notas de despliegue/WhatsApp/Azure.

### `packages/core/`

Dominio puro, sin IO.

- `src/types.ts`: vocabulario congelado del dominio: roles, estados, codigos de excepcion,
  tipos de aprobacion, umbrales (incluye `similitudMinFacturaOc`), `CampoExtraido<T>`/
  `CamposFacturaExtraida`.
- `src/roles.ts`: matriz tool -> roles permitidos y `puedeUsarTool`.
- `src/state-machine.ts`: tabla de transiciones del pedido y `puedeTransicionar`.
- `src/oc-state-machine.ts`: tabla de transiciones de la OC y `puedeTransicionarOc`/
  `esTerminalOc` (state-machine.md §Ciclo de la OC).
- `src/numbering.ts`: formateo/parsing PED/OC; el lock real vive en DB.
- `src/exceptions.ts`: reglas deterministicas E1, E2, E4, E5, E9 (incluye evaluacion
  por-campo), E10, E12, E13 (incluye reincidencia), y umbrales por defecto.
- `src/recepcion.ts`: computo de cobertura de recepcion de OC/pedido y sugerencia de cierre
  (state-machine.md §Computo de cobertura, reglas duras 3 y 4).
- `src/matching.ts`: matching deterministico factura<->OC (E3): normalizacion, similitud de
  tokens y score ponderado.
- `src/agent-control.ts`: predicado de pausa del agente por alcance (control-center.md
  §Pausa del agente).
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
- `migrations/006_portal_auth.sql`: `user_credentials` + `portal_sessions` (Centro de Control).
- `migrations/007_outbox_envio.sql`: outbox productivo (`enviando`/`descartado`, lease,
  `max_intentos`, adjunto, columnas `entrega_*` de statuses).
- `migrations/008_agent_control_config.sql`: `agent_control` (pausa del agente) + umbral E3.
- `migrations/009_oc_equipos_guardias.sql`: trigger de transiciones de OC + recomputo de
  `cantidad_activa` + inmutabilidad de `equipment_movements`.
- `seeds/001_base.sql`: roles, usuarios, proyectos y proveedores de prueba.
- `scripts/migrate.mjs`: aplica migraciones y seeds.

Regla: no edites migraciones ya aplicadas; agrega `010_*.sql` si falta schema (bloques
reservados por workstream en packages/db/CLAUDE.md).

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
- `src/agent/structured.ts`: extrae `tool_call` JSON whitelisted desde payload/texto.
- `src/agent/tool-dispatcher.ts`: ejecuta las tools Fase 2a permitidas.
- `src/agent/loop.ts`: loop deterministico con modelo opcional inyectable.

Hoy estas tools se prueban directamente y el worker puede recibir un engine estructurado
inyectable. Falta conectar el adapter real de Claude/prompt humano para conversacion libre.

### `apps/api/`

Webhook production-safe + REST de portal.

- `src/webhook/verify.ts`: verifica firma `X-Hub-Signature-256`.
- `src/webhook/parse.ts`: parsea payload Meta (mensajes + `statuses` de entrega).
- `src/webhook/ingest.ts`: persiste inbound, encola solo si `wamid` es nuevo, y aplica
  statuses al outbox (`aplicarStatuses`).
- `src/db/inbound.ts` / `src/db/entregas.ts`: stores PG + fakes (entregas = guard
  monotonico sent<delivered<read).
- `src/queue/`: interfaz de cola + `AzureStorageQueue` real (wire `{v:1,wamid}` base64,
  ver docs/specs/broker-colas.md).
- `src/config.ts`: fail-closed para secretos/config (incluye `PORTAL_JWT_SECRET`/`PORTAL_ORIGIN`).
- `src/portal/`: auth real (crypto.ts scrypt+JWT, auth-store/auth-routes, rate-limit) y
  endpoints: `/me`, pedidos (lista/detalle/comparativo), `auth/*`, proveedores CRUD +
  contactos + opt-in/BAJA, revisiones (lista/resolver). Contrato en docs/specs/portal-api.md.

Flujo actual de webhook: payload Meta -> verificar/parsear -> `inbound_messages` -> Azure
Storage Queue -> worker; statuses -> UPDATE de outbox. Flujo actual de portal: cookie
`portal_token` (JWT verificado en servidor) -> actor por DB -> roles/alcance -> SQL
parametrizado; mutaciones con CSRF header + audit transaccional.

### `apps/portal/`

Centro de Control (React 19 + Vite; invariantes en apps/portal/CLAUDE.md).

- `src/api/cliente.ts`: unico cliente HTTP (cookies httpOnly, CSRF automatico en
  mutaciones, 401 -> un refresh y reintento).
- `src/components/`: Login/CambiarPassword, Shell con nav por rol, pedidos
  (lista/detalle/comparativo), proveedores (CRUD/contactos/opt-in/BAJA), revisiones
  (resolver).
- `src/permisos.ts`: espejo UI de la matriz de control-center.md (la verdad vive en el
  servidor).
- `npm run dev` = Vite con proxy `/api` -> `localhost:8080`; `npm run build` -> `dist/`;
  `npm run typecheck` y `npm run test` (vitest + testing-library) cableados.

### `apps/worker/`

Consumidor de cola y futuro motor de dominio.

- `src/consumer.ts`: loop generico `poll -> handler -> ack/nack`.
- `src/handlers/echo.ts`: handler minimo actual.
- `src/domain/handler.ts`: handler de dominio Fase 2a; abre transaccion, lee
  `inbound_messages`, aplica idempotencia, lock por pedido, resuelve remitente y crea `Ctx`.
- `src/domain/router.ts`: resolucion `users`/`supplier_contacts`/desconocido por telefono.
- `src/domain/e11.ts`: respuesta generica + audit/outbox para remitente desconocido.
- `src/domain/structured-engine.ts`: engine temporal para payloads `tool_call` ya
  estructurados; no reemplaza Claude loop ni extractores.
- `src/outbox/dispatcher.ts`: dispatcher de `outbox_messages` con `FOR UPDATE SKIP LOCKED`,
  sender inyectable, `wamid_salida`, intentos y backoff.
- `src/queue/`: consumidor in-memory para tests/stub.
- `src/config.ts`: config del worker.

El arranque por defecto sigue usando `echo` hasta tener broker/engine reales. El handler de
dominio y el dispatcher de outbox ya estan listos para inyectarse en tests o en wiring posterior.

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
persistir antes de procesar y encolar. `apps/worker` ya puede leer el mensaje persistido,
resolver remitente y crear `Ctx`; todavia falta el loop Claude/extractor real para convertir
conversacion libre en tool calls.

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

Hito navegable ya cubierto con harness estructurado:

1. Tools pedido/RFQ/cotizacion/comparativo.
2. Worker handler/router + engine `tool_call` estructurado.
3. API REST de portal.
4. Portal: lista de pedidos, detalle, comparativo.

Pendiente para runtime productivo sobre WhatsApp real:

1. Integrar extractores texto/voz/foto hacia inputs estrictos.
2. Conectar adapter real de Claude con prompt humano y goldens.
3. Conectar broker real.
4. Conectar sender real de Meta para `outbox_messages`.

## Retomar en una sesion nueva

Usa `docs/handoff/FASE2A-next-session-prompt.md` como prompt de arranque. Ese archivo lista
los docs que hay que leer, el estado actual, la verificacion ya corrida y los proximos bloques
pendientes. Antes de avanzar, confirmar `git status --short --branch` y respetar cualquier
cambio existente sin modificar staging.

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
npm run test -w @proveeduria/api -- --run src/portal/repo.integration.test.ts
npm run test -w @proveeduria/worker -- --run src/outbox/dispatcher.integration.test.ts
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
