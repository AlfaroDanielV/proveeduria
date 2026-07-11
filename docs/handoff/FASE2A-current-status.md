# Handoff — Fase 2a estado actual

Ultima actualizacion: 2026-07-10 (tarde), despues de ejecutar Fase 0 + A1–A3 + B0–B4 +
C0–C2 del plan maestro (`docs/PLAN_FASE2A_2B_CONTROL_CENTER.md` — leerlo antes de
continuar; el §Progreso ahi es el estado canonico). **714 tests, 0 skips**, con
integracion real contra Postgres 16 y las 10 migraciones.

Hito mayor: el flujo `borrador → cotizando → en_revision → aprobado → ordenado` es
operable END-TO-END desde el portal web con auth real (bandeja de aprobaciones: enviar
RFQs, adjudicar desde el comparativo con snapshot D5, emitir OCs con PDF determinista
enviado por WhatsApp via outbox + link firmado), y por WhatsApp estructurado via worker.
Bloques B3 (`aprobar_ganador`), B4 (`emitir_oc` + endpoint publico de attachments +
sender con documento) y C2 (bandeja) completos y verificados. Falta de Fase 2a: A4
conversaciones, A5 loop Claude, A6 extractores/camino del proveedor, A7 cron E1. Falta de
2b: B5 `registrar_factura` en adelante. Migraciones aplicadas: 001–010.

Para arrancar una sesion nueva sin reconstruir contexto, usa
`docs/handoff/FASE2A-next-session-prompt.md`.

## Bloques nuevos completados (2026-07-10, working tree sin commitear)

- **Fase 0**: deploy legado gateado por paths (`main_proveeduria-webhook.yml` ya no
  redespliega con trabajo del monorepo); `templates-whatsapp.md` de-brandeado a `[EMPRESA]`
  (falta el display name real ANTES de someter a Meta — bloqueado en el negocio); copy E11
  sin marca; CLAUDE.md raiz corregido (firma fail-open, Map ~1013); bloques de migracion
  reservados en `packages/db/CLAUDE.md` (006 auth, 007 outbox, 008 conversaciones, 009
  equipos); `.env.example` en apps/api y apps/worker.
- **A1 broker durable** (spec nueva `docs/specs/broker-colas.md`): `AzureStorageQueue`
  real en apps/api (wire base64 `{v:1,wamid}`, sin reintentos internos — 500→retry de
  Meta es seguro por dedup); `AzureQueueConsumer` en apps/worker (visibility timeout,
  `dequeueCount`→intento, veneno `-poison` para malformados/agotados, backoff en nack,
  popReceipt interno); `TrabajoIngesta`/`Job` adelgazados (el handler relee TODO de
  `inbound_messages`); default de cola unificado a `ingesta`.
- **A2 composition root**: `planificarArranque` (matriz pura de modos) + `main()` real en
  apps/worker (pool PG, domain handler, consumer Azure/InMemory, loop de dispatcher solo
  con `WORKER_OUTBOX_MODE=console` via `ConsoleSender` dev, SIGTERM/SIGINT graceful);
  `structured-engine` ahora audita `pedido_id` del input; `consumer.ts` robustecido
  (`error_broker`: un blip de Azure no tumba el proceso; fix de leak de listeners en
  `esperar`).
- **A3 outbox productivo COMPLETO** (spec nueva `docs/specs/outbox-whatsapp.md`): migracion
  007 (`descartado` terminal, `max_intentos`, `claimed_at`/lease, `attachment_id`, columnas
  `entrega_*`); dispatcher rediseñado claim→send→mark en txs separadas (nunca HTTP con
  locks; rate-limit corta batch y libera; permanentes → `descartado` +
  `audit_event(outbox_descartado)` con origen `system`); `MetaOutboxSender` real
  (texto/plantilla/documento por link, chunking 4096, mapeo exacto de codigos Meta,
  Retry-After); ingesta de `statuses` en apps/api (guard monotonico sent<delivered<read,
  `failed` pegajoso, `entrega_error`); modo `meta` fail-closed en worker config. La empresa
  es **Atemporal** (marca aplicada en plantillas/E11/seeds/portal).
- **C0 arrancado**: spec nueva `docs/specs/control-center.md` (auth scrypt+JWT cookie,
  matriz de permisos web, acciones portal-only, pantallas por olas) + migracion 006
  (`user_credentials`, `portal_sessions`) aplicando limpia; `portal-api.md` extendido con
  contratos de auth/proveedores/revisiones; crypto core probado
  (`apps/api/src/portal/crypto.ts`).
- **B0 COMPLETO** (gate de specs 2b, autoriza los cambios de core protegido de B1):
  `state-machine.md` gana el ciclo de la OC + computo determinista de cobertura (regla 3)
  + actor de recepcion reconciliado (transiciona ActorSistema tras el approval del
  bodeguero); `exceptions.md` gana umbral E3 (`umbral_similitud_factura_oc`=0.6,
  `UmbralesConfig.similitudMinFacturaOc`), E9 por-campo (`CampoExtraido<T>`) y reincidencia
  E13 (contada de `audit_events(e13_recordatorio)`); `tools.md`: evidencia de adjudicacion
  = snapshot en `approval_events.detalle` (D5), anular OC fuera de Modulo 1, seccion de
  acciones web; `data-model.md`: `agent_control`, trigger de equipos.
- **Migraciones 008 y 009** verificadas en Postgres fresco (9/9 aplican, schema gate 6/6):
  008 = `agent_control` (pausa del agente, unica global vigente) + seed del umbral E3;
  009 = trigger de transiciones de OC (probado: rechaza `confirmada->emitida`), trigger
  que recalcula `cantidad_activa` desde movimientos (probado: 10-4=6; devolver 7 con 6
  activos rechazado por CHECK) e inmutabilidad de `equipment_movements`.
- **C1 COMPLETO — Centro de Control con auth real** (control-center.md + portal-api.md):
  login scrypt (dummy-hash anti-timing) + JWT HS256 verificado en servidor en cookie
  httpOnly SameSite=Strict + refresh opaco con rotacion + rate limit (5/identificador,
  20/IP, 15 min; `rate-limit.ts`) + CSRF header + CORS estricto (PORTAL_ORIGIN); el seam
  `X-User-Id` fue ELIMINADO; cambiar-password revoca TODAS las sesiones (spec actualizada);
  emision de credenciales solo superadmin con audit transaccional. Endpoints nuevos:
  proveedores CRUD + contactos + opt-in/BAJA y revisiones (resolver v1), todos con
  `audit_events` en la misma transaccion (`withTx` de @proveeduria/agent). Portal
  `apps/portal` reescrito en React 19 + Vite (ola 1): Login/CambiarPassword, Shell por rol,
  Pedidos (lista/detalle/comparativo), Proveedores (CRUD/contactos/opt-in/BAJA),
  Revisiones (resolver); cookies httpOnly sin tokens en JS; typecheck cableado
  (@types/react instalados). Falta de ola 1: bandeja de aprobaciones (va con C2 +
  enviar_rfq desde portal).
- **B1 COMPLETO — helpers 2b en packages/core** (protegido; autorizado por las specs B0,
  revisado): `oc-state-machine.ts` (9 transiciones, producto cartesiano testeado),
  `recepcion.ts` (cobertura regla 3 + `debeSugerirCierre`), `matching.ts` (E3: Jaccard de
  tokens 0.7 + cercania de monto 0.3, formula normativa en docstring; unico vs e3 con
  propuesta), `agent-control.ts` (pausa), E9 por-campo (`evaluarExtraccionFactura`),
  reincidencia E13, `alquilerDebeCerrarse`, `UmbralesConfig.similitudMinFacturaOc`.
  Ademas: se eliminaron artefactos compilados stale (`.js`/`.d.ts`) que estaban trackeados
  DENTRO de `packages/core/src/` y ensombrecian el codigo fuente en vitest (bug real
  preexistente); `PgConfigRepo.umbrales()` ahora mapea `umbral_similitud_factura_oc`.
- **Verificacion (ultima corrida)**: build:all + typecheck (todas las workspaces, portal
  incluido) + test:all contra Postgres 16 efimero con las 9 migraciones + seeds: **608
  tests, 0 skips** (core 326, api 159, worker 75, agent 33, portal 15). El consumidor
  Azure y el sender Meta estan probados con fakes; validacion contra Azurite/Meta real
  queda para el deploy (D-3) y el numero de prueba.

## Estado del proyecto segun `docs/EXECUTION_PLAN.md`

El proyecto esta en **Fase 2a — Prototipo navegable**. El hito navegable dia 30 ya queda
cubierto con harness estructurado: flujo pedido -> RFQ -> cotizaciones -> `en_revision` ->
comparativo, REST de portal y portal estatico nuevo. Lo que falta es endurecimiento de runtime
productivo sobre WhatsApp real: prompt/modelo Claude, extractores, broker real y sender real
de Meta para outbox.

## Ya implementado

En `packages/agent/src/tools/pedido.ts`:

- `crearPedido`
  - Valida rol con `puedeUsarTool('crear_pedido', actor.roles)`.
  - Valida proyecto activo e items.
  - Usa numeracion PED via `siguiente_numero('PED', anio)` desde Postgres.
  - Inserta `pedidos` en `borrador`, `pedido_items` y `audit_events`.
- `confirmarPedido`
  - Solo permite confirmar al solicitante original.
  - Mantiene `estado=borrador` y fija `confirmado_at`/`confirmado_por`.
  - Notifica a `admin_materiales` por `outbox_messages` con `notificacion_interna`.
- `sugerirProveedores`
  - Solo lectura de pedido/items/proveedores.
  - Rankea proveedores activos con contacto opt-in por match de categorias contra items.
  - Historial/tasa de respuesta queda neutro hasta que haya datos suficientes.
- `enviarRfq`
  - Valida `borrador -> cotizando` con `puedeTransicionar`.
  - Valida proveedores activos con contacto opt-in.
  - Inserta `approval_events(lista_proveedores)`, `quote_requests`, audit y outbox
    `rfq_solicitud`.
  - Transiciona `pedidos.estado` a `cotizando`.
- `registrarCotizacion`
  - Recibe input estructurado del extractor/router; no hace OCR/LLM.
  - Inserta `quote_responses` y `quote_items`.
  - Usa E2 del core: cotizacion incompleta por confianza baja, item sin precio/cantidad o
    sin items.
  - Si E2 aun no agoto repreguntas: guarda intento y encola repregunta al proveedor.
  - Si E2 agoto repreguntas: guarda intento, crea `review_queue(cotizacion_incompleta)` y
    notifica a Proveeduria.
  - Si es completa: marca `quote_requests.estado='respondida'`.
  - Cuando no quedan RFQs pendientes: transiciona `cotizando -> en_revision`.
  - Al hacer esa transicion, genera el comparativo en la misma transaccion.
- `generarComparativo`
  - Valida rol con `puedeUsarTool('generar_comparativo', actor.roles)`.
  - Exige pedido `en_revision`; si sigue `cotizando` devuelve E12.
  - Usa repo SQL deterministico para matriz item x proveedor desde `pedido_items`,
    `quote_requests`, ultima `quote_response` completa por proveedor y `quote_items`.
  - Devuelve filas con precio, cantidad cotizada, disponibilidad, condiciones, plazo,
    subtotal y faltantes.
  - Registra `audit_event(generar_comparativo)` y encola `notificacion_interna` por outbox
    con resumen compacto, `portal_path` y payload de tabla para WhatsApp/portal.

En `packages/agent/src/runtime/`:

- `types.ts`: contratos `Actor`, `Ctx`, repos, audit/outbox/approval, quotes/review/config
  y comparativos.
- `tx.ts`: transaccion PG (`BEGIN`/`COMMIT`/`ROLLBACK`).
- `audit.ts`, `outbox.ts`, `approval.ts`: insertores transaccionales.
- `repos.ts`: implementaciones PG con SQL parametrizado, incluido `PgComparativoRepo`.
- `fakes.ts`: fakes en memoria con snapshot/rollback para unit tests.

En `packages/agent/src/agent/`:

- `structured.ts`
  - Extrae `tool_call` JSON ya estructurado desde payload directo o texto JSON.
  - Solo acepta tools whitelisted de Fase 2a.
- `tool-dispatcher.ts`
  - Mapea `tool_call.name` a las tools deterministicas implementadas.
- `loop.ts`
  - Ejecuta extractor estructurado primero y modelo inyectable despues.
  - Audita `agent_turn_sin_tool` si no hay tool ejecutable.

En `packages/db/migrations/005_pedidos_confirmacion.sql`:

- Agrega `pedidos.confirmado_at` y `pedidos.confirmado_por`.

En `apps/worker/src/domain/`:

- `handler.ts`
  - Lee `inbound_messages` por `wamid` dentro de transaccion.
  - Si `processed_at` ya existe, hace skip idempotente.
  - Toma `pg_advisory_xact_lock(hashtext(...))` cuando el job trae `pedidoId`.
  - Resuelve remitente y crea `Ctx` de `@proveeduria/agent` para internos con origen `wamid`.
  - Marca `processed_at` solo despues de que el engine termina sin lanzar.
- `router.ts`
  - Resuelve telefono contra `users` activos y luego `supplier_contacts`.
  - Tolera telefono con o sin `+`.
- `e11.ts`
  - Para remitente desconocido encola respuesta generica por `outbox_messages` y registra
    `audit_event(remitente_desconocido)`.
- `structured-engine.ts`
  - Engine temporal para payloads `tool_call` ya estructurados usando `@proveeduria/agent`.
  - No reemplaza Claude loop model-backed ni extractores; solo deja el seam ejecutable y testeable.

En `apps/worker/src/outbox/`:

- `dispatcher.ts`
  - Toma `outbox_messages` `pendiente|fallido` con `FOR UPDATE SKIP LOCKED`.
  - Usa `OutboxSender` inyectable; no llama WhatsApp directo desde tools.
  - Marca `enviado` con `wamid_salida`, o `fallido` con intentos y `next_retry_at`.

En `apps/api/src/portal/`:

- `routes.ts`
  - Expone `/api/portal/me`, `/api/portal/pedidos`,
    `/api/portal/pedidos/:pedidoId` y `/api/portal/pedidos/:pedidoId/comparativo`.
  - Requiere `X-User-Id` de usuario activo.
- `repo.ts`
  - SQL parametrizado para lista/detalle/comparativo.
  - `superadmin` y `admin_materiales` leen global; `ingeniero`/`bodeguero` quedan acotados
    a `user_roles.project_id`.

En `apps/portal/`:

- Portal estatico sin dependencias externas.
- Navega lista de pedidos, detalle, proveedores y comparativo consumiendo `/api/portal`.
- No toca `dashboard/` legacy ni usa Supabase anon.

## Verificacion ya corrida

Pasaron:

```bash
npm run build:all
npm run typecheck
npm run test:all
```

Tambien paso un integration test contra Postgres efimero con:

- migraciones `001` a `005`
- `npm run seed`
- flujo real `crear -> confirmar -> sugerir -> enviar RFQ -> registrar 2 cotizaciones -> en_revision -> comparativo`
- worker domain handler: `inbound_messages` real -> router interno -> `processed_at`, y E11
  desconocido -> `outbox_messages` + `audit_events`.
- API portal: lista/detalle/comparativo desde SQL real.
- Worker outbox dispatcher: fila real `outbox_messages` -> `enviado` con `wamid_salida`.

Los tests estan en `packages/agent/src/tools/pedido.integration.test.ts` y
`apps/worker/src/domain/handler.integration.test.ts`,
`apps/worker/src/outbox/dispatcher.integration.test.ts` y
`apps/api/src/portal/repo.integration.test.ts`; solo corren si `DATABASE_URL` contiene
`provee_test`, si no quedan skipped.

## Pendiente despues del hito navegable

No es necesario para navegar el flujo Fase 2a con datos de prueba, pero si para runtime
productivo de WhatsApp:

1. Claude/tool loop
   - Prompt de produccion lo edita el humano.
   - El agente solo decide tool calls dentro del contrato; permisos y excepciones quedan en tools.
2. Extractores estructurados
   - Texto/voz/foto de pedido/cotizacion hacia inputs estrictos de tools.
3. Broker real
   - Sustituir stubs/in-memory por cola durable en API/worker.
4. Sender real de Meta para outbox
   - Implementar `OutboxSender` contra WhatsApp Cloud API con credenciales y observabilidad.

## Guardrails para la siguiente sesion

- Leer primero `CLAUDE.md`, `docs/CODEBASE_GUIDE.md`, este handoff y
  `docs/handoff/FASE2A-next-session-prompt.md`.
- No tocar `server.js` ni `dashboard/` para nuevas features de produccion; son referencia/prototipo.
- No modificar `packages/core/src/types.ts` salvo que primero se cambie la spec.
- No inventar schema; si falta una columna/tabla, actualizar `docs/specs/data-model.md` y crear
  migracion nueva.
- Todas las tools escriben dominio + audit + outbox/approval/review derivados en una transaccion.
- Nada de envio WhatsApp directo desde tools.
- Transiciones solo via `@proveeduria/core` y el trigger de DB como segunda barrera.

## Estado de worktree esperado si se retoma antes de commit

- Nada debe estar staged salvo que el humano lo haya pedido despues.
- `server.js` y `dashboard/` no deben tener diff.
- Los cambios nuevos del hito navegable viven en:
  - `packages/agent/src/agent/`
  - `apps/api/src/portal/`
  - `apps/worker/src/outbox/`
  - `apps/portal/`
  - `docs/specs/portal-api.md`
