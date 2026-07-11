# Spec: Agente conversacional (A4–A7 — conversaciones, loop Claude, extractores, cron E1)

Contrato del tramo conversacional de Fase 2a: cómo un mensaje libre de WhatsApp se
convierte en tool calls deterministas. Complementa `tools.md` (contratos de tools),
`broker-colas.md` (ingesta) y `outbox-whatsapp.md` (envío). Regla transversal intacta:
**el LLM solo decide QUÉ tool llamar y QUÉ responder; permisos, estados y excepciones los
validan las tools** — nunca el modelo.

## A4 — Conversaciones persistidas (reemplaza el Map en memoria del legado)

- **Una conversación viva por teléfono** (`conversations.phone` UNIQUE — migración 011).
- **Upsert en la MISMA transacción del handler del worker** al procesar cada inbound:
  `phone`, `user_id` o `supplier_contact_id` (según el router), `last_message_at =
  received_at`, `ventana_24h_expira_at = received_at + 24h`; y se fija
  `inbound_messages.conversation_id`. El remitente **desconocido también** crea/actualiza
  conversación (anónima: sin `user_id` ni `supplier_contact_id`) — necesario para que la
  respuesta E11 (texto de sesión) pase el chequeo de ventana del dispatcher.
- **Historial para el loop**: derivado (no duplicado) de `inbound_messages` (entrantes del
  teléfono) + `outbox_messages` (salientes a ese destino con estado `enviado|enviando|
  pendiente`), intercalados por fecha ascendente, últimos **20** mensajes. El texto entrante
  se toma del payload persistido; el saliente de `texto` o de un resumen `[plantilla X]`.
- **`contexto` jsonb**: reservado para estado del agente (v1 NO se usa; el loop es
  stateless sobre el historial). Cualquier uso futuro se especifica aquí antes.
- **Ventana 24h en el dispatcher** (prevención activa; reemplaza el fallback por error
  131047): antes de enviar una fila con `texto != null` (sesión libre), consultar la
  conversación del `destino`: sin conversación o con `ventana_24h_expira_at <= now` →
  `descartado` con `error_ultimo='ventana_24h_cerrada'` + audit (mismo camino que un error
  permanente). Las plantillas se envían siempre. La consulta ocurre en la tx del claim
  (una lectura indexada).

## A5 — Loop Claude de producción

- **Registro único de tools** (`packages/agent/src/agent/registry.ts`): una sola lista
  `{ name, descripcion, inputSchema (JSON Schema estricto, additionalProperties: false),
  ejecutar(ctx, input) }` de la que derivan el whitelist estructurado, el dispatcher y los
  `tools` del API de Anthropic. Fin del triple mantenimiento.
- **Contrato del modelo** (`ModeloConversacional`): recibe `{ sistema, historial, mensaje,
  herramientas }` y devuelve `{ texto?: string, toolCall?: { name, input } }`. El loop:
  1. Llama al modelo con historial + mensaje + tools.
  2. Si hay `toolCall`: la ejecuta (validación completa en la tool), agrega el
     `tool_result` al historial del turno y vuelve a llamar. Máximo **5 pasos** por
     mensaje (guarda de costo/loop — EXECUTION_PLAN §5).
  3. El `texto` final se encola como **sesión libre** por outbox (la ventana está abierta:
     el usuario acaba de escribir).
  4. Sin texto ni tool ejecutable → respuesta de alcance (E8) fija, no del modelo.
- **Adapter Anthropic** (`@anthropic-ai/sdk` en `packages/agent`): modelo por config
  (`AGENT_MODEL`, default `claude-sonnet-5`), `max_tokens` acotado (1024), historial
  truncado a 20 mensajes. Errores del API = transitorios (nack del job; el broker
  reintenta con backoff; idempotencia por `processed_at` protege).
- **Prompt de producción**: `packages/agent/src/agent/prompt.ts`, marcado
  `REVISION HUMANA REQUERIDA (AI_ASSISTED_DEVELOPMENT §7)` — el borrador lo escribe el
  agente de código, la versión final la aprueba el humano. Identidad "Asistente de
  Proveeduría de Atemporal", tono vos costarricense, alcance E8, política: recomienda pero
  jamás adjudica/emite/cierra sin instrucción humana explícita en el turno; los proyectos
  activos se inyectan al contexto del sistema (para resolver E7).
- **Goldens**: fixtures de conversación (mensaje → tool esperada/respuesta) contra un
  modelo fake scripted (regresión sin red); un test gated por `ANTHROPIC_API_KEY` ejercita
  el adapter real (smoke, no en CI).
- **Gating del seam estructurado**: el engine de `tool_call`-en-texto solo opera cuando NO
  hay modelo configurado (`ANTHROPIC_API_KEY` ausente). Con modelo, un JSON en el body se
  trata como texto normal — cierra la superficie de invocación cruda por WhatsApp.

## A6 — Extractores y camino del proveedor

- **Pipeline de media** (worker, antes de cualquier extractor): inbound con media →
  `GET {graph}/{media_id}` (Bearer) → URL efímera → descarga → `attachments` +
  `attachment_blobs` (mismo almacenamiento de B4) → `inbound_messages.attachment_id`.
- **Convención de actor del proveedor** (resuelve el callejón sin salida actual): el
  mensaje de proveedor se ejecuta como **actor sistema** (`actor_sistema = true` en audit,
  sin roles) con contexto `{ supplierContactId, supplierId }`; `registrar_cotizacion`
  acepta actor sistema SOLO por esa vía (el `quote_request_id` se resuelve por remitente +
  RFQ `enviada` del proveedor; ambiguo → repregunta). La entrada por roles internos queda
  para el reenvío manual (E2/adopción). Se actualiza `tools.md` con esta convención.
- **Extractores** (`packages/agent/src/extractores/`): contrato único →
  `RegistrarCotizacionInput` estricto con `confianzaExtraccion`:
  - texto → modelo (schema estricto);
  - imagen/PDF → Claude Vision (mismo adapter, content block de imagen/documento);
  - audio → Whisper si hay `OPENAI_API_KEY`; si no, repregunta fija al proveedor ("no
    pude procesar el audio, ¿me lo enviás en texto o foto?") — cuenta como intento E2.
  - El mapeo línea→`pedido_item_id` es del extractor (descripciones del pedido en el
    prompt); ítems no mapeables van con `pedidoItemId: null` (la tool ya lo soporta).
- **BAJA** (router, antes del engine): texto de proveedor que normalizado sea `baja` →
  `optin_at = null` + audit `contacto_baja` (actor sistema, origen wamid) + notificación
  interna a Proveeduría + confirmación fija al proveedor. No pasa por el modelo.

## A7 — Cron E1 (vencimiento de plazos)

- **Scheduler**: loop de timer en el worker (patrón del dispatcher), cada
  `WORKER_CRON_POLL_MS` (default 60000), solo con `DATABASE_URL`. Exclusión entre
  réplicas: `pg_try_advisory_xact_lock(hashtext('cron:e1'))` — si otro lo tiene, el ciclo
  se salta.
- **Semántica** (cierra el contrato de `tools.md` §registrar_cotizacion "o vence plazo"):
  1. `marcarVencidas(now)` (repo B2): `quote_requests` `enviada` con `plazo_at <= now` →
     `vencida`.
  2. Por cada pedido afectado aún `cotizando` y sin RFQs `enviada` restantes: transición
     `cotizando → en_revision` + **comparativo en la misma transacción** (misma función
     que usa `registrar_cotizacion`; se extrae a un helper compartido preservando su
     semántica de rollback).
  3. Notificación E1 a Proveeduría (outbox `notificacion_interna`): proveedores vencidos
     del pedido y opciones ("extender plazo / continuar con lo recibido" — acciones humanas;
     extender = re-enviar RFQ, flujo manual v1).
  4. `audit_event('e1_vencimiento')` por pedido con los `quote_request_ids` vencidos.
- E13/recordatorios/resumen diario NO son de este bloque (B11: requieren plantillas
  aprobadas por Meta).
