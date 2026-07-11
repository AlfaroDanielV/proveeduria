# Spec: Centro de Control (portal interno)

Contrato del portal web interno para el personal de la constructora (Atemporal): busqueda y
vistas por proyecto, CRUD de proveedores, aprobaciones/rechazos, cola de revision y
monitoreo/control del agente. Extiende `portal-api.md` (que sigue siendo el contrato REST
endpoint-por-endpoint); esta spec fija autenticacion, permisos por accion, semantica de las
acciones y las pantallas por olas. Framework: **React + Vite** en `apps/portal` (decision
D1 del plan; la SPA estatica anterior se migra), consumiendo SOLO `/api/portal/*` — nunca
Postgres/Supabase directo.

## Principios (no negociables)

1. **Toda mutacion ejecuta una tool de `@proveeduria/agent`** (o un servicio del mismo
   runtime) dentro de `withTx`: dominio + `audit_events` + `approval_events`/`outbox` en la
   misma transaccion, con `Ctx.origen = 'web'` y canal de aprobacion `web`. El portal store
   NO escribe SQL de dominio crudo.
2. **Mismo lock que WhatsApp**: toda mutacion sobre un pedido toma
   `pg_advisory_xact_lock(hashtext('pedido:' || id))` — una aprobacion web y una transicion
   por WhatsApp sobre el mismo pedido no pueden carrear (E12 dobles).
3. **Permisos en servidor**: el rol se resuelve del token verificado, jamas del cliente; la
   matriz de abajo se aplica por endpoint. El browser nunca ve claves ni datos fuera del
   alcance del rol.
4. **Auditoria**: toda mutacion originada en el portal registra `audit_events` con
   `actor_user_id` y `origen='web'` (las acciones portal-only tambien — es convencion de
   aplicacion, la DB no lo fuerza).

## Autenticacion (reemplaza el seam `X-User-Id`)

- **Credenciales**: tabla `user_credentials` (migracion 006): `password_hash` con **scrypt
  nativo de Node** (`crypto.scrypt`, salt por usuario, formato versionado
  `scrypt$N$r$p$<salt-b64>$<hash-b64>`, comparacion en tiempo constante). Sin dependencia
  nueva de hashing. `must_change_password` fuerza cambio en primer login.
- **Sesiones**: access token **JWT HS256 firmado y verificado en servidor** (secreto
  `PORTAL_JWT_SECRET`, Key Vault en Azure), vida 15 min, claims `sub` (user id), `exp`,
  `iat`; roles y alcance se releen de DB en cada request (no se confia en claims para
  autorizar). Refresh token opaco (256 bits) en `portal_sessions` (hash sha256, vida 7
  dias, **rotacion en cada refresh**, revocable).
- **Transporte**: ambos tokens en cookies `httpOnly; Secure; SameSite=Strict;
  Path=/api/portal`. CSRF: SameSite=Strict + toda mutacion exige el header
  `X-Portal-CSRF: 1` (no simple request; el preflight CORS lo protege). CORS pasa de `*` a
  origen explicito (`PORTAL_ORIGIN`) con `credentials`.
- **Endpoints**: `POST /api/portal/auth/login` (email o telefono + password),
  `POST /api/portal/auth/refresh`, `POST /api/portal/auth/logout` (revoca la sesion),
  `POST /api/portal/auth/cambiar-password`. Alta/reset de credenciales: accion de
  superadmin (`POST /api/portal/usuarios/:id/credenciales`, genera password temporal con
  `must_change_password=true`). Login fallido: respuesta uniforme sin revelar si el usuario
  existe; rate limit basico por IP+identificador.
- **Migracion del seam**: `X-User-Id` se elimina al activarse esto; `leerUserId`
  (`apps/api/src/portal/auth.ts`) es el unico choke point a reemplazar. Los GET existentes
  no cambian de contrato, solo de autenticacion. **Ninguna ruta de mutacion puede existir
  antes de este bloque** (C1 del plan).

## Matriz de permisos por accion web

"Ver" respeta ademas el alcance por proyecto (`user_roles.project_id`) como hoy. Las
acciones que ejecutan tools usan los `TOOL_ROLES` de `@proveeduria/core` (fuente de
verdad); las portal-only se fijan aqui:

| Accion | Roles | Via |
|---|---|---|
| Ver pedidos/detalle/comparativo | todos los internos (con alcance) | GET existentes |
| Aprobar lista de proveedores (dispara RFQs) | admin_materiales, superadmin | tool `enviar_rfq` |
| Adjudicar ganador / emitir OC (ola 2) | admin_materiales, superadmin | tools B3/B4 |
| Ver proveedores | admin_materiales, admin_equipos, superadmin | GET nuevo |
| Crear/editar proveedor y contactos (opt-in/BAJA) | admin_materiales, superadmin | servicio portal-only + audit |
| Ver cola de revision | admin_materiales, superadmin | GET nuevo |
| Resolver entrada de cola de revision | admin_materiales, superadmin | servicio portal-only + audit |
| Ver bandeja/historial de aprobaciones | admin_materiales, superadmin | GET nuevo |
| Pausar/reanudar agente global | superadmin | `agent_control` (migracion 008) |
| Pausar/reanudar por telefono/pedido | admin_materiales, superadmin | `agent_control` |
| Ver conversaciones / outbox / auditoria | admin_materiales, superadmin | GET nuevos |
| Reintentar-ahora / cancelar mensaje de outbox | admin_materiales, superadmin | servicio portal-only + audit |
| Editar umbrales (`config`) | superadmin | servicio portal-only + audit (exceptions.md §3) |
| Generar link de dashboard 24h | admin_materiales, admin_equipos, superadmin | tool `generar_link_dashboard` (2b) |
| Export CSV | admin_materiales, superadmin | endpoint 2b |

Nota de negocio pendiente (plan §2): `confirmar_recepcion` excluye a superadmin a
proposito — el portal debe respetar la matriz de core, no inventar botones.

## Semantica de acciones portal-only (v1)

- **CRUD proveedores**: crear/editar `suppliers` (nombre, cedula, categorias, activo,
  notas) y `supplier_contacts` (nombre, telefono E.164 unico, `es_principal`). Registrar
  opt-in = fijar `optin_at` (consecuencia: el contacto puede recibir RFQs); BAJA = `optin_at
  = null` + audit. Desactivar proveedor no borra filas (sin deletes; historico intacto).
- **Resolver cola de revision** (v1, hasta que existan las tools 2b): marcar
  `estado='resuelta'` con `resuelta_por` + `resolucion` (texto obligatorio) + audit. La
  resolucion NO ejecuta efectos de dominio en v1; cuando existan los flujos 2b, cada `tipo`
  ganara su accion especifica (ej. `factura_sin_oc` → elegir OC y crear el link) y esta
  spec se actualizara ANTES de implementarla.
- **Outbox**: reintentar-ahora = `next_retry_at = now()` sobre `fallido`; cancelar =
  `descartado` con `error_ultimo='cancelado por <usuario>'` + audit. Solo sobre
  `pendiente|fallido` (nunca `enviado`).
- **Pausa del agente** (`agent_control`, llega con la migracion 008): filas
  `(alcance: global | telefono | pedido, referencia, pausado_por, motivo, pausado_at,
  reanudado_at)`. El worker consulta la pausa vigente ANTES de delegar al engine: mensaje
  entrante bajo pausa se persiste y notifica a Proveeduria, no ejecuta tools. El predicado
  es determinista (core/worker), jamas del LLM.

## Pantallas por olas (cada una detras de su API)

**Ola 1 — con el cierre de Fase 2a** (dominio ya existente):
login + shell con roles · pedidos (lista con filtros estado/proyecto/busqueda, detalle,
comparativo) · cola de revision (lista + resolver) · proveedores (CRUD + contactos +
opt-in/BAJA) · bandeja de aprobaciones (aprobar lista de proveedores → `enviar_rfq`;
historial de `approval_events` por pedido).

**Ola 2 — con la cadena 2b**: adjudicacion desde el comparativo (division por item) y
emision de OC · OCs/facturas/recepciones/NCs por pedido y proyecto · equipos de alquiler ·
dashboard por proyecto (presupuesto de referencia vs costo real, paridad visual con el
dashboard legado) · export CSV · links 24h · busqueda transversal.

**Ola 3 — control del agente**: pausa/reanudar (global/telefono/pedido) · visor de
conversaciones (requiere A4) con estado de entrega (statuses) · monitor de outbox
(pendientes/fallidos/descartados, reintentar/cancelar) · visor de auditoria · remitentes
desconocidos (E11) · edicion de umbrales.

## Verificacion minima por ola

Tests de rutas con fakes (patron existente de apps/api) para cada endpoint nuevo + un test
de integracion Postgres por flujo de mutacion (login→accion→audit) + test de concurrencia
web-vs-WhatsApp para las acciones sobre pedidos (dos transacciones simultaneas, una gana el
lock, cero E12 dobles). El portal React: tests de componentes para flujos de aprobacion y
formularios (no solo grep de strings).
