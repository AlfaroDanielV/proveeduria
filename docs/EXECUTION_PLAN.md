# Plan de Ejecución — Módulo 1 Proveeduría (Proyekta)

**Path A refinado: Azure-native, dimensionado al contrato real.**
Fuente de alcance: `Propuesta_Proyekta.pdf` (v3, abril 2026). Contrato: 90 días desde firma, prototipo navegable al día 30, go-live al día 90, mensualidad operativa de ₡200.000 que cubre hosting + consumo de IA + almacenamiento + soporte.

---

## 1. Decisiones de arquitectura (refinamiento sobre Proposal A)

La Proposal A original (ACS + Durable Functions + Service Bus + Foundry + AI Search + Container Apps + PostgreSQL HA) es correcta en sus *controles* pero sobredimensionada en *infraestructura* para este contrato. Ese stack cuesta solo en plataforma más que la mensualidad completa, y su curva de operación no es razonable para un implementador solo en 90 días. Refinamiento:

| Componente | Proposal A original | Decisión refinada | Por qué |
|---|---|---|---|
| WhatsApp | ACS Advanced Messaging | **Meta Cloud API directo** | Sin markup de intermediario; el repo actual ya habla el formato Meta; ACS/Twilio quedan como plan B si Meta bloquea la verificación del negocio. Costo por conversación va directo a Meta. |
| Orquestación | Durable Functions | **Máquina de estados en PostgreSQL + workers sobre colas** | El flujo del PDF §4.2 ya define los estados del pedido explícitamente (Borrador → Cotizando → En revisión → Aprobado → Ordenado → Recepción parcial/total → Cerrado). Una tabla `pedidos.estado` con transiciones validadas + patrón outbox es más simple, auditable y depurable que Durable Functions, y no agrega otro runtime. Upgrade path documentado si el volumen lo exige. |
| Mensajería | Service Bus (sesiones por pedido) | **Azure Storage Queues** + tabla de deduplicación | At-least-once + idempotencia por `wamid` cubre el requisito real. Service Bus (~$10/mes base + operación) no aporta nada a este volumen (~80 pedidos/mes, ~160 facturas/mes). El orden por pedido se garantiza con un lock advisory por `pedido_id` en el worker, no con sesiones de broker. |
| Agentes IA | Azure Foundry Agent Service | **Anthropic API directo (Claude)** con tool-use, un solo loop de agente + herramientas deterministas | El prompt y las tools del prototipo actual ya funcionan sobre Anthropic. Foundry agrega gestión que un equipo de una persona no amortiza. Los "11 agentes" de la propuesta original se implementan como **un router + herramientas especializadas + jobs deterministas**, no como 11 procesos. |
| OCR | Document Intelligence entrenado custom | **Document Intelligence prebuilt-invoice** para facturas + **Claude Vision** para cotizaciones, boletas manuscritas y NC | Prebuilt invoice cuesta ~$10/1000 páginas y extrae líneas estructuradas; Claude Vision ya lee manuscritos/fotos en el prototipo. Modelos custom entrenados quedan para cuando haya corpus real del piloto. |
| Búsqueda/RAG | Azure AI Search | **Consultas SQL sobre vistas** generadas por el agente (tool `consultar_datos`) | Las consultas gerenciales del PDF ("cuánto cemento se compró a Rodex en marzo en López") son consultas relacionales, no búsqueda semántica. AI Search (~$75/mes mínimo útil) se pospone a módulos futuros. |
| Runtime | Container Apps multi-servicio | **Container Apps: 2 apps (api, worker)** en un solo environment, escala a 0/1 | Suficiente y barato; misma imagen, dos entrypoints. |
| Base de datos | PostgreSQL Flexible con HA | **PostgreSQL Flexible Server B1ms/B2s, sin HA, backup PITR 7-35 días** | HA duplica costo; el RTO aceptable para este negocio se cubre con PITR + restore drill mensual. |
| Llamadas telefónicas a proveedores | ACS Call Automation | **Fuera del Módulo 1** | El PDF no lo promete. Confirmación escrita por WhatsApp antes de OC es la regla. Se evalúa como módulo posterior. |
| Portales | 2 portales (interno + cliente) | **1 portal interno** con roles + los enlaces temporales de dashboard por proyecto que el PDF sí promete (§4.5) | El portal de cliente final no está en el alcance del Módulo 1 (los informes al cliente son Módulo 5). |

**Lo que NO se recorta (controles no negociables, heredados de Proposal A):**

1. Verificación de firma del webhook (`X-Hub-Signature-256`) y deduplicación por `wamid` antes de cualquier procesamiento.
2. Persistir el mensaje entrante en Postgres **antes** de invocar IA; el webhook responde 200 y encola; todo procesamiento de IA/OCR corre en el worker.
3. Cero acceso anon a datos: el dashboard consume una API autenticada; se eliminan las políticas RLS anónimas de `dashboard_rls.sql`. JWT firmado y verificado en servidor (corrige `dashboard/src/utils/jwt.js`).
4. Bitácora de auditoría append-only (`audit_events`): toda transición de estado, mensaje, adjunto, tool call, decisión y aprobación, con actor, timestamp y origen.
5. Aprobación humana obligatoria en los puntos del PDF: selección de ganador, emisión de OC, confirmación de recepción, aplicación de NC ambigua, cierre de pedido. El agente recomienda; no adjudica solo.
6. Umbrales de confianza en extracción OCR/LLM: bajo umbral → cola de revisión humana, nunca escritura silenciosa.
7. Migraciones versionadas de base de datos, backups diarios verificados y un restore drill antes del go-live.
8. Secretos en Azure Key Vault; nunca en el repo ni en variables de app en texto plano sin referencia a Key Vault.

---

## 2. Arquitectura objetivo

```
WhatsApp (Meta Cloud API)
        │  webhook firmado
        ▼
┌─────────────────────┐     ┌──────────────────────────────┐
│ api (Container App)  │     │ worker (Container App)       │
│ - verify signature   │     │ - agente Claude (router+tools)│
│ - dedup por wamid    │────▶│ - OCR (DocIntel / Vision)     │
│ - persist mensaje    │queue│ - máquina de estados pedido   │
│ - REST para portal   │     │ - envío WhatsApp (outbox)     │
│ - auth (JWT firmado) │     │ - cron: plazos, resúmenes     │
└─────────┬───────────┘     └──────────┬───────────────────┘
          │                            │
          ▼                            ▼
   PostgreSQL Flexible  ◀──────  Blob Storage (adjuntos)
   (datos + outbox + audit)      App Insights (trazas por pedido_id)
```

- **Monorepo**: `apps/api`, `apps/worker`, `apps/portal` (React/Vite actual, migrado), `packages/db` (migraciones + seeds), `packages/core` (dominio: estados, políticas, tipos), `packages/agent` (prompt, tools, extractores).
- **Outbox**: todo mensaje saliente de WhatsApp se inserta en `outbox_messages` en la misma transacción que el cambio de estado; un dispatcher lo envía y registra el `wamid` de salida. Nada se envía dos veces ni se pierde si el proceso muere.
- **Idempotencia entrante**: tabla `inbound_messages(wamid unique)`; el webhook hace `INSERT ... ON CONFLICT DO NOTHING` y solo encola si insertó.
- **Trazabilidad**: cada operación lleva `pedido_id`/`correlation_id` en logs y App Insights.

### Modelo del agente (los "11 agentes" como un sistema realista)

Un **solo loop de agente Claude** con router por tipo de remitente (interno vs proveedor, identificado por número) y estas herramientas deterministas:

- `crear_pedido`, `confirmar_pedido` (Pedido)
- `sugerir_proveedores`, `enviar_rfq`, `registrar_cotizacion` (Supplier/Quote Parser — el parseo usa Vision/transcripción + esquema estricto)
- `generar_comparativo` (Comparator — SQL determinista, no LLM)
- `aprobar_ganador`, `emitir_oc` (PO — plantillas, numeración correlativa transaccional)
- `registrar_factura`, `confirmar_recepcion`, `asociar_nota_credito` (Receiving)
- `registrar_equipo`, `registrar_devolucion`, `consultar_inventario_equipos` (Equipment)
- `consultar_datos` (Query — SQL parametrizado sobre vistas whitelisted, solo lectura)
- Auditoría no es un agente: es un trigger/middleware que registra todo automáticamente.

Los flujos de excepción del PDF §4.6 se implementan como **reglas deterministas en las tools**, no como juicio del LLM: factura sin OC → cola de revisión; diferencia de monto > umbral → escalar; NC ambigua → preguntar; dos repreguntas sin respuesta → escalar.

### Política de decisión

- El agente **siempre puede recomendar**.
- Adjudicación y emisión de OC **siempre** requieren aprobación de José Pablo (o rol Proveeduría) por WhatsApp o portal. El PDF lo define así; no se implementa auto-award en Módulo 1. La tabla `approval_events` registra quién apro
bó qué, cuándo y desde qué canal.

---

## 3. Modelo de datos (mínimo Módulo 1)

Núcleo (migración 001–004):
`users, roles, user_roles, projects, suppliers, supplier_contacts, materials_catalog(opcional fase 2), pedidos, pedido_items, quote_requests, quote_responses, quote_items, purchase_orders, po_items, invoices, invoice_items, invoice_po_links, credit_notes, credit_note_items, equipment_rentals, equipment_movements, attachments, inbound_messages, outbox_messages, conversations(estado conversacional persistido — reemplaza el Map en memoria de server.js:958), review_queue, approval_events, audit_events, dashboard_links(tokens temporales 24h del PDF §4.5)`.

Reglas duras:
- Pedido→OC es 1:N; OC→Factura es 1:N; Factura→NC es 1:N (estructura confirmada en PDF §4.3 paso 5).
- `audit_events` sin UPDATE/DELETE (revocar permisos + trigger de bloqueo).
- Numeración `PED-YYYY-NNN` / `OC-YYYY-NNN` con secuencia transaccional por año.
- Transiciones de estado válidas codificadas en `packages/core` y verificadas también por trigger (defensa en profundidad).

---

## 4. Cronograma de 90 días (alineado al contrato)

> Pre-firma (¡empezar YA!): verificación del negocio en Meta y aprobación de número/display name puede tardar semanas — es el ítem de camino crítico. Ver DEPLOYMENT_COOKBOOK.md.

### Fase 1 — Levantamiento y fundaciones (días 1–15)
- Sesión de afinamiento con Proveeduría, Servicios Generales y Gerencia; validar flujo §4 y estados §4.2. Congelar alcance por escrito.
- Modelado de datos final + migraciones 001–004 + seeds (proyectos, usuarios/roles, catálogo inicial de proveedores con contactos WhatsApp).
- Scaffold del monorepo, CI/CD (GitHub Actions → Container Apps con OIDC), entornos `dev` y `prod`, Key Vault, App Insights.
- Webhook ingest production-safe: firma, dedup, persistencia, cola. Smoke test con número de prueba de Meta.
- Portal: auth real (login + JWT firmado servidor) y shell de navegación con roles.
- **Entregable día 15**: infraestructura desplegada, mensaje de WhatsApp entra→se persiste→worker responde; portal con login.

### Fase 2a — Prototipo navegable (días 16–30) ← hito contractual
- Flujo pedido: texto/voz/foto → extracción → confirmación → `Borrador`, numeración PED.
- RFQ: sugerencia de proveedores, aprobación de lista, envío paralelo con plantillas aprobadas, estado `Cotizando`.
- Captura de cotizaciones (texto/foto/audio) → normalización → tabla comparativa por WhatsApp y en portal.
- Portal: lista de pedidos por estado, detalle de pedido, comparativo.
- **Entregable día 30**: demo end-to-end pedido→cotizaciones→comparativo con datos reales de prueba, navegable por el equipo Atemporal.

### Fase 2b — Flujo completo (días 31–60)
- Aprobación de ganador (único o dividido), emisión y envío de OC (PDF generado + plantilla WhatsApp), estados `Aprobado`/`Ordenado`.
- Recepción: foto de factura → DocIntel/Vision → cruce contra OCs abiertas → confirmación bodeguero → `Recepción parcial/total`. Cola de revisión para no-match y diferencias sobre umbral.
- Notas de crédito: asociación a factura origen, ajuste de costo real, escalamiento si ambigua.
- Equipos de alquiler: alta por boleta, devoluciones parciales, inventario activo por proyecto/proveedor, cierre en cero.
- Cierre de pedido con confirmación de Proveeduría; notificación al ingeniero.
- Dashboards por proyecto (enlace temporal 24h renovable), exportaciones CSV/Excel para contabilidad, consultas conversacionales (`consultar_datos`).
- Vencimiento de plazos de cotización (cron), seguimientos a proveedores, resumen diario.
- Capacitación inicial del equipo (sesiones cortas por rol, guías de 1 página por flujo).
- **Entregable día 60**: flujo completo del PDF §4.3 + §4.4 operativo en `dev` con los 5 roles.

### Fase 3 — Piloto y go-live (días 61–90)
- Días 61–65: carga real — proveedores del proyecto piloto (5–10), usuarios reales, presupuesto-referencia del proyecto.
- Días 66–85: operación piloto en 1 proyecto activo. Yo monitoreo diariamente: cola de revisión, excepciones, calidad de extracción (medir % de facturas correctamente extraídas; ajustar umbrales), latencia y costos de IA.
- Pruebas de fallo: caída del worker a mitad de flujo, mensaje duplicado de Meta, factura ilegible, proveedor que responde tarde. Restore drill de base de datos.
- Alertas: RFQ fallida, workflow atascado >24h en un estado, mismatch de factura, gasto IA diario anómalo.
- Días 86–90: ajustes finales, capacitación de refuerzo, rollout al resto de proyectos, go-live formal. Arranca mensualidad.

---

## 5. Presupuesto operativo mensual (contra ₡200.000 ≈ USD ~385)

| Rubro | Estimado USD/mes |
|---|---|
| Container Apps (api + worker, consumo bajo) | 15–35 |
| PostgreSQL Flexible B1ms/B2s + backup | 15–40 |
| Blob Storage + Storage Queues (fotos ~10–20 GB/año) | 2–5 |
| App Insights (con sampling y caps) | 5–15 |
| Document Intelligence prebuilt-invoice (~200 págs/mes) | ~2 |
| Anthropic API (agente + Vision; ~80 pedidos, 160 facturas, consultas) | 40–120 |
| WhatsApp (conversaciones Meta; mayoría utility/service) | 10–40 |
| Key Vault, ACR básico, dominio, misceláneos | 5–10 |
| **Total plataforma + IA** | **~95–265** |

Margen restante de la mensualidad cubre soporte y mantenimiento. Poner **budgets y alertas en Azure y límite de gasto en Anthropic Console** desde el día 1; el escenario de riesgo es un loop del agente quemando tokens.

## 6. Riesgos principales y mitigación

1. **Verificación de Meta Business / número WhatsApp tarda** → iniciar antes de la firma; plan B: ACS o Twilio como BSP (misma app, adaptador de canal).
2. **Proveedores no adoptan el canal** (responden al número viejo, mandan cotizaciones por otros medios) → onboarding explícito en piloto: mensaje de presentación aprobado por Proyekta, José Pablo avisa a cada proveedor; el sistema acepta reenvío manual (José Pablo reenvía la cotización al agente).
3. **Calidad de OCR en facturas físicas arrugadas/fotos malas** → umbral de confianza + confirmación del bodeguero campo por campo solo cuando dudoso + cola de revisión; medir en piloto antes de confiar.
4. **Alcance se infla en la sesión de afinamiento** → todo lo nuevo va a la lista de Módulos 2–5 del PDF §10; el día-30 y día-90 son fijos.
5. **Un solo desarrollador** → el AI-assisted setup (ver AI_ASSISTED_DEVELOPMENT.md) es parte del plan de capacidad, no un lujo; disciplina de specs + tests para que el avance sea verificable.

## 7. Criterios de aceptación del go-live

- Un pedido real recorrió Borrador→Cerrado con cotizaciones de ≥3 proveedores reales, OC emitida, factura conciliada y NC aplicada al menos una vez.
- 0 mensajes perdidos ni duplicados en 2 semanas de piloto (verificable contra `inbound_messages`/`audit_events`).
- ≥90% de facturas del piloto extraídas sin corrección manual de montos; el resto atrapado por la cola de revisión (nunca escrito mal en silencio).
- Restore de backup ejecutado y verificado una vez.
- Los 5 roles operan sin asistencia en sus flujos básicos.
- Dashboard por proyecto y exportación CSV entregadas al equipo contable.
