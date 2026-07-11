# Guía: ambiente local de pruebas

Cómo levantar el sistema completo en tu máquina y validar los cambios de Fase 2a/2b sin
tocar WhatsApp real ni Azure real. **Todos los comandos de esta guía fueron ejecutados y
verificados el 2026-07-11** contra el estado actual del repo (migraciones 001–011).

Arquitectura local: Postgres y Azurite (emulador de Azure Storage Queues) en Docker; los
tres procesos (`apps/api`, `apps/worker`, `apps/portal`) corren con Node directo.

```
WhatsApp simulado (curl firmado) ──► api :8080 ──► Azurite (cola 'ingesta') ──► worker
                                      ▲                                          │
Portal React :5173 (proxy /api) ──────┘                    Postgres ◄────────────┘
                                                (outbox en modo 'console': imprime en vez de enviar)
```

## 1. Requisitos

| Qué | Versión / nota |
|---|---|
| Node.js | 22.x (el repo compila con NodeNext; `node --version`) |
| npm | 10+ (workspaces) |
| Docker | para Postgres 16 y Azurite (o instalaciones locales equivalentes) |
| `psql` | opcional pero muy útil para inspeccionar (`sudo apt install postgresql-client`) |
| API keys | **ninguna es necesaria** para el modo básico. Opcional: `ANTHROPIC_API_KEY` para el agente conversacional real; `OPENAI_API_KEY` para audio |

## 2. Instalación y verificación de base

```bash
git clone <repo> proveeduria && cd proveeduria
npm install
npm run build:all     # libs (core/db/agent) antes que apps — orden obligatorio
npm run typecheck
npm run test:all      # ~770 tests; los de integración quedan "skipped" sin DATABASE_URL
```

Si todo eso está verde, el código está sano. Lo que sigue es para probarlo *corriendo*.

## 3. Infraestructura local (Docker)

```bash
# Postgres 16 (puerto 55500 para no chocar con un Postgres local)
docker run -d --name provee-pg \
  -e POSTGRES_PASSWORD=provee -e POSTGRES_USER=provee -e POSTGRES_DB=provee_dev \
  -p 55500:5432 postgres:16

# Azurite (emulador de Azure Storage Queues — el transporte api→worker)
# OJO: --skipApiVersionCheck es OBLIGATORIO (nuestro SDK habla una versión de API
# más nueva que la que Azurite declara; sin el flag, el consumer recibe error en cada poll).
docker run -d --name provee-azurite -p 10001:10001 \
  mcr.microsoft.com/azure-storage/azurite \
  azurite-queue --queueHost 0.0.0.0 --skipApiVersionCheck

export DATABASE_URL=postgres://provee:provee@127.0.0.1:55500/provee_dev
npm run migrate    # aplica 001..011
npm run seed       # roles, 5 usuarios (@atemporal.cr), proyectos y proveedores de prueba
```

Connection string de Azurite (cuenta de desarrollo estándar, no es un secreto real):

```bash
export AZURITE_CONN='DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;'
```

> Reset rápido de datos: `docker rm -f provee-pg` y repetir el bloque. Las colas de
> Azurite se crean solas (`createIfNotExists`).

## 4. Credencial del portal (bootstrap del superadmin)

Los seeds crean usuarios pero **ninguna credencial de login** (en producción las emite el
superadmin desde el portal — huevo y gallina la primera vez). Bootstrap manual:

```bash
HASH=$(node --input-type=module -e "const {hashPassword} = await import('./apps/api/dist/portal/crypto.js'); console.log(await hashPassword('ClaveDemo-2026'));")
psql "$DATABASE_URL" -c "INSERT INTO user_credentials (user_id, password_hash, must_change_password)
  SELECT id, '$HASH', false FROM users WHERE email='gerencia@atemporal.cr'
  ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false;"
```

Login resultante: **gerencia@atemporal.cr / ClaveDemo-2026** (rol `superadmin`). Desde el
portal, ese usuario puede emitir credenciales para los demás
(`POST /api/portal/usuarios/:id/credenciales`).

## 5. Levantar los tres procesos (una terminal cada uno)

**api** (webhook + REST del portal + attachments):

```bash
cd apps/api
META_APP_SECRET=dev-secret META_VERIFY_TOKEN=dev-token \
DATABASE_URL=postgres://provee:provee@127.0.0.1:55500/provee_dev \
AZURE_STORAGE_QUEUE_CONNECTION="$AZURITE_CONN" \
PORT=8080 npm start
# (en dev, PORTAL_JWT_SECRET se genera efímero con un warning: las sesiones del portal
#  no sobreviven un reinicio del api — para que sobrevivan, exportá uno fijo)
```

**worker** (consumidor + agente + dispatcher de outbox + cron E1):

```bash
cd apps/worker
DATABASE_URL=postgres://provee:provee@127.0.0.1:55500/provee_dev \
AZURE_STORAGE_QUEUE_CONNECTION="$AZURITE_CONN" \
WORKER_OUTBOX_MODE=console npm start
```

- `WORKER_OUTBOX_MODE=console`: los "envíos de WhatsApp" se **imprimen en el log** y la
  fila queda `enviado` con `wamid_salida = console:<uuid>`. Nunca sale nada real.
- Sin `ANTHROPIC_API_KEY` el arranque dice `engine: "estructurado"`: los mensajes internos
  deben venir como `tool_call` JSON (ver §7). Con `ANTHROPIC_API_KEY=sk-ant-...` el
  arranque dice `engine: "claude"`: texto libre real ("ocupo 20 sacos de cemento para
  López") y el camino del proveedor con extractores.

**portal** (Centro de Control):

```bash
cd apps/portal
npm run dev          # Vite en http://localhost:5173 con proxy /api -> localhost:8080
```

## 6. Validación por portal (sin simular WhatsApp)

1. `http://localhost:5173` → login con la credencial del §4.
2. **Proveedores**: creá un proveedor, agregale un contacto y dale **Opt-in** (sin opt-in
   no puede recibir RFQs — guard real del dominio).
3. **Pedidos**: vacío al inicio; se llena con el §7.
4. **Revisiones**: la cola de revisión (se llena cuando una cotización escala E2).

## 7. Validación end-to-end simulando WhatsApp (validado)

El webhook exige la firma `X-Hub-Signature-256` (HMAC del cuerpo con `META_APP_SECRET`).
Guardá este helper como `scripts/dev/enviar-mensaje.sh` (o pegalo en la terminal):

```bash
#!/usr/bin/env bash
# uso: ./enviar-mensaje.sh <telefono-sin-+> '<texto del mensaje>'
set -euo pipefail
FROM="$1"; TEXTO="$2"; SECRET="${META_APP_SECRET:-dev-secret}"
BODY=$(node --input-type=module -e "
process.stdout.write(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '50600000000', phone_number_id: '111' }, messages: [{ id: 'wamid.DEV-' + Math.random().toString(36).slice(2), from: process.argv[1], timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: process.argv[2] } }] } }] }] }));
" "$FROM" "$TEXTO")
SIG=$(printf '%s' "$BODY" | node --input-type=module -e "
import { createHmac } from 'node:crypto';
const chunks=[]; for await (const c of process.stdin) chunks.push(c);
process.stdout.write('sha256=' + createHmac('sha256', process.argv[1]).update(Buffer.concat(chunks)).digest('hex'));
" "$SECRET")
curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:8080/webhook \
  -H 'Content-Type: application/json' -H "X-Hub-Signature-256: $SIG" --data-binary "$BODY"
```

Los teléfonos de los seeds (Meta manda sin `+`): `50688880001` gerencia/superadmin,
`50688880002` Proveeduría/admin_materiales, `50688880004` ingeniero, `50688880005`
bodeguero.

**Con `ANTHROPIC_API_KEY`** (engine `claude`) — texto libre:

```bash
./enviar-mensaje.sh 50688880004 'Ocupo 20 sacos de cemento gris para el proyecto López, urgente'
# el worker conversa: mirá su log; la respuesta sale por outbox 'console'
```

**Sin API key** (engine `estructurado`) — `tool_call` JSON como texto:

```bash
PROJECT_ID=$(psql "$DATABASE_URL" -t -A -c "SELECT id FROM projects WHERE activo LIMIT 1")
./enviar-mensaje.sh 50688880004 "{\"tool_call\":{\"name\":\"crear_pedido\",\"input\":{\"projectId\":\"$PROJECT_ID\",\"items\":[{\"descripcion\":\"Cemento gris 50kg\",\"cantidad\":20,\"unidad\":\"saco\"}],\"urgencia\":\"alta\"}}}"

PEDIDO_ID=$(psql "$DATABASE_URL" -t -A -c "SELECT id FROM pedidos ORDER BY created_at DESC LIMIT 1")
./enviar-mensaje.sh 50688880004 "{\"tool_call\":{\"name\":\"confirmar_pedido\",\"input\":{\"pedidoId\":\"$PEDIDO_ID\"}}}"
```

Qué verificar después de cada mensaje:

```bash
psql "$DATABASE_URL" -c "SELECT numero, estado FROM pedidos ORDER BY created_at DESC LIMIT 3"
psql "$DATABASE_URL" -c "SELECT template, texto IS NOT NULL AS es_texto, estado, wamid_salida FROM outbox_messages ORDER BY created_at DESC LIMIT 5"
psql "$DATABASE_URL" -c "SELECT phone, ventana_24h_expira_at > now() AS ventana FROM conversations"
psql "$DATABASE_URL" -c "SELECT accion, origen, at FROM audit_events ORDER BY at DESC LIMIT 8"
```

**Flujo completo hasta OC** (mixto portal + simulación): con el pedido en `borrador` y un
proveedor con contacto opt-in (§6), en el portal: detalle del pedido → **Enviar RFQs**
(estado `cotizando`; el RFQ sale por outbox console) → simulá la respuesta del proveedor
(con API key: `./enviar-mensaje.sh <tel-contacto-sin-+> 'Cemento 50kg a 7500 colones el
saco, entrega 24h, contado'`) → con todas las respuestas el pedido pasa a `en_revision` y
el comparativo se notifica → portal: **Adjudicar** por ítem → **Emitir OC(s)** → el PDF
queda en `attachment_blobs` y el envío `oc_emitida` sale por console con su
`attachment_id`. El cron E1 (corre solo, cada 60s) vence plazos: si preferís no esperar
respuestas, fijá `plazo_at` en el pasado con SQL y mirá la transición automática.

## 8. La validación canónica (la que corre todo)

Los tests de integración son la validación más completa del flujo (webhook→cola→worker→
tools→outbox, portal auth/acciones, triggers de DB):

```bash
CID=$(docker run -d --rm -e POSTGRES_PASSWORD=provee -e POSTGRES_USER=provee \
  -e POSTGRES_DB=provee_test -p 55432:5432 postgres:16)
export DATABASE_URL=postgres://provee:provee@127.0.0.1:55432/provee_test
timeout 90 bash -c 'until psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; do sleep 1; done'
npm run migrate && npm run seed
npm run test:all      # con DATABASE_URL con 'provee_test', TODAS las integraciones corren
docker stop "$CID"
```

> El gate corre solo si `DATABASE_URL` contiene `provee_test` — por eso la DB del §3 se
> llama `provee_dev` (los tests no la tocan).

## 9. Troubleshooting

| Síntoma | Causa / arreglo |
|---|---|
| Worker loguea `broker.error_poll` con "API version ... not supported by Azurite" | Falta `--skipApiVersionCheck` al arrancar Azurite (§3). El worker NO muere: reintenta cada ≥1s hasta que lo arregles. |
| Webhook responde 401 | Firma mal calculada: el HMAC es sobre los **bytes exactos** del body (usá `--data-binary` y `printf '%s'`, sin saltos de línea extra). |
| Webhook responde 500 y Meta/curl reintenta | Revisá el log del api: cola caída o DB caída. Es seguro reintentar (dedup por `wamid`). |
| El worker no procesa nada | ¿`AZURE_STORAGE_QUEUE_CONNECTION` idéntica en api y worker? ¿`WORKER_QUEUE_NAME`/`AZURE_STORAGE_QUEUE_NAME` coinciden (default `ingesta`)? La cola en memoria NO conecta procesos distintos. |
| Login 401 con credencial correcta | ¿Reiniciaste el api sin `PORTAL_JWT_SECRET` fijo? El secreto efímero invalida cookies viejas: volvé a loguear. 429 = rate limit (5 fallos/15min). |
| Mensaje interno de texto libre "no hace nada" (audit `worker_mensaje_sin_tool_call`) | Estás en engine `estructurado` (sin `ANTHROPIC_API_KEY`): usá `tool_call` JSON o exportá la key. |
| `docker: permission denied` | Tu usuario no está en el grupo `docker` (o usá `sudo`). |

## 10. Qué NO cubre el ambiente local

- Envío real por WhatsApp (`WORKER_OUTBOX_MODE=meta`) — requiere credenciales de Meta; ver
  `docs/GUIA_DEPLOYMENT_DEMO.md`.
- Recepción de facturas en adelante (B5–B8), dashboards por proyecto y control del agente
  en portal (olas 2–3) — aún no implementados (ver `docs/PLAN_FASE2A_2B_CONTROL_CENTER.md`
  §Progreso).
