# Cookbook de Despliegue — Qué debe estar listo antes y durante

Checklist operativo para el Módulo 1. Los ítems marcados **[CRÍTICO-PLAZO]** tienen tiempos de aprobación de terceros — empezarlos antes de la firma del contrato.

---

## 1. WhatsApp (Meta) — camino crítico

### 1.1 Prerrequisitos del lado de Proyekta / tuyo
- [ ] **[CRÍTICO-PLAZO] Meta Business Portfolio (Business Manager)** para la entidad que operará el número. Decidir: ¿el WABA es de Proyekta o tuyo como proveedor del servicio? Recomendado: **de Proyekta** (el nombre visible será "Proveeduría Proyekta" y el activo queda en su propiedad, consistente con la cláusula de propiedad intelectual del contrato), contigo como partner/admin.
- [ ] **[CRÍTICO-PLAZO] Verificación del negocio en Meta** (cédula jurídica, sitio web o documentación de Proyekta). Puede tardar de días a semanas. Sin esto: límite de 250 conversaciones iniciadas/día — suficiente para piloto, no para operar con decenas de proveedores.
- [ ] **Número telefónico dedicado** para el agente: un número (celular o fijo CR +506) que **no esté registrado en WhatsApp personal/Business app**. Debe poder recibir SMS o llamada de verificación una vez. Recomendación: SIM nueva a nombre de Proyekta, guardada; el número vive en la nube después del registro.
- [ ] **Display name** aprobado por Meta (p.ej. "Proyekta Proveeduría") — debe tener relación demostrable con el negocio.
- [ ] App de Meta for Developers (tipo Business) + **System User token permanente** (no tokens temporales de 24h) con permisos `whatsapp_business_messaging`, `whatsapp_business_management`.
- [ ] **Webhook**: URL pública HTTPS (la Container App `api`), verify token, y **App Secret** guardado en Key Vault para validar `X-Hub-Signature-256`.

### 1.2 Plantillas de mensaje (aprobación previa de Meta, horas–días)
Fuera de la ventana de 24h solo se puede iniciar conversación con plantillas aprobadas. Redactar y someter a aprobación en Fase 1 (categoría *utility* donde aplique — más barato que *marketing*):
- [ ] `rfq_solicitud` — solicitud de cotización a proveedor (variables: proveedor, proyecto, lista de ítems, plazo).
- [ ] `rfq_recordatorio` — seguimiento antes del vencimiento del plazo.
- [ ] `oc_emitida` — envío de orden de compra (con documento adjunto).
- [ ] `oc_confirmacion_solicitada` — solicitud de confirmación escrita del proveedor.
- [ ] `notificacion_interna` — avisos a usuarios internos fuera de ventana (comparativo listo, factura pendiente de revisión, resumen diario).
- [ ] Mensaje de presentación del agente a proveedores nuevos (onboarding).

### 1.3 Reglas operativas a interiorizar
- Ventana de servicio de 24h: cuando el proveedor responde, se puede conversar libre 24h; después, solo plantilla.
- **Opt-in**: Proyekta debe poder demostrar que los proveedores aceptaron recibir mensajes — José Pablo los avisa y se registra en el sistema (tabla `supplier_contacts.optin_at`).
- Calidad del número (quality rating): si los proveedores bloquean/reportan, Meta degrada el número. El mensaje de presentación humana antes del primer RFQ automático es la protección.
- Precios por conversación/plantilla de Meta cambian (modelo por-mensaje-plantilla desde 2025); revisar la tarifa vigente para CR al presupuestar.
- Números de prueba de Meta (test number + hasta 5 destinatarios) sirven para todo el desarrollo Fase 1–2 sin tocar el número real.

### 1.4 Plan B
Si la verificación de Meta se atasca: **Twilio WhatsApp** o **ACS Advanced Messaging** como BSP encima del mismo WABA — el código debe aislar el envío/recepción tras una interfaz `WhatsAppChannel` para poder cambiar de proveedor sin tocar el dominio.

---

## 2. Azure — inventario de infraestructura

### 2.1 Cuenta y gobierno
- [ ] Suscripción de Azure (decidir: tenant de Proyekta o tuyo con facturación separable; recomendado suscripción dedicada `proyekta-proveeduria`).
- [ ] Región: **East US 2** o **Central US** (cercanía a CR, disponibilidad de todos los servicios).
- [ ] Grupos de recursos: `rg-provee-dev`, `rg-provee-prod`.
- [ ] **Presupuesto + alertas de costo** (p.ej. alerta a $150 y $250/mes) desde el día 1.
- [ ] Convención de nombres y tags (`env`, `module`).

### 2.2 Recursos por entorno (dev y prod)
| Recurso | SKU recomendado | Notas |
|---|---|---|
| Container Apps Environment | Consumption | apps: `api` (ingress externo, HTTPS), `worker` (sin ingress, KEDA scale por cola; min 1 réplica en prod) |
| Azure Container Registry | Basic | una sola, compartida dev/prod |
| PostgreSQL Flexible Server | B1ms (dev) / B2s (prod), 32GB | PITR 14 días en prod; TLS obligatorio; firewall a Container Apps; sin HA en Módulo 1 |
| Storage Account | Standard LRS | Blob: contenedor `attachments` (privado, SAS de corta vida para el portal); Queues: `inbound`, `outbox`, `jobs` |
| Key Vault | Standard | secretos: Meta app secret + token, Anthropic key, DB connection string, JWT signing key; acceso vía managed identity |
| Application Insights + Log Analytics | Pay-as-you-go con cap diario | trazas con `pedido_id`; alertas: cola atascada, errores de webhook, gasto anómalo |
| Document Intelligence | S0 pay-per-use | prebuilt-invoice; mismo recurso para dev/prod |
| Static Web App o Blob static + CDN | Free/Standard | portal React (o servirlo desde `api`) |

- [ ] **Managed identities** para api/worker → Key Vault, Storage, ACR (nada de connection strings en env vars planas).
- [ ] Dominio: `proveeduria.proyekta.cr` (o subdominio tuyo para el piloto) + certificado gestionado.
- [ ] GitHub Actions con **OIDC federated credentials** (sin secretos de service principal en GitHub).

### 2.3 Datos y respaldos
- [ ] Migraciones con herramienta versionada (node-pg-migrate / drizzle-kit / sqitch) — nunca más SQL manual en el editor de Supabase.
- [ ] Backup automático PITR verificado + **restore drill agendado** (uno antes del go-live, luego mensual).
- [ ] Export mensual de blobs de facturas a contenedor cool/archive (retención documental).
- [ ] Script de seed reproducible: roles, usuarios (los 5 actores del PDF §4.1), proyectos, proveedores.

### 2.4 IA
- [ ] Cuenta Anthropic Console con **límite de gasto mensual** y alertas; API key por entorno en Key Vault.
- [ ] Si Proyekta exige residencia/procesamiento en Azure: alternativa Claude vía plataforma con hosting Azure — resolver en Fase 1, no después.
- [ ] Revisión de privacidad documentada (una página): qué datos ven los modelos, retención, y el compromiso de no-entrenamiento del proveedor. Entregarla a Proyekta.

---

## 3. Secuencia de despliegue (orden real)

1. **Semana 0 (pre-firma)**: Business Manager + verificación Meta + número dedicado + suscripción Azure creada.
2. **Días 1–5**: IaC básico (Bicep o azd) de `rg-provee-dev`: Postgres, Storage, Key Vault, ACA env, App Insights. CI que construye y despliega imagen a dev en cada merge a `main`.
3. **Días 5–10**: webhook `api` en dev conectado al **número de prueba** de Meta; plantillas sometidas a aprobación.
4. **Días 10–15**: réplica prod con IaC (mismo template, params distintos). Dominio + TLS.
5. **Día ~55**: cutover del número real al WABA de producción; smoke test con 2 proveedores amistosos.
6. **Días 61+ (piloto)**: monitoreo diario de App Insights + revisión de `review_queue` + reporte semanal de costos.

## 4. Checklist go-live (día 90)

- [ ] Firma de webhook activa y probada con firma inválida (rechaza).
- [ ] Mensaje duplicado de Meta reprocesado → un solo efecto (probado).
- [ ] Kill del worker a mitad de emisión de OC → al reiniciar, outbox completa el envío sin duplicar (probado).
- [ ] Restore drill ejecutado sobre backup de prod.
- [ ] Límites de gasto: Azure budget, Anthropic cap, App Insights cap.
- [ ] RLS anon de Supabase eliminada / proyecto Supabase legado apagado tras migrar datos.
- [ ] Todos los secretos en Key Vault; `git log` sin secretos históricos (si los hubo: rotar).
- [ ] Runbook de 1 página: qué hacer si el agente responde mal, cómo pausar el número, contactos de soporte.
- [ ] Capacitación completada y guías por rol entregadas.
