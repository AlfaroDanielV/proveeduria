# Portal API

Contrato REST para el portal interno de Fase 2a. El portal no lee Postgres directo:
consume estos endpoints de `apps/api`, que usan SQL parametrizado y el rol de la API.

## Autenticacion y alcance

- **Vigente (C1 implementado)**: login con password (scrypt) + JWT HS256 firmado/verificado
  en servidor en cookie httpOnly + refresh con rotacion (seccion §Autenticacion abajo). El
  seam historico `X-User-Id` fue ELIMINADO; toda ruta salvo `auth/login` y `auth/refresh`
  exige `portal_token` valido.
- `superadmin` y `admin_materiales` pueden leer pedidos de todos los proyectos.
- `ingeniero` y `bodeguero` solo pueden leer pedidos de sus `user_roles.project_id`.
- Usuarios sin alcance para pedidos reciben `403`; no se expone RLS anon ni claves de Supabase al navegador.

## Endpoints

### `GET /api/portal/me`

Devuelve el usuario autenticado y su alcance efectivo:

```json
{
  "user": {
    "userId": "uuid",
    "nombre": "Jose Pablo (Proveeduria)",
    "email": "proveeduria@atemporal.cr",
    "roles": ["admin_materiales"],
    "projectIds": []
  }
}
```

### `GET /api/portal/pedidos`

Query params:

- `estado`: opcional; uno de `borrador|cotizando|en_revision|aprobado|ordenado|recepcion_parcial|recepcion_total|cerrado|cancelado`.
- `projectId`: opcional; debe estar dentro del alcance del usuario salvo roles globales.
- `limit`: opcional, default `25`, max `100`.
- `offset`: opcional, default `0`.

Respuesta:

```json
{
  "items": [
    {
      "id": "uuid",
      "numero": "PED-2026-001",
      "estado": "en_revision",
      "proyecto": { "id": "uuid", "nombre": "Residencial Lopez", "codigo": "LOP" },
      "solicitante": { "userId": "uuid", "nombre": "Ingeniero de Obra" },
      "fechaRequerida": "2026-07-15",
      "urgencia": "alta",
      "plazoCotizacionAt": "2026-07-09T18:00:00.000Z",
      "itemsCount": 2,
      "rfqsTotal": 2,
      "rfqsRespondidas": 2,
      "revisionesPendientes": 0
    }
  ],
  "total": 1,
  "limit": 25,
  "offset": 0
}
```

### `GET /api/portal/pedidos/:pedidoId`

Devuelve detalle navegable del pedido: cabecera, items, solicitudes de cotizacion con la
ultima respuesta conocida por proveedor, y entradas pendientes de `review_queue`.

### `GET /api/portal/pedidos/:pedidoId/comparativo`

Devuelve la misma tabla deterministica que `generar_comparativo`: matriz item x proveedor
calculada desde `pedido_items`, `quote_requests`, la ultima `quote_response` completa por
proveedor y sus `quote_items`. No adjudica ganador, no emite OC y no persiste snapshot.

Respuesta resumida:

```json
{
  "pedido": { "id": "uuid", "numero": "PED-2026-001", "estado": "en_revision" },
  "resumenProveedores": [
    {
      "supplierId": "uuid",
      "nombre": "Rodex",
      "quoteRequestId": "uuid",
      "quoteRequestEstado": "respondida",
      "quoteResponseId": "uuid",
      "condiciones": "Contado",
      "plazoEntrega": "24h",
      "total": 125000,
      "itemsCotizados": 2,
      "itemsFaltantes": 0
    }
  ],
  "filas": []
}
```

---

## Autenticacion (C1, `control-center.md`)

Mutaciones (`POST`/`PUT`) exigen ademas el header `X-Portal-CSRF: 1` (defensa CSRF junto a
`SameSite=Strict`). Cookies: `portal_token` (JWT HS256, 15 min) y `portal_refresh` (opaco,
7 dias, rotado en cada refresh), ambas `httpOnly; Secure; SameSite=Strict; Path=/api/portal`.
Respuestas de fallo de login uniformes (401 sin revelar existencia del usuario).

### `POST /api/portal/auth/login`

Body: `{ "identificador": "email o telefono E.164", "password": "..." }`.
200: `{ "user": { ...igual que /me }, "mustChangePassword": false }` + Set-Cookie de ambas
cookies. Con `must_change_password` en true, el cliente debe forzar el cambio antes de
navegar. 401: credencial invalida, usuario inactivo o credencial inactiva (uniforme; se
compara contra un hash dummy cuando el usuario no existe para no filtrar existencia por
timing). 429 `{ "error": "demasiados_intentos" }`: rate limit por identificador (5
fallos/15 min) y por IP (20 fallos/15 min; primer hop de `X-Forwarded-For`); el login
exitoso limpia el contador del identificador. En memoria por proceso (instancia unica del
Modulo 1; migrar a contador compartido si api escala horizontal).

### `POST /api/portal/auth/refresh`

Sin body. Valida `portal_refresh` contra `portal_sessions` (hash, no revocada, no
expirada), **rota** el refresh (la sesion vieja queda revocada) y emite nuevo par de
cookies. 401 si invalido.

### `POST /api/portal/auth/logout`

Revoca la sesion del refresh actual y limpia ambas cookies. 204.

### `POST /api/portal/auth/cambiar-password`

Body: `{ "passwordActual": "...", "passwordNueva": "..." }` (autenticado; minimo 8
caracteres). Actualiza el hash, limpia `must_change_password` y revoca **todas** las
sesiones del usuario, incluida la del propio request: cambiar la password fuerza volver a
iniciar sesion en todos los dispositivos (deliberado; mas seguro que preservar la sesion
actual). 204.

### `POST /api/portal/usuarios/:userId/credenciales` — solo superadmin

Crea o resetea la credencial de un usuario interno con `must_change_password=true`.
Body opcional `{ "passwordTemporal": "..." }`; si no viene, el servidor genera una y la
devuelve UNA sola vez: `{ "passwordTemporal": "..." }`. Registra `audit_events`
(`credencial_emitida`, origen `web`).

## Proveedores (ola 1, `control-center.md` §CRUD)

Lectura: `admin_materiales`, `admin_equipos`, `superadmin`. Escritura: `admin_materiales`,
`superadmin`. Toda mutacion registra `audit_events` (origen `web`, `actor_user_id`) en la
misma transaccion. Sin deletes: desactivar preserva historico.

### `GET /api/portal/proveedores`

Query: `activo` (bool opcional), `q` (busqueda por nombre/cedula, opcional), `limit`
(default 25, max 100), `offset`. Respuesta:

```json
{
  "items": [
    {
      "id": "uuid", "nombre": "Rodex", "cedulaJuridica": "3-101-...",
      "categorias": ["cemento"], "activo": true, "notas": null,
      "contactos": [
        { "id": "uuid", "nombre": "Ana", "telefonoWhatsapp": "+506...",
          "esPrincipal": true, "optinAt": "2026-07-01T00:00:00.000Z" }
      ]
    }
  ],
  "total": 1, "limit": 25, "offset": 0
}
```

### `GET /api/portal/proveedores/:id` — detalle con contactos.

### `POST /api/portal/proveedores`

Body: `{ nombre, cedulaJuridica?, categorias?: string[], notas? }` → crea activo. Audit
`proveedor_creado`.

### `PUT /api/portal/proveedores/:id`

Body parcial: `{ nombre?, cedulaJuridica?, categorias?, notas?, activo? }`. Audit
`proveedor_actualizado` con `antes`/`despues`.

### `POST /api/portal/proveedores/:id/contactos`

Body: `{ nombre, telefonoWhatsapp (E.164, unico global), esPrincipal? }`. 409 si el
telefono ya existe. Audit `contacto_creado`. El opt-in NO se asume: se registra aparte.

### `PUT /api/portal/contactos/:contactoId` — `{ nombre?, esPrincipal? }`. Audit `contacto_actualizado`.

### `POST /api/portal/contactos/:contactoId/optin` y `POST .../baja`

Fijan `optin_at = now()` / `optin_at = null`. Audit `contacto_optin` / `contacto_baja`.
Un contacto sin opt-in no recibe RFQs (guard existente de `enviar_rfq`).

## Cola de revision (ola 1, semantica v1 en `control-center.md`)

Roles: `admin_materiales`, `superadmin`.

### `GET /api/portal/revisiones`

Query: `estado` (`pendiente|resuelta`, default `pendiente`), `tipo?`, `projectId?`,
`limit`/`offset`. Cada item: `{ id, tipo, entidad, entidadId, pedido: {id, numero} | null,
detalle, estado, createdAt, resueltaPor?, resolucion? }`.

### `POST /api/portal/revisiones/:id/resolver`

Body: `{ "resolucion": "texto obligatorio" }`. Marca `resuelta` + `resuelta_por` + audit
`revision_resuelta`. 409 si ya estaba resuelta. v1 NO ejecuta efectos de dominio
(control-center.md fija la semantica; las acciones especificas por tipo llegan con 2b).

## Aprobaciones y acciones de pedido (C2 — ejecutan tools del dominio)

Roles: `admin_materiales`, `superadmin`. Cada mutación ejecuta la tool correspondiente de
`@proveeduria/agent` dentro de `withTx` con `Ctx.origen='web'` (canal de aprobación `web`)
y toma ANTES `pg_advisory_xact_lock(hashtext('pedido:' || pedidoId))` — el mismo lock del
worker: una acción web y un mensaje de WhatsApp sobre el mismo pedido no pueden carrear.
Mapeo de errores de tool → HTTP: rol insuficiente `403`; validación de input `400`;
guard de estado/E12 y precondiciones de dominio (p. ej. "sin adjudicación registrada",
"proveedor sin opt-in") `409`; siempre `{ error, message }` explicable.

### `GET /api/portal/pedidos/:pedidoId/aprobaciones`

Historial de `approval_events` del pedido (más reciente primero): `{ items: [{ id, tipo,
aprobadoPor: { userId, nombre }, canal, detalle, at }] }`. El `detalle` del tipo `ganador`
incluye el snapshot del comparativo (evidencia D5).

### `POST /api/portal/pedidos/:pedidoId/rfqs`

Bandeja "aprobar lista de proveedores". Body: `{ "supplierIds": ["uuid"], "plazoHoras": 24 }`
→ ejecuta `enviar_rfq` (registra `approval_events(lista_proveedores)`, crea RFQs, encola
`rfq_solicitud`, `borrador→cotizando`). 200: `{ pedidoId, estado, rfqs: n }`.

### `POST /api/portal/pedidos/:pedidoId/adjudicacion`

Adjudicación desde el comparativo. Body: `{ "asignaciones": [{ "supplierId": "uuid",
"pedidoItemIds": ["uuid"] }] }` → ejecuta `aprobar_ganador` (snapshot D5 en
`approval_events.detalle`, `en_revision→aprobado`). 200: `{ pedidoId, estado }`.

### `POST /api/portal/pedidos/:pedidoId/ocs`

Emisión de OC(s). Sin body (la fuente es la adjudicación registrada) → ejecuta `emitir_oc`
(OCs + PDF + outbox `oc_emitida`, `aprobado→ordenado`). 200: `{ pedidoId, estado, ocs:
[{ ocId, numero, supplierId, montoTotal }] }`.
