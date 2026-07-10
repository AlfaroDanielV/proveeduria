# Portal API

Contrato REST para el portal interno de Fase 2a. El portal no lee Postgres directo:
consume estos endpoints de `apps/api`, que usan SQL parametrizado y el rol de la API.

## Autenticacion y alcance

- Todas las rutas bajo `/api/portal/*` requieren `X-User-Id` con un `users.id` activo.
- Fase 2a usa este header como seam navegable de autenticacion interna; sesiones/cookies quedan para la siguiente fase antes de produccion.
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
    "email": "proveeduria@proyekta.cr",
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
