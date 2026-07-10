# Handoff — Fase 2a estado actual

Ultima actualizacion: despues de completar el prototipo navegable Fase 2a con comparativo,
API REST de portal, `apps/portal`, seam estructurado de agente y dispatcher de outbox.

Para arrancar una sesion nueva sin reconstruir contexto, usa
`docs/handoff/FASE2A-next-session-prompt.md`.

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
