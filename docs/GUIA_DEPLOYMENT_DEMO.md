# Guía: deployment y configuración del demo para Atemporal

Cómo publicar el sistema para que el equipo de Atemporal lo use de verdad: portal web con
login + WhatsApp real (número de prueba o real de Meta). Cubre requisitos mínimos, la
instalación paso a paso, toda la configuración, la entrega y los límites conocidos.

> **Contexto honesto**: el pipeline formal de producción (contenedores, IaC, CI/CD a
> Container Apps, Key Vault, App Insights) es el workstream D del plan y **aún no está
> construido**. Esta guía documenta el camino de demo **disponible hoy**: una VM Linux con
> systemd + nginx, que es suficiente, barato y honesto para un piloto/demo. El upgrade a
> Container Apps no cambia la configuración de la app (mismas variables), solo dónde corre.

## 1. Modalidades del demo

| | Demo A — solo portal | Demo B — completo con WhatsApp |
|---|---|---|
| Qué ve Atemporal | Centro de Control web: pedidos, comparativos, proveedores, aprobaciones, OCs con PDF | Todo lo de A **+** pedir materiales por WhatsApp, RFQs reales a proveedores, cotizar por foto/texto |
| Requiere Meta | No | Sí (App + número + token) |
| Requiere Anthropic | No (flujo por portal) | Sí (agente conversacional + extractores) |
| Esfuerzo | ~medio día | A + configuración de Meta (el lead time es de Meta, no técnico) |

Recomendación: montar A primero (valida infra + acceso del cliente) y activar B encima —
es solo agregar variables y configurar Meta; no se reinstala nada.

## 2. Requisitos mínimos

### Infraestructura (ambas modalidades)

| Recurso | Mínimo | Nota |
|---|---|---|
| VM Linux (Ubuntu 22.04+) | 2 vCPU / 4 GB / 30 GB (Azure `B2s` o equivalente) | Corre api + worker + nginx + (opcional) Postgres |
| PostgreSQL 14+ | Azure Flexible Server `B1ms` (recomendado) o en la misma VM (demo corto) | Gestionado = backups PITR incluidos |
| **Azure Storage Account** | Standard LRS, 1 cola (`ingesta`) | **Obligatorio siempre**: es el transporte api→worker entre procesos. Costo ~USD 1/mes |
| Dominio + DNS | un subdominio (p. ej. `demo.atemporal.cr`) | **HTTPS es obligatorio**: Meta solo entrega webhooks a URLs `https` válidas, y las cookies del portal son `Secure` en producción |
| Node.js 22 + git en la VM | — | — |

### Cuentas y claves

| Clave | Modalidad | Cómo se obtiene |
|---|---|---|
| `ANTHROPIC_API_KEY` | B (y A si se quiere el agente) | console.anthropic.com — **poner límite de gasto mensual desde el día 1** (EXECUTION_PLAN §5: el escenario de riesgo es un loop quemando tokens) |
| Meta: App ID + `META_APP_SECRET` | B | developers.facebook.com → crear App tipo Business con producto WhatsApp |
| `META_PHONE_NUMBER_ID` + `META_ACCESS_TOKEN` | B | Con **número de prueba** de Meta: gratis, permite hasta 5 destinatarios verificados — suficiente para el demo con el equipo. Token permanente: crear un *System User* en Business Manager con permiso `whatsapp_business_messaging` (el token temporal del panel expira en 24 h) |
| `OPENAI_API_KEY` | opcional | Solo para cotizaciones por **audio** (Whisper). Sin ella, el agente pide texto/foto |
| Secretos propios (`PORTAL_JWT_SECRET`, `ATTACHMENTS_LINK_SECRET`, `META_VERIFY_TOKEN`) | ambas | Generarlos: `openssl rand -base64 48` (uno por secreto; **nunca** en el repo) |

### Bloqueos humanos previos (no técnicos)

1. **Revisar el prompt** (`packages/agent/src/agent/prompt.ts`) — es borrador marcado
   `REVISION HUMANA REQUERIDA`; es la voz del asistente ante el equipo.
2. **Plantillas de Meta**: para el demo con el equipo interno NO hacen falta (el flujo
   dentro de la ventana de 24 h —el usuario escribe primero— va sin plantillas). Para que
   los **RFQs/OCs lleguen a proveedores que no han escrito**, las 7 plantillas de
   `docs/specs/templates-whatsapp.md` (texto listo, marca Atemporal) deben someterse a
   aprobación de Meta — revisión típica: minutos a días. Someterlas temprano.
3. **Verificación del negocio en Meta**: no bloquea el demo con número de prueba, pero es
   el camino crítico para el número real del go-live (semanas) — iniciarla ya.

## 3. Instalación en la VM (paso a paso)

```bash
# 3.1 Base
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git postgresql-client
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# 3.2 Código (usuario de servicio dedicado)
sudo useradd -m -s /bin/bash provee
sudo -iu provee git clone <URL-DEL-REPO> app
cd /home/provee/app && sudo -iu provee bash -c 'cd ~/app && npm install && npm run build:all'

# 3.3 Base de datos (si es Azure Flexible: crear el server B1ms + una DB 'proveeduria'
#     con SSL; si es local para demo corto: apt install postgresql && crear rol/db)
export DATABASE_URL='postgres://USUARIO:CLAVE@HOST:5432/proveeduria?sslmode=require'
cd /home/provee/app && npm run migrate && npm run seed

# 3.4 Cola (una vez): en el Storage Account, la cola se crea sola al primer uso
#     (createIfNotExists), solo copiá la connection string del portal de Azure.
```

### 3.5 Usuarios reales de Atemporal

Los seeds traen 5 usuarios de ejemplo. Actualizalos con los teléfonos REALES (E.164 con
`+`) del equipo — el router identifica a la gente por número:

```sql
UPDATE users SET nombre='<Nombre real>', telefono_whatsapp='+506XXXXXXXX', email='<email>'
WHERE email='proveeduria@atemporal.cr';   -- repetir por rol: gerencia/ingenieria/bodega/equipos
```

Credencial inicial del portal (superadmin) — igual que en la guía local §4:

```bash
HASH=$(node --input-type=module -e "const {hashPassword} = await import('/home/provee/app/apps/api/dist/portal/crypto.js'); console.log(await hashPassword('CAMBIAR-ESTA-CLAVE'));")
psql "$DATABASE_URL" -c "INSERT INTO user_credentials (user_id, password_hash, must_change_password)
  SELECT id, '$HASH', true FROM users WHERE email='gerencia@atemporal.cr'
  ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash, must_change_password=true;"
```

Con `must_change_password=true` el portal fuerza el cambio en el primer login. Las demás
credenciales las emite ese superadmin **desde el portal** (queda auditado).

## 4. Configuración (todas las variables)

Crear `/etc/provee/api.env` y `/etc/provee/worker.env` (`chmod 600`, dueño root).

### `/etc/provee/api.env`

```bash
NODE_ENV=production
PORT=8080
DATABASE_URL=postgres://...sslmode=require
# Webhook Meta (Demo B; en Demo A poné placeholders — son requeridas para arrancar)
META_APP_SECRET=<app secret de la App de Meta>
META_VERIFY_TOKEN=<openssl rand -base64 32>
# Cola (transporte api→worker) — OBLIGATORIA en production (falla-cerrado)
AZURE_STORAGE_QUEUE_CONNECTION=<connection string del Storage Account>
AZURE_STORAGE_QUEUE_NAME=ingesta
# Portal
PORTAL_JWT_SECRET=<openssl rand -base64 48>          # REQUERIDO en production
ATTACHMENTS_LINK_SECRET=<openssl rand -base64 48>    # REQUERIDO en production (PDFs de OC)
# PORTAL_ORIGIN: NO la definas si el portal se sirve por el MISMO dominio (nginx, §5)
# — same-origin, sin CORS. Solo si sirvieras el portal desde otro dominio.
```

### `/etc/provee/worker.env`

```bash
DATABASE_URL=postgres://...sslmode=require
AZURE_STORAGE_QUEUE_CONNECTION=<la MISMA del api>
WORKER_QUEUE_NAME=ingesta
# Envío real por WhatsApp (Demo B). En Demo A: WORKER_OUTBOX_MODE=console
WORKER_OUTBOX_MODE=meta
META_PHONE_NUMBER_ID=<phone number id>
META_ACCESS_TOKEN=<token permanente del system user>
PUBLIC_API_URL=https://demo.atemporal.cr             # base pública para links de PDF
ATTACHMENTS_LINK_SECRET=<EL MISMO del api>           # firma compartida de los links
# Agente
ANTHROPIC_API_KEY=sk-ant-...
AGENT_MODEL=claude-sonnet-5                          # conversación (default)
AGENT_EXTRACT_MODEL=claude-haiku-4-5-20251001        # extracción barata (default)
# OPENAI_API_KEY=sk-...                              # opcional: audio via Whisper
# Ajustes con defaults sanos (no tocar salvo necesidad):
# WORKER_VISIBILITY_S=120  WORKER_MAX_DEQUEUE=5  WORKER_POLL_EMPTY_MS=1000
# WORKER_OUTBOX_POLL_MS=2000  WORKER_CRON_POLL_MS=60000  OUTBOX_CLAIM_LEASE_S=300  OUTBOX_BATCH=20
```

> Referencia completa y comentada: `apps/api/.env.example` y `apps/worker/.env.example`.
> Reglas duras: `ATTACHMENTS_LINK_SECRET` idéntico en ambos; en modo `meta` el worker se
> niega a arrancar si falta cualquiera de `META_PHONE_NUMBER_ID`/`META_ACCESS_TOKEN`/
> `PUBLIC_API_URL`/`ATTACHMENTS_LINK_SECRET` (falla-cerrado a propósito).

## 5. Servicios y web

### systemd — `/etc/systemd/system/provee-api.service`

```ini
[Unit]
Description=Proveeduria API (webhook + portal)
After=network.target
[Service]
User=provee
WorkingDirectory=/home/provee/app/apps/api
EnvironmentFile=/etc/provee/api.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
```

`provee-worker.service`: idéntico cambiando `Description`, `WorkingDirectory=
/home/provee/app/apps/worker` y `EnvironmentFile=/etc/provee/worker.env`. Luego:

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now provee-api provee-worker
journalctl -u provee-worker -f    # debe loguear worker.arranque con consumer:"azure",
                                  # outbox:"meta" (o console), engine:"claude"
```

### nginx — portal estático + proxy same-origin

```nginx
server {
  server_name demo.atemporal.cr;
  root /home/provee/app/apps/portal/dist;      # npm run build -w @proveeduria/portal
  index index.html;
  location / { try_files $uri /index.html; }   # SPA
  location /api/ { proxy_pass http://127.0.0.1:8080; proxy_set_header X-Forwarded-For $remote_addr; }
  location /webhook { proxy_pass http://127.0.0.1:8080; }
  client_max_body_size 5m;
}
```

```bash
sudo certbot --nginx -d demo.atemporal.cr     # TLS automático (obligatorio para Meta)
```

Servir portal y api bajo el mismo dominio evita CORS por completo (cookies same-origin,
más simple y más seguro). `X-Forwarded-For` alimenta el rate limit del login.

## 6. Configuración de Meta (Demo B)

1. developers.facebook.com → **Create App** (tipo *Business*) → agregar producto
   **WhatsApp**. Copiar el **App Secret** → `META_APP_SECRET`.
2. WhatsApp → API Setup: usar el **número de prueba** (gratis). Copiar
   **Phone number ID** → `META_PHONE_NUMBER_ID`. Agregar como *recipients* verificados
   los teléfonos del equipo de Atemporal (máx. 5 con número de prueba).
3. Token permanente: Business Settings → System Users → crear, asignar la App y el
   activo de WhatsApp, generar token con `whatsapp_business_messaging` →
   `META_ACCESS_TOKEN`.
4. **Webhook**: Configuration → Callback URL `https://demo.atemporal.cr/webhook`,
   Verify token = tu `META_VERIFY_TOKEN` → *Verify and save* (el api responde el
   challenge) → suscribirse al campo **messages**.
5. Plantillas (para mensajes iniciados por el sistema fuera de ventana): crear las de
   `docs/specs/templates-whatsapp.md` con esos nombres EXACTOS (`rfq_solicitud`,
   `oc_emitida`, `notificacion_interna`, …), idioma `es`, y actualizar el archivo si Meta
   exige cambios de texto (regla: el spec refleja el texto aprobado).

## 7. Smoke de entrega (checklist antes de dárselo a Atemporal)

- [ ] `https://demo.atemporal.cr` carga el portal; login del superadmin fuerza cambio de clave.
- [ ] Crear un proveedor con contacto + opt-in desde el portal (queda en `audit_events`).
- [ ] Un ingeniero (teléfono verificado en Meta) escribe al número de prueba: "Ocupo 20
      sacos de cemento para <proyecto>" → el asistente responde, crea el pedido, y tras el
      "sí, confirmo" Proveeduría recibe la notificación por WhatsApp.
- [ ] Portal → pedido → **Enviar RFQs** → el contacto del proveedor (verificado en Meta)
      recibe el mensaje. Responde con precios (texto o foto) → cotización registrada →
      pedido `en_revision` con comparativo.
- [ ] Portal → **Adjudicar** → **Emitir OC** → el proveedor recibe `oc_emitida` **con el
      PDF adjunto** (esto valida `PUBLIC_API_URL` + `ATTACHMENTS_LINK_SECRET` end-to-end).
- [ ] `journalctl -u provee-worker` sin errores repetidos; en Anthropic Console, el gasto
      del smoke es visible y el **límite mensual está configurado**.
- [ ] Backup mínimo programado: `pg_dump` diario por cron a un storage (si el Postgres no
      es gestionado); si es Azure Flexible, verificar PITR activo.

## 8. Operación del demo

- **Logs**: `journalctl -u provee-api -f` / `-u provee-worker -f` (JSON por línea).
- **Actualizar**: `sudo -iu provee bash -c 'cd ~/app && git pull && npm install && npm run build:all'`
  → `npm run migrate` si hay migraciones nuevas → `sudo systemctl restart provee-api provee-worker`
  → recargar nginx solo si cambió el portal (`npm run build -w @proveeduria/portal`).
- **Salud rápida**: `psql`: `SELECT estado, count(*) FROM outbox_messages GROUP BY 1;`
  (filas `descartado` con `error_ultimo` explican qué pasó — p. ej. `ventana_24h_cerrada`
  o un código de Meta); `SELECT * FROM review_queue WHERE estado='pendiente';`.
- **Costos estimados del demo/mes**: VM B2s ~$30 + Postgres B1ms ~$15–25 + Storage ~$1 +
  Anthropic ~$10–40 (con límite) + dominio. **Total ≈ USD 60–100/mes** (vs. presupuesto
  operativo de EXECUTION_PLAN §5).

## 9. Qué incluye el demo — y qué no (decírselo al cliente)

**Incluye**: pedido por WhatsApp conversacional (texto/voz*/foto), RFQs automáticos a
proveedores, captura de cotizaciones por texto/foto/PDF, comparativo determinista,
adjudicación con evidencia, OC con PDF por WhatsApp, portal con login, CRUD de
proveedores, cola de revisión, bandeja de aprobaciones, vencimiento automático de plazos,
y auditoría completa de cada acción. (*voz requiere `OPENAI_API_KEY`.)

**No incluye aún** (plan: `docs/PLAN_FASE2A_2B_CONTROL_CENTER.md`): registro de facturas y
recepción (B5–B6), notas de crédito (B7), cierre de pedido (B8), equipos de alquiler (B9),
consultas/exportaciones/links de dashboard (B10), recordatorios y resumen diario (B11),
dashboards por proyecto y control del agente en portal (olas 2–3), y el pipeline formal de
producción (workstream D: contenedores, Key Vault, App Insights, CI/CD).

**Límites del número de prueba de Meta**: máximo 5 destinatarios verificados y marca
"test" — perfecto para demo interno; el número real requiere la verificación del negocio
(iniciarla ya; es el camino crítico del go-live).
