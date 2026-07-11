# Plan de ejecución — Cierre Fase 2a, Fase 2b completa y Centro de Control

Fecha: 2026-07-10. Basado en auditoría verificada del repo (9 lecturas paralelas + crítica de
completitud sobre `packages/*`, `apps/*`, `docs/specs/*`, `server.js` legado, CI/CD). Complementa
`docs/EXECUTION_PLAN.md`; no lo reemplaza. Referencias de línea verificadas a esta fecha.

**Alcance de este plan:**

1. **Fase 2a — endurecimiento productivo** (lo que falta tras el hito navegable): loop Claude de
   producción, extractores, broker durable, sender real de Meta, cron E1.
2. **Fase 2b — flujo completo**: adjudicación, OC, recepción de facturas, notas de crédito,
   equipos de alquiler, cierre, consultas/exportaciones/links de dashboard, crons.
3. **Centro de Control** (nuevo, extiende `apps/portal` + `/api/portal`): login real, búsqueda y
   vistas por proyecto, CRUD de proveedores, aprobaciones/rechazos, cola de revisión, y monitoreo
   y control del agente (pausa, conversaciones, outbox, auditoría).

**Cómo ejecutar**: cada bloque se corre como sesión de Claude Code con orquestación multi-agente
(sección 9): spec primero (modelo fuerte), implementación mecánica en paralelo (Sonnet/Opus con
worktrees), revisión adversarial, verificación de integración contra Postgres efímero.

**Progreso**: ✅ Fase 0 (F0.1–F0.5; la empresa es **Atemporal** — plantillas listas para someter
a Meta) · ✅ A1 broker durable (`docs/specs/broker-colas.md` + producer/consumer reales) · ✅ A2
composition root del worker · ✅ A3 outbox+sender Meta completo (spec `outbox-whatsapp.md`,
migración 007, dispatcher claim→send→mark, `MetaOutboxSender`, statuses con guard monotónico;
verificado contra Postgres efímero 001–007) · ✅ C0/C1 Centro de Control (auth real completa: login
scrypt + JWT cookie httpOnly + refresh con rotación + rate limit 5/id y 20/IP + CSRF + CORS
estricto; seam `X-User-Id` ELIMINADO; endpoints proveedores CRUD/opt-in/BAJA y revisiones con
audit transaccional; portal React+Vite con Login/Shell por rol/Pedidos/Proveedores/Revisiones;
typecheck del portal cableado; 483 tests verdes con integración completa. Pendiente de C2:
bandeja de aprobaciones → `enviar_rfq` desde el portal) · ✅ B0 specs de Fase 2b (state-machine.md: ciclo de OC + cómputo de
cobertura + actor de recepción reconciliado; exceptions.md: umbral E3 `similitudMinFacturaOc`,
E9 por-campo, reincidencia E13; tools.md: snapshot D5 en `approval_events.detalle`, anular OC
fuera de Módulo 1, acciones web; data-model.md: trigger de equipos) · ✅ Migración 009
(guardias de OC + recomputación/inmutabilidad de movimientos de equipos; verificada
conductualmente en Postgres) · ✅ B1 core helpers (OC/cobertura/matching E3/E9
por-campo/E13/pausa; bug de artefactos stale en `core/src` corregido) · ✅ B2 repos+fakes 2b
(incl. cross-test core↔SQL de cobertura) · ✅ B3 `aprobar_ganador` (snapshot D5 en
`approval_events.detalle`, división validada) · ✅ B4 `emitir_oc` COMPLETO (PDF determinista
byte-a-byte con pdfkit → `attachment_blobs` (migración 010), endpoint público
`GET /api/attachments/:id?f=` con firma HMAC 72h y 404 uniforme, sender Meta con documento
por link firmado fail-closed; 682 tests con integración real; flake de orden en test de
proveedores corregida) · ✅ C2 bandeja de aprobaciones COMPLETA (endpoints que
ejecutan enviar_rfq/aprobar_ganador/emitir_oc con el MISMO advisory lock del worker y
Ctx.origen='web'; mapeo de errores tool→HTTP documentado; UI: EnviarRfqsPanel con filtro de
opt-in, AdjudicacionPanel por ítem desde el comparativo con agrupación por proveedor,
EmitirOcPanel, HistorialAprobaciones con evidencia D5; integración end-to-end HTTP real
borrador→ordenado; **714 tests, 0 skips** — LA OLA 1 DEL CENTRO DE CONTROL ESTÁ COMPLETA) ·
· ✅ A4 conversaciones (spec `agente-conversacional.md` + migración
011 phone UNIQUE; upsert en la tx del handler —incluye conversación anónima para E11—,
historial derivado, ventana 24h chequeada en la tx del claim del dispatcher; plantillas
nunca consultan ventana) · ✅ A7 cron E1 (helper compartido de transición+comparativo con
orden de audit byte-idéntico, `procesarVencimientos` como actor sistema,
`crearCtxSistema`, loop con `pg_try_advisory_xact_lock('cron:e1')`; 737 tests estables en
doble pasada) · ✅ A5 loop Claude COMPLETO (registry único de tools —fin
del triple whitelist—, `ModeloConversacional` + loop 5 pasos con audit `agente_max_pasos`,
adapter `@anthropic-ai/sdk` con `AGENT_MODEL` default claude-sonnet-5, goldens contra fake
scripted con el prompt real, engine conversacional en worker con historial A4, gating: con
`ANTHROPIC_API_KEY` el seam `tool_call`-en-texto se apaga; 755 tests. **Prompt borrador en
`agent/prompt.ts` — REVISIÓN HUMANA PENDIENTE antes del piloto**) · ✅ A6 extractores + camino del
proveedor COMPLETO (media pipeline Meta→attachment_blobs con audits de fallo suave, actor
sistema en registrar_cotizacion —solo vía proveedor—, extractores texto/Vision/Whisper con
tool forzada y AGENT_EXTRACT_MODEL default haiku, BAJA interceptada, resolución de RFQ
0/1/N con match de PED-nnn; integración real proveedor→quote_response→en_revision).

**FASE 2A FUNCIONALMENTE COMPLETA** (774 tests, 0 fallos, doble pasada estable; migraciones
001–011). Bloqueado en el humano antes del piloto: revisión del prompt (`agent/prompt.ts`),
sometimiento de plantillas a Meta, credenciales reales (Meta/Anthropic/Azure) y commit del
working tree. Siguiente por plan: B5 registrar_factura → B6–B8 (recepción/NC/cierre); C3
olas 2–3 (dashboards por proyecto + control del agente); B9–B11; D deploy/cutover.

---

## 1. Estado actual verificado (resumen)

| Área | Estado | Evidencia clave |
|---|---|---|
| `packages/core` | **Completo en vocabulario 2b** (19 tools, 9 estados, 14 transiciones, E1–E13, política de aprobación, numeración PED+OC). Faltan helpers puros (§4.1). | `roles.ts:18-44`, `state-machine.ts:56-153`, `exceptions.ts` |
| `packages/db` | **Schema 2b completo** (32 tablas + 4 vistas, migraciones 001–005): `purchase_orders`, `invoices`, `credit_notes`, `equipment_*`, `review_queue`, `dashboard_links`, `conversations` ya existen. **Sin columnas de credenciales/login.** | `migrations/001..005`, `tests/schema.test.mjs` |
| `packages/agent` | 6 de 19 tools implementadas y probadas (pedido→comparativo). `ModeloToolUse` es interfaz sin implementación (sin SDK Anthropic en el monorepo). Cero extractores. Repos solo de pedido/RFQ/quote. | `tools/pedido.ts`, `agent/loop.ts:20-28` |
| `apps/api` | Webhook ingest production-safe completo; cola Azure es stub que **lanza al encolar**. Portal REST solo-GET con seam `X-User-Id` (cualquiera que alcance la API puede suplantar usuarios). Ignora `statuses` de Meta. | `queue/index.ts:46-52`, `portal/auth.ts:11-17`, `webhook/parse.ts:153-177` |
| `apps/worker` | Domain handler + dispatcher de outbox probados pero **muertos en runtime**: `index.ts` sigue con echo + InMemoryConsumer. Sin sender Meta, sin cron, sin scheduler. Mensajes de proveedor mueren silenciosamente tras audit. | `index.ts`, `outbox/dispatcher.ts`, `domain/structured-engine.ts` |
| `apps/portal` | SPA estática sin dependencias, una pantalla, solo lectura, selector de usuario hardcodeado. Sin CLAUDE.md ni tests reales. | `src/app.js`, `scripts/check.mjs` |
| CI/CD | CI construye/prueba + gate de migraciones. **Cero CD del stack nuevo** (sin Dockerfile, sin IaC, sin OIDC nuevo). El workflow legado redespliega `server.js` vivo **en cada push a main sin filtro de paths**. | `.github/workflows/*` |

Riesgos activos que el plan neutraliza temprano: (a) push a main = redeploy del webhook legado sin
endurecer; (b) `tool_call` JSON en texto de WhatsApp ejecuta tools reales para internos (seam 2a);
(c) configurar `AZURE_STORAGE_QUEUE_CONNECTION` hoy rompe el webhook (stub lanza → 500 → retry
storm de Meta).

---

## 2. Decisiones que este plan fija (proponer → confirmar → spec)

| # | Decisión | Propuesta | Racional |
|---|---|---|---|
| D1 | Framework del Centro de Control | **React + Vite (+ Tailwind) fresco en `apps/portal`**, consumiendo solo `/api/portal`. No migrar código de `dashboard/` (solo patrones visuales). | Login + CRUD + aprobaciones + monitores = multi-pantalla con estado/formularios; vanilla-JS a esa escala es spaghetti. Coincide con la intención original de EXECUTION_PLAN §2. |
| D2 | Mecanismo de login | **Password (argon2id) + JWT firmado servidor (HS256, secreto en Key Vault) en cookie httpOnly + refresh**. Tabla `user_credentials` aparte (los `users` siguen siendo identidad WhatsApp). Alta/reset por superadmin. | Más simple y sin dependencia circular (OTP por WhatsApp dependería del outbox/sender que estamos construyendo). OTP queda como alternativa si el negocio la pide. |
| D3 | Broker | **Azure Storage Queues** (según EXECUTION_PLAN). Contrato de mensaje adelgazado a `{wamid}` (+`pedidoId?`): el handler ya relee todo de `inbound_messages`. `dequeueCount`→`intento`; máx. dequeues → cola veneno. | Elimina el mismatch productor/consumidor actual (`TrabajoIngesta` vs `Job`) y hace el wire format trivial. |
| D4 | Scheduler de crons | **Loop de timer en el proceso worker** con advisory lock por cron (escala 0/1; sin doble ejecución). Upgrade path: Container Apps Jobs. | No agrega runtime; el worker ya corre loops. |
| D5 | Evidencia de adjudicación | **Snapshot del comparativo en `approval_events.detalle` (jsonb)** al aprobar ganador. Sin tabla nueva. | Cumple "evidencia de lo que vio el aprobador" sin nueva migración; `detalle` ya existe. Actualizar `tools.md` (hoy dice "no persiste snapshot"). |
| D6 | Dispatcher de outbox | **Claim → send → mark en transacciones separadas** (no HTTP dentro de la tx con locks). `max_intentos` + estado terminal `descartado`. Taxonomía de errores Meta (permanente/transitorio/rate-limit). | Hoy un HTTP colgado retiene locks del batch; un crash post-send duplica mensajes; errores permanentes reintentan para siempre. |
| D7 | Pausa del agente | Flags en tabla `agent_control` (global, por teléfono, por pedido) chequeados por el handler del worker **antes** de delegar al engine; mensaje entrante en pausa → persiste + notifica a humano, no ejecuta tools. Predicado puro en core. | El control determinista vive fuera del LLM, igual que permisos y excepciones. |
| D8 | Marca en plantillas | Sustituir "Proyekta" por el nombre real/genérico **antes** de someter plantillas a Meta (texto aprobado queda congelado). Aplica también a `e11.ts:5`. | Decisión `naming-empresa-generica` ya registrada. |

**Preguntas abiertas de negocio** (bloquean tareas puntuales, no el arranque; agregar a la sesión
de afinamiento): umbral E5 `difCantidadMenor` (hoy 0); ¿superadmin puede `confirmar_recepcion`?
(la matriz lo excluye a propósito, `roles.ts:70` — el botón del portal debe respetarlo o cambiar
la spec); ¿anular OC es acción del Módulo 1 o queda manual?; mecanismo de login definitivo (D2);
corpus de facturas/cotizaciones reales para calibrar umbrales de extracción.

---

## 3. Fase 0 — Desbloqueos día 1 (antes de todo lo demás)

| ID | Tarea | Modelo | Detalle |
|---|---|---|---|
| F0.1 | **Filtrar/gatear el deploy legado** | Sonnet | `main_proveeduria-webhook.yml` despliega todo el repo a la Web App viva en cada push a main. Agregar `paths` (solo `server.js`/`package.json` raíz) y/o environment protection. Ídem revisar `dashboard_static_web_app.yml`. |
| F0.2 | **Plantillas Meta: de-branding + sometimiento** | Fuerte + humano | Actualizar `templates-whatsapp.md` (D8), someter las 7 plantillas a aprobación de Meta. **Camino crítico externo más largo** — bloquea RFQ/OC/recordatorios/resumen fuera de ventana 24h. |
| F0.3 | Asignar bloques de numeración de migraciones | — | Runner forward-only sin checksums: 006 auth, 007 outbox (media/retry/terminal), 008 conversaciones+agent_control+config E3, 009 trigger equipos + extras 2b, 010+ reserva. Evita colisiones entre workstreams paralelos. |
| F0.4 | Corregir CLAUDE.md raíz (datos stale) | Sonnet | El webhook legado SÍ verifica firma (opcional/fail-open, `server.js:459-473,1494-1508`); el Map conversacional está en ~1013, no ~956. |
| F0.5 | `.env.example` para `apps/api` y `apps/worker` + knobs faltantes en `worker/config.ts` | Sonnet | Hoy hay que ingeniar las vars desde el código. Worker no tiene: queue connection, META_PHONE_NUMBER_ID/ACCESS_TOKEN, ANTHROPIC_API_KEY, DocIntel endpoint, batch/interval del dispatcher. |

---

## 4. Workstream A — Fase 2a: endurecimiento productivo

Objetivo: WhatsApp real end-to-end con el flujo ya probado. Orden interno estricto (ver §8).

### A1. Broker durable (las dos mitades juntas)
- **Spec**: nota en `docs/specs/` o CLAUDE.md de api/worker con el wire format `{wamid, pedidoId?}` (D3).
- **api**: `AzureStorageQueue.enqueue` real con `@azure/storage-queue` (`queue/index.ts:46-52`); base64; manejo de fallo transitorio (500 → retry Meta es seguro por dedup wamid).
- **worker**: `QueueConsumer` real: receive con visibility timeout (poll), deleteMessage (ack), visibility/updateMessage (nack), `dequeueCount`→`intento`, veneno → cola `-poison` + `review_queue`/alerta. La interfaz actual no modela visibility token: extenderla.
- **Modelo**: diseño de semántica (visibility, poison, ordering vs advisory lock) = **Fable/fuerte**; mecánica HTTP/SDK y tests = **Sonnet**.
- **Verificación**: integración con Azurite (emulador) en CI o test manual documentado; webhook → cola → worker → `processed_at`.

### A2. Composition root del worker
- `index.ts`: pool PG desde config, `PgTransactionRunner`, domain handler real (adiós echo), consumer real, **loop de polling del dispatcher** (hoy `despacharOutbox` solo lo llaman tests), shutdown graceful (SIGTERM), `/health` si aplica.
- Corregir: `structured-engine` escribe `pedido_id=null` en audit (`structured-engine.ts:30,61`); router no filtra `supplier_contacts` por activo/opt-in (`router.ts:84-92`); copy E11 hardcodea "Proyekta" (`e11.ts:5`).
- **Modelo**: Opus (wiring con patrón claro); revisión fuerte.

### A3. Outbox productivo + sender Meta real
- **Migración 007** (spec `data-model.md` primero): columna media/attachment para documentos (PDF de OC), `max_intentos`, estado terminal `descartado`, convención de parámetros de plantilla en `payload` (mapeo → `{{n}}` de `templates-whatsapp.md`).
- **Dispatcher rediseñado** (D6): claim (tx corta) → send (fuera de tx) → mark (tx corta); clave de idempotencia saliente; backoff aware de rate-limit (429/80007); errores permanentes (131026 número inválido, 132001 plantilla, 131047 ventana, 100 payload) → `descartado` + notificación.
- **`MetaOutboxSender`**: texto libre, plantilla con components, documento/media; captura `messages[0].id` → `wamid_salida`; chunking 4096 (portar de `server.js:1323`).
- **Ingesta de `statuses`** en `apps/api/parse.ts` (hoy se descartan): sent/delivered/read/failed → actualizar outbox; alimenta el monitor del Centro de Control y métricas del piloto.
- **Ventana 24h**: mantener `conversations.ventana_24h_expira_at`; el dispatcher elige plantilla vs texto libre según ventana.
- **Modelo**: taxonomía de errores + rediseño transaccional = **Fable**; sender HTTP + chunking + tests contra taxonomía escrita = **Sonnet**.

### A4. Persistencia de conversaciones (workstream propio — hoy sin dueño)
- La tabla `conversations` (migración 004) no la lee/escribe nadie. Wiring: crear/actualizar por mensaje entrante/saliente, historial acotado para el loop Claude, ventana 24h, `conversation_id` en `inbound_messages`.
- Gatea 3 entregables: loop Claude (historial), envíos (ventana), visor de conversaciones del portal.
- **Modelo**: diseño **Fable**; repos/SQL **Sonnet**.

### A5. Loop Claude de producción
- Extender `ModeloToolUse` (hoy insuficiente: una llamada, sin historial, sin round-trip de tool results, descarta texto — `agent/loop.ts:20-28`): historial desde `conversations`, multi-step tool_use, canal de respuesta de texto.
- Adapter Anthropic SDK (nueva dep en `packages/agent`); **schemas JSON de tools generados desde un registro único** (hoy el whitelist está triplicado: `agent/types.ts`, `structured.ts`, `tool-dispatcher.ts`, + `TOOLS_MODULO_1`; consolidar primero — Sonnet); prompt de producción **editado por humano** (AI_DEV §7) con goldens de conversación como regresión (harness record/replay de `ModeloToolUse` fake).
- **Guardas de costo desde el día 1** (EXECUTION_PLAN §5: "loop quemando tokens" es EL riesgo): MAX_LOOPS, presupuesto de tokens por turno, tier de modelo por llamada (barato para extracción, fuerte para conversación), límite de gasto en Anthropic Console.
- **Gatear/deshabilitar el seam `tool_call`-en-texto** antes de que usuarios reales escriban al número (hoy cualquier interno ejecuta tools por JSON en el body — `structured.ts`).
- **Modelo**: **Fable** (mayor ambigüedad y blast radius del plan); goldens/fixtures mecánicos **Sonnet**.

### A6. Pipeline de media + extractores + camino del proveedor
- **Pipeline de adjuntos primero** (bloquea todos los extractores): URLs de media de Meta expiran en minutos → descarga en worker → Azure Blob → fila `attachments`. No existe cliente Blob en el stack nuevo.
- **Convención actor/Ctx para proveedores** (spec primero): hoy el mensaje de proveedor es un callejón sin salida (router lo resuelve, engine lo ignora o rechaza por rol; `registrar_cotizacion` es solo-interno en la matriz). Decidir: actor sistema con contexto proveedor → ejecuta `registrar_cotizacion`. Sin esto los flujos E2 son inalcanzables desde mensajes reales.
- **Extractores de cotización**: texto/imagen/PDF (Claude Vision) /audio (Whisper) → `RegistrarCotizacionInput` estricto con `confianza_extraccion`; resolución de `quoteRequestId` por remitente + RFQ activa; mapeo líneas→`pedido_item_ids`.
- **BAJA opt-out** (`optin_at=null` + notificar Proveeduría) en el router — requisito de política Meta, no opcional.
- **Modelo**: diseño de extracción, matching y convención de actor = **Fable**; plumbing HTTP (download/upload), Whisper, fixtures = **Sonnet/Opus**.

### A7. Cron E1 (vencimiento de plazos) — completa el contrato 2a
- `tools.md` promete `cotizando→en_revision` "cuando todas responden **o vence plazo**"; solo existe el primer camino. Scheduler (D4) + `QuoteRequestRepo.marcarVencida` + transición + comparativo en la misma tx + notificación de pendientes con opciones (extender / continuar).
- **Modelo**: Opus con revisión fuerte (toca la transición y el comparativo automático, cuyo throw-to-rollback hay que preservar — `pedido.ts:1052`).

---

## 5. Workstream B — Fase 2b: flujo completo

### B0. Specs primero (gate global, modelo fuerte)
Ediciones que deben aterrizar **antes** que su código (regla de código protegido):
- `state-machine.md`: máquina de estados de OC (emitida→confirmada→recibida_parcial/total, anulada); computación de cobertura de recepción (regla dura 3); reconciliar la contradicción actor "Bodeguero/Sistema" vs "sistema" en `recepcion_parcial` (core sigue "sistema": `confirmar_recepcion` registra la aprobación del bodeguero y transiciona como ActorSistema); auto-cierre de alquileres.
- `exceptions.md`: umbral de similitud E3 (nuevo campo en `UmbralesConfig` + seed de config); E9 por-campo (tipo con confianzas por campo en core); reincidencia E13.
- `data-model.md`: cambios de outbox (007), `user_credentials`/sesiones (006), `agent_control` (008), trigger de `cantidad_activa` (009) o declarar invariante de app.
- `tools.md`: D5 (snapshot en `approval_events.detalle`), acciones web/CRUD de proveedores, decisión sobre anular OC.

### B1. Helpers puros en `packages/core` (protegido: spec→tests exhaustivos→código)
Tabla de transiciones de OC (espejo del patrón `TRANSICIONES`); cómputo de cobertura
parcial/total (regla 3); predicado de sugerencia de cierre (regla 4); auto-cierre de alquiler;
E3 en `UmbralesConfig`; tipo de confianzas por campo (E9); reincidencia E13; predicado de pausa
del agente (D7). **Modelo**: spec Fable; código mecánico spec→TS con tests **Sonnet** + PR
revisado por humano. Toda transición nueva se refleja en el trigger de DB en la misma ventana.

### B2. Repos PG + fakes para entidades 2b (patrón establecido — **Sonnet en paralelo**)
`purchase_orders`/`po_items`, `invoices`/`invoice_items`/`invoice_po_links`,
`receipt_confirmations`, `credit_notes`, `equipment_rentals`/`movements`, `dashboard_links`,
`feedback`, vistas whitelisted, y métodos faltantes: `ReviewQueueRepo` list/get/resolver (hoy solo
`crear` — bloquea `cerrar_pedido` y la pantalla de revisión), `UsuarioRepo.porId`,
`ProveedorRepo` CRUD, `ProyectoRepo.listarActivos`. Cada repo con su fake snapshot/rollback.
Actualizar aserciones exactas de tests (`auditCount=7`, lista de 32 tablas) — definir política de
quién las toca por tarea.

### B3–B8. Cadena de dominio (orden estricto por la máquina de estados)

| ID | Tool | Puntos duros (modelo fuerte) | Mecánico (Sonnet/Opus) |
|---|---|---|---|
| B3 | `aprobar_ganador` | Validación de división (cada ítem exactamente 1 vez); snapshot D5; decisión humana explícita, el agente solo recomienda | Parser input, audit/approval, tests |
| B4 | `emitir_oc` | Numeración OC transaccional; PDF (elegir lib, ej. pdfkit) → Blob → `pdf_attachment_id`; outbox con documento (depende A3/007); plantillas `oc_emitida`+confirmación; `aprobado→ordenado` cuando todas enviadas | Plantilla PDF, wiring outbox, tests |
| B5 | `registrar_factura` | **Camino del dinero**: extractor DocIntel prebuilt-invoice + fallback Vision con confianzas por campo (E9); matching factura↔OCs abiertas + umbral E3; diferencias E4; propuesta `invoice_po_links`; nunca escritura silenciosa | Repos, colas de revisión, tests de casos |
| B6 | `confirmar_recepcion` | Cómputo cobertura parcial/total (B1); E5; guard "bodeguero **del proyecto**" (instancia, como el guard de solicitante); transiciona como ActorSistema | `receipt_confirmations`, estados OC, tests |
| B7 | `asociar_nota_credito` | Match único e inequívoco (E6); aprobación humana obligatoria; ajuste vía vista `v_pedido_costo_real`, jamás columna | Repos NC, tests |
| B8 | `cerrar_pedido` | Guard: `recepcion_total` + sin NC pendientes + sin `review_queue` abiertas (necesita B2) | Notificación a ingeniero, tests |

Validar con **spike temprano**: precisión de DocIntel prebuilt-invoice sobre facturas CR reales
(muchas son "factura electrónica" PDF con clave numérica; a veces existe XML estructurado) antes
de congelar el diseño de extracción de B5. Pedir corpus al negocio (pregunta abierta).

### B9. Equipos de alquiler
`registrar_equipo` (extracción de boleta → alta o suma a activo + movimiento entrada),
`registrar_devolucion` (E10, descuento, cierre en 0), `consultar_inventario_equipos`.
Decidir trigger de `cantidad_activa` vs invariante de app (spec B0). Sin prototipo que portar
(los tools legados de "movimientos" son materiales; la tabla de paridad ya lo resuelve).
**Modelo**: extractor de boleta Fable; resto Opus/Sonnet.

### B10. Consultas y utilidades
- `consultar_datos`: SQL parametrizado **solo** sobre vistas whitelisted, alcance por rol
  (ingeniero: sus proyectos). Registro de vistas permitidas (¿en core o config?) — diseño fuerte,
  implementación Sonnet. **Pasa `/security-review`** (AI_DEV lo nombra).
- `exportar_datos`: CSV a Blob con SAS corto + link por WhatsApp; respuesta `text/csv` también
  para el portal.
- `generar_link_dashboard`: tokens `dashboard_links` **verificados en servidor** (hash + expiry;
  NO replicar el patrón legado de JWT decodificado en cliente), segunda ruta de auth de solo
  lectura por proyecto.
- `registrar_retroalimentacion`: paridad directa → tabla `feedback`. **Sonnet**.

### B11. Crons restantes (dependen de A3 + plantillas aprobadas)
E13 atascos (>24h en_revision, >48h aprobado; reincidencia → Gerencia), `rfq_recordatorio` y
`oc_confirmacion_recordatorio`, `resumen_diario` (pendientes de revisión, E1 vencidas, atascados,
remitentes desconocidos — cierra también el loop de E11). **Modelo**: Opus sobre el scheduler D4.

---

## 6. Workstream C — Centro de Control

### C0. Spec nueva + decisión de framework (gate de todo C)
- **Nueva spec `docs/specs/control-center.md`** (modelo fuerte): pantallas, acciones, semántica de
  resolución por tipo de `review_queue` (qué HACE resolver cada tipo: re-invocar tool, crear link,
  descartar — hoy no está definido en ninguna spec), modelo de pausa del agente (D7), modelo de
  rechazo (hoy `approval_events` no representa "rechazo": decidir evento `rechazo` en `detalle` o
  tipo nuevo), permisos por acción web (mapear a `TOOL_ROLES`/política de core; las acciones
  portal-only como CRUD proveedores necesitan entradas nuevas en `tools.md` o matriz web propia).
- **Extensión de `portal-api.md`**: cada endpoint nuevo, antes del código.
- Ejecutar D1 (React+Vite): scaffold nuevo en `apps/portal`, migrar las 3 vistas actuales,
  `CLAUDE.md` del paquete + tests reales (el "test" actual es un grep de strings).

### C1. Autenticación (bloquea CUALQUIER endpoint de escritura)
Migración 006 (`user_credentials`, sesiones/refresh) → endpoint login → verificación de token
reemplazando `leerUserId` (`routes.ts:106-114` es el único choke point) → CORS de `*` a origen
explícito + cookies httpOnly + CSRF → logout/rotación. Secreto en Key Vault. **Threat model y
diseño Fable + `/security-review`; endpoints resultantes Sonnet.** Nota: hoy agregar escrituras
sobre el seam `X-User-Id` dejaría a cualquier caller anónimo aprobar adjudicaciones.

### C2. Plomería de escrituras del portal
- Toda mutación del portal **ejecuta las tools de `packages/agent`** (withTx + audit + approval +
  outbox) con `Ctx.origen='web'` — nunca SQL crudo en `PgPortalStore`. El canal `web` ya existe en
  `CANALES_APROBACION`.
- **Mismo lock**: `pg_advisory_xact_lock('pedido:'+id)` que usa el worker, o una aprobación web
  corriendo contra una transición por WhatsApp produce carreras E12/doble efecto.
- Helper de body-parsing + validación para rutas portal (hoy solo el webhook lee bodies).
- **Modelo**: convención de locking Fable; handlers por endpoint Sonnet.

### C3. Pantallas (por olas, cada una tras su API)

**Ola 1 — con cierre de 2a** (todo lo necesario ya existe en dominio):
1. Login + shell con roles y navegación.
2. Pedidos: lista con filtros (estado/proyecto/búsqueda), detalle, comparativo (migradas de la SPA actual).
3. **Cola de revisión**: lista/detalle por tipo + acción resolver (la API ya devuelve `revisionesPendientes` pero la SPA actual ni las renderiza).
4. **Proveedores**: CRUD de `suppliers` + `supplier_contacts` (alta, opt-in registrado, BAJA visible), con `audit_events` por mutación (no hay trigger que lo fuerce — es convención).
5. **Bandeja de aprobaciones**: lista_proveedores (aprueba → `enviar_rfq`), historial de `approval_events` por pedido.

**Ola 2 — con la cadena 2b** (cada pantalla detrás de su tool):
6. Adjudicación desde el comparativo (`aprobar_ganador` con división por ítem) y emisión de OC.
7. OCs, facturas, recepciones, NCs por pedido/proyecto; costo real vs presupuesto de referencia.
8. Equipos de alquiler por proyecto/proveedor.
9. Dashboard por proyecto (paridad visual con `dashboard/` legado: tarjetas presupuesto/ejecutado, últimos movimientos) + export CSV + gestión de `dashboard_links`.
10. Búsqueda transversal por proyecto (pedidos/OCs/facturas/proveedores).

**Ola 3 — control del agente**:
11. **Pausa/reanudar** el agente (global/por teléfono/por pedido) — D7; el handler del worker respeta el flag.
12. **Visor de conversaciones** (depende A4): timeline entrante/saliente por contacto con estado de entrega (depende ingesta de `statuses`).
13. **Monitor de outbox**: pendientes/fallidos/descartados, reintentar-ahora y cancelar (necesita migración 007), edad de cola.
14. **Visor de auditoría**: `audit_events` por pedido/entidad/actor (append-only, solo lectura).
15. Remitentes desconocidos (E11) y edición de umbrales (`config`) con audit_event.

**Modelo**: componentes y pantallas tras API definida = **Sonnet en paralelo (worktrees)**;
flujos de aprobación/adjudicación (correctitud de la decisión humana) = **Opus/Fable**.

### C4. Operación
`/health`/`/ready` (probes de Container Apps), shutdown graceful en api, request logging,
rate limiting básico en portal. **Sonnet**.

---

## 7. Workstream D — Infra, CD y observabilidad

| ID | Tarea | Modelo | Notas |
|---|---|---|---|
| D-1 | Dockerfile multi-stage (una imagen, dos entrypoints api/worker) replicando el orden libs→apps de `build:all` + `.dockerignore` | Sonnet | Sin esto no hay deploy del stack nuevo |
| D-2 | IaC (Bicep) desde la tabla de recursos de DEPLOYMENT_COOKBOOK §2: RG, ACR, Container Apps env, Postgres Flexible, Storage (colas+blob), Key Vault, App Insights, DocIntel | Sonnet borrador + **revisión fuerte en identidad/Key Vault**; secretos SIEMPRE los aplica el humano (AI_DEV §7) | |
| D-3 | CD: build+push imagen (OIDC federado) + deploy a `dev`; portal a Static Web App | Opus | CI existente queda como gate; agregar `npm run lint` al CI (hoy no corre) |
| D-4 | Observabilidad: correlation id = `wamid` de api→cola→worker→outbox; App Insights con sampling/caps; métricas de profundidad de cola (KEDA), edad de review_queue, atascos; alertas (RFQ fallida, workflow >24h, mismatch factura, gasto IA anómalo) | Opus | El piloto exige monitoreo diario de % extracción, latencia y costo — hoy no se emite ninguna métrica |
| D-5 | Presupuestos/alertas Azure + límite de gasto Anthropic | Humano | Día 1 de tener recursos |
| D-6 | `e2e:whatsapp` (payloads Meta firmados contra api local, verificar efectos en DB — AI_DEV §3.5) | Sonnet | Natural para CI post-A1 |
| D-7 | **Cutover**: Meta permite un webhook por app → procedimiento de corte legado→nuevo + rollback; número/app de prueba para dev; después del corte, congelar el deploy legado | Fuerte + humano | Precede al piloto |
| D-8 | Restore drill de Postgres documentado y ejecutado | Humano | Criterio de go-live |

---

## 8. Secuenciación (dependencias duras) y milestones

```
F0 (día 1) ──► A1 broker ──► A2 wiring worker ──► A3 outbox+sender ──► A7 cron E1
                                    │                    │
                                    ▼                    ▼
                              A4 conversaciones ──► A5 loop Claude ──► (gatear seam tool_call)
                                    │
                                    ▼
                          A6 media+extractores+proveedor   ◄─ requiere A3 (repreguntas E2 salen por outbox)

B0 specs ──► B1 core ──► B2 repos ──► B3 ──► B4 ──► B5 ──► B6 ──► B7 ──► B8
   (B4 requiere A3/007: OC-PDF por WhatsApp)     (B5 requiere A6: pipeline media)
B9, B10, B11 tras B2 (B11 requiere A3 + plantillas F0.2 aprobadas)

C0 spec+framework ──► C1 auth ──► C2 escrituras ──► C3 ola 1 ──► C3 ola 2 (tras B) ──► C3 ola 3 (tras A3/A4/D7)
D-1..D-3 tras A2 (worker real que desplegar) ──► D-7 cutover ──► piloto
```

Milestones sugeridos (semanas relativas; A, B0–B2 y C0–C1 pueden avanzar en paralelo con
distintas sesiones):

| Semana | Entregable verificable |
|---|---|
| 1 | F0 completo; plantillas sometidas a Meta; A1+A2 (mensaje real entra por cola durable y el worker lo procesa); C0 spec + scaffold React; B0 specs listas |
| 2 | A3 (outbox envía por Meta con reintentos/estados) + A7; C1 auth real; B1+B2 |
| 3 | A4+A5 (conversación real con Claude, goldens, guardas de costo); B3+B4 (adjudicar y emitir OC con PDF); C2+C3 ola 1 |
| 4 | A6 (proveedor cotiza por foto/audio de verdad); B5+B6 (factura→recepción); spike DocIntel resuelto |
| 5 | B7+B8+B9; C3 ola 2 |
| 6 | B10+B11; C3 ola 3 (control del agente); D-1..D-4 |
| 7 | e2e en dev, `/security-review` (webhook, auth portal, consultar_datos), restore drill, capacitación (guías 1 página por rol, en español) |
| 8 | D-7 cutover + arranque de piloto |

---

## 9. Orquestación con workflows y delegación por modelo

### Patrón por sesión (Claude Code + tool Workflow)

1. **Bootstrap**: leer `CLAUDE.md`, este plan, la spec del bloque y el handoff vigente.
2. **Spec/diseño** (si el bloque lo requiere): modelo fuerte inline; actualizar `docs/specs/`
   primero, PR revisado por humano si toca core/protegido.
3. **Implementación fan-out**: workflow con `pipeline()` sobre la lista de tareas mecánicas del
   bloque, `model: 'sonnet'` u `'opus'` según la tabla de abajo, `isolation: 'worktree'` cuando
   varios agentes mutan archivos en paralelo (ej. repos+fakes B2, pantallas C3).
4. **Revisión adversarial**: workflow de verificación con 2–3 lentes por hallazgo/archivo
   (correctitud, concurrencia/transacciones, seguridad) para el camino del dinero y todo lo
   transaccional; `/code-review` alto para el resto.
5. **Verificación de integración**: `npm run build:all && npm run typecheck && npm run test:all`
   + Postgres efímero (comandos en `CODEBASE_GUIDE.md` §Comandos) + test de flujo del bloque.
6. **Cierre**: actualizar handoff (`docs/handoff/`) y marcar el bloque en este plan.

### Tabla de delegación (qué modelo hace qué, y por qué)

**Sonnet — mecánico con patrón establecido y criterio de aceptación claro:**
- Repos PG + fakes 2b (B2): replicación del patrón de `repos.ts`/`fakes.ts`.
- Migraciones aditivas en estilo existente (006–009) + actualización de listas/aserciones de tests.
  *Prohibido delegar*: nada destructivo ni que toque `audit_events` (AI_DEV §7).
- Endpoints GET del portal (patrón `resolverPortalRequest` + `agregarAlcance`), serialización CSV,
  pantallas React tras API definida, `CLAUDE.md` de portal, `.env.example`, `/health`, shutdown,
  de-branding de copys.
- Sender Meta: mecánica HTTP/chunking/plantillas **contra taxonomía ya escrita**; fixtures y goldens.
- Dockerfile, borrador de Bicep, consolidación del whitelist triplicado de tools.

**Opus — implementación media con algo de juicio, patrón parcial:**
- Composition root del worker (A2), cron E1 y crons B11 sobre el scheduler D4.
- CD workflows (D-3), observabilidad (D-4).
- Handlers de escritura del portal tras el diseño de auth/locking (C2), flujos de aprobación UI.
- Extractor plumbing (descarga media, Whisper, DocIntel HTTP) tras diseño.

**Fable (fuerte) — diseño, dinero, concurrencia, seguridad (no delegar hacia abajo):**
- Toda autoría de specs (B0, C0, convención proveedor, wire format) y reconciliación de
  contradicciones entre specs (actor recepción, E9 por-campo, E3, superadmin/recepción).
- Loop Claude de producción (A5) y diseño de extractores/matching (A6, B5): lo de mayor
  ambigüedad y blast radius.
- Algoritmos del camino del dinero: matching E3, cobertura regla 3, match único E6, validación de
  división en B3 — un error corrompe costo real y el rastro de aprobaciones en silencio.
- Infraestructura sensible a concurrencia: rediseño del dispatcher (D6), consumer con visibility/
  poison (A1/D3), locking web-vs-WhatsApp (C2).
- Arquitectura de auth y threat model (C1) + revisión de identidad/Key Vault en IaC.

### Reglas de coordinación entre sesiones paralelas
- Bloques de numeración de migraciones asignados por workstream (F0.3).
- Un solo dueño por archivo de aserciones exactas (integration tests, `schema.test.mjs`) por ventana.
- Specs se editan en serie (una sesión a la vez sobre `docs/specs/`).
- Secretos reales jamás en contexto de agente; los aplica el humano (AI_DEV §7).

---

## 10. Verificación y criterios de salida por workstream

- **A**: mensaje de WhatsApp real (número de prueba) recorre firma→dedup→cola Azure→worker→tool→
  outbox→Meta con `wamid_salida` y estados de entrega; conversación libre ejecuta `crear_pedido`
  vía Claude con goldens verdes; proveedor real cotiza por foto y dispara E2; el seam
  `tool_call`-en-texto está gateado.
- **B**: flujo `en_revision→cerrado` completo en dev con datos de prueba: adjudicación dividida,
  OC PDF recibida por WhatsApp, factura fotografiada conciliada (o atrapada por E3/E4/E9 en cola
  de revisión — nunca escrita mal en silencio), NC aplicada, cierre sugerido y confirmado.
  Equipos: alta→devoluciones→cierre en cero.
- **C**: login real (sin `X-User-Id`), todas las mutaciones pasan por tools con audit/approval,
  aprobación web y por WhatsApp del mismo pedido no producen carrera (test de concurrencia),
  pausa del agente detiene ejecución de tools de forma comprobable, `/security-review` sin
  hallazgos altos en webhook/auth/consultar_datos.
- **D**: deploy reproducible a dev desde CI; alertas y budgets activos; restore drill ejecutado;
  procedimiento de cutover ensayado con rollback.
