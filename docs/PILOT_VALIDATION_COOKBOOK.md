# Cookbook — Validación del piloto (5 personas, 1 proveedor)

Runbook para poner el sistema a prueba con usuarios reales **esta semana**, sin
sorpresas ni promesas que el código no puede cumplir hoy. Es específico de la etapa
actual (Fase 2a cerrada, sistema nuevo aún no desplegado). Para el checklist de
**go-live de producción** (Meta business verification, IaC de Azure, Key Vault, etc.)
usá `docs/DEPLOYMENT_COOKBOOK.md` — este documento **no** lo reemplaza, lo antecede.

> Última verificación del estado: auditoría multi-agente sobre el código real
> (deployment, portal/API, runtime WhatsApp, base de datos, seguridad), con pase
> adversarial. Veredicto: **el "demo navegable" nuevo NO está listo para un piloto
> por internet, y menos con un proveedor externo.** Detalle abajo.

---

## 0. TL;DR — leé esto antes de prometerle algo a alguien

1. **Lo único vivo hoy en internet es el prototipo LEGADO** (`server.js` + `dashboard/`
   sobre Supabase). El Azure Web App `proveeduria-webhook` corre `node server.js`
   (`package.json:12`); el Static Web App sirve `dashboard/`. **Nada** del sistema
   nuevo (`apps/api`, `apps/portal`, `apps/worker`) está desplegado.
2. **El sistema nuevo ni siquiera está commiteado.** `apps/api/src/portal/`,
   `apps/portal/`, `apps/worker/src/outbox/` y `packages/agent/src/agent/` son
   archivos *untracked* en git (`git status` los marca `??`). CI en `main` no los
   testea siquiera.
3. **El prototipo legado no tiene NINGÚN flujo de proveedor.** Es 100% interno
   (registrar compras, escanear facturas, pagos a contratistas). El flujo
   RFQ→cotización→comparativo solo existe en el sistema nuevo, sin cablear.
4. **Conclusión honesta: hoy no hay experiencia de proveedor funcionando en ningún
   sistema.** Un proveedor no puede "usar el bot" tal cual.
5. **Base de datos: quedate en Supabase** para el piloto (proyecto **nuevo y vacío**,
   no el legado). Azure Postgres es para go-live. Ver §4.

**Qué SÍ podés hacer esta semana** (elegí uno o combiná):

- **Path A** — Piloto del flujo **interno** sobre el legado ya desplegado, con
  endurecimiento previo. Sin proveedor automático. (§2)
- **Path B** — Portal nuevo como **visor interno de solo-lectura** en LAN/VPN, con
  pedidos de demo sembrados. Sin proveedor, sin WhatsApp. (§3)
- **Proveedor** — Simulación manual ("Wizard of Oz"): vos le escribís por WhatsApp,
  cargás su cotización con las tools/script y mostrás el comparativo en el portal.
  (§2.6)

---

## 1. Mapa: qué está vivo vs qué no

| Pieza | ¿Desplegada? | ¿Alcanzable por internet? | Base de datos | Notas |
|---|---|---|---|---|
| `server.js` (webhook legado) | ✅ Azure Web App | ✅ (número de prueba WhatsApp) | Supabase (service key) | Loop Claude real, envíos reales, voz Whisper, Vision. **Solo interno.** |
| `dashboard/` (React legado) | ✅ Azure Static Web App | ✅ | Supabase (anon RLS) | Solo lectura; RLS `using(true)` + JWT sin verificar. **No compartir con proveedor.** |
| `apps/api` (portal REST nuevo) | ❌ | ❌ | — (solo Postgres efímero de CI) | Auth = header `X-User-Id` sin firma, CORS `*`. |
| `apps/portal` (visor nuevo) | ❌ | ❌ (localhost:8080) | — | Estático; UUIDs hardcodeados en el cliente. |
| `apps/worker` (motor de dominio) | ❌ | ❌ | — | El proceso que arranca es el stub `echo`, no el motor. |
| Migraciones `001-005` | ❌ (solo CI efímero) | — | Ninguna DB persistente | Esquema nuevo autocontenido, no choca con el legado. |

---

## 2. Path A — Piloto del flujo interno sobre el legado (recomendado para esta semana)

Es el **único stack que envía y recibe WhatsApp end-to-end hoy**. Sirve para validar la
experiencia interna (registrar materiales por texto/voz/foto, resumen diario, dashboards)
con los usuarios internos. **No** incluye flujo de proveedor.

### 2.1 Pre-requisitos (número de prueba de Meta)

- [ ] El número de prueba de Meta acepta hasta **5 destinatarios en allowlist**. Cargá
      los teléfonos de los participantes en *Meta for Developers → WhatsApp → API Setup →
      "To"*. Un número que no esté en la allowlist ni recibe ni puede enviar.
- [ ] Variables de entorno en el App Service (Configuration → Application settings):
      `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `META_PHONE_NUMBER_ID`,
      `META_ACCESS_TOKEN`, `META_VERIFY_TOKEN`, `OPENAI_API_KEY` (voz),
      `DASHBOARD_JWT_SECRET`, `DASHBOARD_BASE_URL`.
- [ ] El token de Meta debe ser **System User token permanente** (no el temporal de 24h,
      que hará que los envíos empiecen a fallar en silencio — los envíos son
      fire-and-forget, `server.js:1291`).
- [ ] Los usuarios internos existen en la tabla `usuarios` de Supabase con su `telefono`
      exacto (formato como Meta lo envía, ver `server.js:426`) y su `rol`.

### 2.2 Endurecimiento OBLIGATORIO antes de que un proveedor (o cualquier externo) toque el número

Estos huecos son reales **dentro del piloto**, no solo en go-live, porque el proveedor
sería uno de los 5 números allowlisted y hoy pegaría contra el asistente interno:

- [ ] **Gate de remitente desconocido** en `askClaude` (`server.js:978`): buscar el
      teléfono en `usuarios`; si no existe, responder un mensaje genérico y **no** correr
      el loop de tools. (Hoy corre el agente completo para cualquier número.)
- [ ] **Cerrar las tools de lectura/escritura de materiales** metiéndolas en `TOOL_ROLES`
      (`server.js:391`): `consultar_inventario`, `listar_proyectos`, `registrar_movimiento`,
      `corregir_movimiento`, `registrar_factura_escaneada`, `confirmar_factura`. Hoy están
      **sin gate**, así que un remitente no-empleado podría leer el gasto de todos los
      proyectos e incluso registrar compras.
- [ ] **Verificación de firma HMAC** en el `POST /webhook` legado. La implementación
      correcta (constant-time sobre el cuerpo crudo) ya existe en
      `apps/api/src/webhook/verify.ts` — portala y rechazá con 401 antes de procesar. Hoy
      el legado no verifica nada (`server.js:1415`).
- [ ] **No compartir ningún link de dashboard** con el proveedor ni con nadie fuera de
      finanzas: `dashboard_rls.sql` abre todo con `anon using(true)` y `jwt.js` no verifica
      la firma, así que el alcance por proyecto es cosmético.

> Estos cambios tocan `server.js`, que el `CLAUDE.md` marca como referencia. Es aceptable
> como **endurecimiento de seguridad del prototipo en producción** (no es una feature
> nueva de Módulo 1). Confirmá el alcance antes de ejecutarlos.

### 2.3 Smoke tests de validación (hacelos vos antes de invitar a nadie)

Desde un número allowlisted:

- [ ] **Handshake:** `GET https://<webapp>/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123`
      devuelve `123`.
- [ ] **Texto:** "¿qué proyectos hay?" → lista de proyectos.
- [ ] **Registro con confirmación:** "compré 10 bolsas de cemento en el Lagar para
      Residencial López" → el bot pide confirmación → confirmás → aparece en
      `consultar_inventario`.
- [ ] **Foto de factura:** enviar foto → extrae ítems → confirmás → se crean movimientos.
- [ ] **Nota de voz:** dictar una compra → transcribe (Whisper) → mismo flujo.
- [ ] **Gate de rol:** desde un teléfono con rol bajo, intentar `registrar_pago_contratista`
      → debe responder que requiere permisos.
- [ ] **Gate de remitente** (tras 2.2): desde un número no registrado en `usuarios` →
      mensaje genérico, sin ejecutar tools.
- [ ] **Resumen diario:** `GET https://<webapp>/test-summary` dispara el resumen a los
      usuarios con `recibe_resumen_diario=true`.

### 2.4 Go / No-Go

- [ ] Los 8 smoke tests de 2.3 pasan.
- [ ] Los 4 ítems de endurecimiento (2.2) están hechos **si** un externo va a escribir.
- [ ] Token de Meta permanente confirmado.
- [ ] Alguien de guardia mira los logs del App Service durante las primeras horas.

### 2.5 Operación durante el piloto (limitaciones a vigilar)

- **Estado en memoria** (`server.js:956`): un reinicio/redeploy del App Service borra las
  conversaciones a medias. **No hagas deploys mientras haya gente conversando.**
- **Envíos fire-and-forget** (`server.js:1291`): un fallo de envío se pierde en silencio.
  Confirmá en los logs que cada respuesta salió.
- **Cron duplicable** (`server.js:1372`): si el App Service escala a >1 instancia, el
  resumen diario se manda duplicado. Mantené 1 instancia durante el piloto.
- **Solo procesa `messages[0]`** (`server.js:1429`): si alguien manda ráfagas, se ignoran
  mensajes; pediles un mensaje a la vez.

### 2.6 El proveedor: simulación manual ("Wizard of Oz")

Como no hay flujo de proveedor automatizado, para demostrar el ciclo completo:

1. Vos (Proveeduría) le escribís al proveedor por WhatsApp normal pidiendo la cotización.
2. El proveedor responde por WhatsApp/foto como lo haría en la vida real.
3. Vos cargás esa cotización en el **sistema nuevo** (Path B) con un script que llame a
   las tools (`registrarCotizacion`) o insertando en la DB de demo.
4. Mostrás el **comparativo** generado en el portal (Path B) a los internos.

Así el proveedor "participa" de forma realista sin necesitar login ni un runtime que no
existe todavía, y los 5 ven el resultado.

---

## 3. Path B — Portal nuevo como visor interno de solo-lectura (opcional)

Sirve para enseñarle a los stakeholders internos **hacia dónde va el producto** (pedidos,
detalle, comparativo). Es **solo lectura**, **sin WhatsApp**, **sin proveedor**, y **nunca**
debe exponerse a internet abierto mientras la auth siga siendo el seam `X-User-Id`.

### 3.1 Commit del código nuevo (paso 0 ineludible)

El portal nuevo es *untracked*. Antes de cualquier despliegue:

```bash
git add apps/api/src/portal apps/portal apps/worker/src/outbox packages/agent/src/agent \
        docs/specs/portal-api.md docs/handoff/FASE2A-next-session-prompt.md
# revisá también los archivos modificados (git status) y commiteá de forma coherente
git commit -m "Fase 2a: portal navegable, outbox dispatcher, agent seam"
```

### 3.2 Base de datos (Supabase fresco)

Ver §4 para el detalle y el porqué. Resumen:

```bash
# 1) Crear un proyecto Supabase NUEVO Y VACÍO (no el legado).
# 2) Connection string DIRECTA (puerto 5432, no el pooler 6543) + ?sslmode=require
export DATABASE_URL='postgres://postgres:<pass>@db.<ref>.supabase.co:5432/postgres?sslmode=require'
npm run migrate:status        # confirmá 001-005 pendientes
npm run migrate               # aplica 001-005
npm run seed                  # roles, 5 usuarios, 2 proyectos, 2 proveedores, config
```

### 3.3 Sembrar pedidos de demo (si no, el portal sale vacío)

El seed base **no crea ningún pedido** (`seeds/001_base.sql` es solo maestros). Sin datos,
el portal muestra una lista vacía. Poblá 2-3 pedidos corriendo el flujo de tools:
`crearPedido → confirmarPedido → sugerirProveedores → enviarRfq → registrarCotizacion (x2)
→ (auto) generarComparativo`. La forma más rápida es un script Node que use el runtime de
`@proveeduria/agent` contra el `DATABASE_URL` de demo (mismo patrón que
`packages/agent/src/tools/pedido.integration.test.ts`).

> **Pendiente sugerido:** agregar un `seeds/002_demo_pedidos.sql` o un script
> `scripts/seed-demo.mjs` para que esto sea un comando. Hoy no existe.

### 3.4 Levantar API + portal (interno, con auth de perímetro)

- [ ] `apps/api`: `npm run build -w @proveeduria/api && node apps/api/dist/index.js`.
      Config (`apps/api/src/config.ts`) exige `META_APP_SECRET`, `META_VERIFY_TOKEN`,
      `DATABASE_URL` **aunque el portal no use Meta** → poné valores dummy para Meta y el
      `DATABASE_URL` de demo. En `NODE_ENV=production` además exige cola: usá
      `ALLOW_INMEMORY_QUEUE=true` para el visor de solo-lectura.
- [ ] `apps/portal`: fijá el `DEFAULT_API` real en `apps/portal/src/app.js:8` (hoy apunta a
      `http://localhost:8080`) antes de `npm run build -w @proveeduria/portal`, o precargá
      `localStorage['provee.apiBase']`.
- [ ] **Perímetro:** ponelo detrás de HTTPS con **basic-auth / secreto compartido** o solo
      en **LAN/VPN**. `apps/api` sirve `node:http` plano (sin TLS) y el CORS es `*`
      (`apps/api/src/portal/routes.ts:9`), así que **no** lo expongas directo a internet.
- [ ] Fijá CORS al único origen del portal si vas a usar un reverse proxy.

### 3.5 Smoke tests portal

- [ ] `GET /api/portal/me` con `X-User-Id: 20000000-0000-4000-8000-000000000002`
      (Proveeduría) responde el usuario y su alcance.
- [ ] La lista de pedidos muestra los pedidos sembrados en 3.3.
- [ ] Detalle y comparativo de un pedido en `en_revision` renderizan la matriz.
- [ ] Un `X-User-Id` de ingeniero (`...0004`) solo ve el proyecto López (alcance por
      `user_roles.project_id`).

### 3.6 Límites explícitos de Path B

- Solo lectura: no se crea nada desde la UI (la API rechaza todo lo que no sea GET).
- Sin auth real: cualquier UUID válido = acceso total de ese usuario. **Nunca** en internet
  abierto. Los UUIDs válidos van en el cliente (`apps/portal/src/app.js:1-6`).
- El proveedor **no entra** acá (los proveedores no son `users`).

---

## 4. Base de datos — ¿Supabase o Azure? (respuesta a la pregunta directa)

**Para el piloto: quedate en Supabase.** No migres a Azure todavía.

**Por qué:**

- Supabase **es** Postgres administrado. Las migraciones nuevas (`packages/db/migrations`)
  se aplican igual vía `DATABASE_URL` — no hay que "migrar a Azure" para usar el esquema
  nuevo.
- El esquema nuevo es **autocontenido** (tablas en inglés: `users`, `projects`, `pedidos`,
  `suppliers`, `audit_events`…) y **no choca** con el esquema legado (tablas en español:
  `usuarios`, `proyectos`, `facturas`, `contratistas`…). Cero colisión de nombres.
- Ya lo conocés, tiene TLS válido y tier gratis/bajo. Azure Postgres es **más setup del que
  un piloto necesita**.

**Cuándo sí Azure** (go-live, ver `DEPLOYMENT_COOKBOOK.md §2.2`): cuando `apps/api` y
`apps/worker` corran en **Azure Container Apps**. Ahí *Azure Database for PostgreSQL
Flexible Server* co-localizado reduce latencia, permite VNet/red privada y consolida
billing. Para el piloto es sobre-ingeniería.

### 4.1 "Aplicar los cambios más recientes" a Supabase — pasos concretos

> ⚠️ **Usá un proyecto Supabase NUEVO y VACÍO, no el del prototipo legado.** Las
> migraciones `001` y `004` corren un `DO block` que le adjunta el trigger `set_updated_at`
> a **toda** tabla `public` con columna `updated_at`. Si lo corrés sobre la DB legada,
> contamina `usuarios`/`proyectos`/`contratistas`/`facturas` con doble trigger. No es
> destructivo, pero muta el prototipo que está **vivo** ahora mismo.

1. Crear un proyecto Supabase nuevo y vacío.
2. Tomar la connection string **DIRECTA / session-mode** (puerto **5432**, no el pooler
   `6543`) y agregarle `?sslmode=require`. Ni `migrate.mjs` (`scripts/migrate.mjs:35`) ni
   el `Pool` de `apps/api` (`apps/api/src/index.ts:162`) setean SSL — depende de que la URL
   lo traiga.
3. `DATABASE_URL='...:5432/postgres?sslmode=require' npm run migrate:status` → confirmar que
   `001`–`005` están pendientes.
4. `npm run migrate` → aplica las 5 (cada una en su transacción, registradas en
   `schema_migrations`).
5. `npm run seed` → carga roles, 5 usuarios, 2 proyectos, 2 proveedores, config.
6. Sembrar pedidos de demo (§3.3) para tener contenido navegable.
7. Reemplazar teléfonos placeholder por los reales del piloto:
   `UPDATE users SET telefono_whatsapp='+506…' WHERE id='…'` y, si vas a enviar RFQ real,
   `supplier_contacts` con `optin_at`. Los seeds traen `+50688880001..5` (usuarios) y
   `+50688881001/1002` (proveedores) — todos placeholder.

---

## 5. Anti-checklist — qué NO hacer

- ❌ **No** le digas a nadie que "el demo navegable nuevo ya está listo/en línea": no está
  desplegado ni commiteado.
- ❌ **No** expongas `apps/api`/`apps/portal` a internet abierto con el seam `X-User-Id` +
  CORS `*`: cualquiera se hace pasar por cualquier usuario.
- ❌ **No** apliques las migraciones nuevas sobre la **Supabase legada** (contamina el
  prototipo vivo con triggers).
- ❌ **No** le compartas un **link de dashboard** al proveedor (RLS anon `using(true)` +
  JWT sin verificar = fuga de todos los proyectos).
- ❌ **No** le prometas al proveedor un **login de portal** ni un bot que lo atienda: no
  existe en ningún sistema hoy.
- ❌ **No** hagas **redeploys** del legado mientras haya conversaciones activas (estado en
  memoria se pierde).
- ❌ **No** uses el **pooler 6543** de Supabase para correr migraciones (usá 5432 directo).

---

## 6. Camino a un piloto "de verdad" con proveedor (Path C — fuera de alcance de esta semana)

Para que el **sistema nuevo** atienda a un proveedor por WhatsApp end-to-end hay que cablear
en `main()` del worker (hoy solo existen como librería probada por tests):

1. Consumidor de **broker durable** (reemplazar `InMemoryConsumer`) + pool Postgres +
   `crearDomainHandler` + `crearStructuredToolEngine` + loop `despacharOutbox`.
2. **`OutboxSender` concreto** que haga POST a la WhatsApp Cloud API (hoy es solo interfaz;
   no hay ninguna implementación ni llamada a `graph.facebook.com` en el stack nuevo).
3. **Adaptador de Claude** (`ModeloToolUse`) — hay que agregar `@anthropic-ai/sdk` como
   dependencia (hoy no está en ningún `package.json` del stack nuevo) — más **extractores**
   de texto/voz/foto hacia inputs de tools.
4. **Levantar la restricción de proveedores** en `apps/worker/src/domain/handler.ts` (hoy
   solo crea `Ctx` para internos; un `tool_call` de proveedor devuelve `rol_insuficiente`).
5. **Auth de sesión real** que reemplace el seam `X-User-Id`, y **workflows de deploy** para
   `api`/`worker`/`portal` con Postgres persistente.

Estimado: **3–6 semanas**. Es un epic de ingeniería; no lo comprimas para la fecha del
piloto. Cuando llegues acá, seguí `docs/DEPLOYMENT_COOKBOOK.md` para el go-live.

---

## Apéndice — Referencias de evidencia (archivo:línea)

- Legado desplegado: `package.json:12` (`start: node server.js`),
  `main_proveeduria-webhook.yml:64` (`package: .`), `dashboard_static_web_app.yml:34`.
- Sin deploy del stack nuevo: solo `ci.yml` (build/test) + los 2 workflows legados.
- Código nuevo untracked: `git status` → `?? apps/api/src/portal/`, `?? apps/portal/`,
  `?? apps/worker/src/outbox/`, `?? packages/agent/src/agent/`.
- Auth portal: `apps/api/src/portal/auth.ts:11-17`, CORS `apps/api/src/portal/routes.ts:9-14`,
  UUIDs en cliente `apps/portal/src/app.js:1-6`.
- Runtime WhatsApp nuevo sin cablear: `apps/worker/src/index.ts:35-36,68` (echo +
  InMemoryConsumer), `apps/worker/src/outbox/dispatcher.ts:13` (`OutboxSender` interfaz).
- Legado sin firma / sin gate de remitente: `server.js:1415` (POST sin HMAC),
  `server.js:978` (askClaude sin gate), `server.js:391` (TOOL_ROLES parcial).
- DB: `packages/db/scripts/migrate.mjs:35` (sin SSL), `seeds/001_base.sql` (placeholders,
  sin pedidos), migraciones `001`/`004` (DO block del trigger `set_updated_at`).
