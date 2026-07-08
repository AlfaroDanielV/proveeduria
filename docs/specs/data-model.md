# Spec: Modelo de datos

Fuente de verdad para `packages/db`. Cardinalidades confirmadas en Propuesta v3 §4.3 paso 5: **pedido→OC es 1:N, OC→factura es 1:N**; una factura puede además cubrir parcialmente una OC. Factura→NC es 1:N.

Convenciones: snake_case, PK `id uuid default gen_random_uuid()`, timestamps `created_at/updated_at timestamptz`, montos `numeric(14,2)` en CRC salvo `moneda` indique USD, soft-delete prohibido en tablas de auditoría/documentos.

## Identidad y acceso

- `users` — id, nombre, telefono_whatsapp (unique, E.164), email, activo.
- `roles` — catálogo fijo: `superadmin`, `admin_materiales`, `admin_equipos`, `ingeniero`, `bodeguero` (§3.1).
- `user_roles` — user_id, role_id, opcional project_id (ingeniero/bodeguero pueden estar acotados a proyectos).
- `dashboard_links` — token hash, project_id, expires_at (24h renovable, §4.5), created_by.

## Maestros

- `projects` — nombre, codigo, presupuesto_referencia numeric (dato fijo de referencia, §5), activo.
- `suppliers` — nombre, cedula_juridica, categorias text[], activo, notas.
- `supplier_contacts` — supplier_id, nombre, telefono_whatsapp (unique), optin_at, es_principal.
- `materials_catalog` (fase 2, opcional) — descripcion normalizada, unidad, categoria.

## Flujo de pedido

- `pedidos` — numero (`PED-YYYY-NNN`, unique, secuencia transaccional por año), project_id, solicitante_user_id, estado (enum de state-machine.md), fecha_requerida, urgencia, confirmado_at/confirmado_por (confirmación del resumen; no transiciona estado), plazo_cotizacion_at, cerrado_por/cerrado_at, cancelado_motivo.
- `pedido_items` — pedido_id, descripcion, cantidad numeric, unidad, notas. Texto libre normalizado por el agente; sin FK a catálogo en Módulo 1.
- `quote_requests` — pedido_id, supplier_id, enviado_at (via outbox), plazo_at, estado: `enviada|respondida|vencida|declinada`.
- `quote_responses` — quote_request_id, recibido_at, fuente (`texto|imagen|pdf|audio`), attachment_id, condiciones, plazo_entrega, confianza_extraccion numeric(3,2), estado: `completa|incompleta|descartada`.
- `quote_items` — quote_response_id, pedido_item_id (nullable si el proveedor cotizó algo no pedido), precio_unitario, cantidad, disponible boolean, notas.

## Compra y recepción

- `purchase_orders` — numero (`OC-YYYY-NNN` unique), pedido_id, supplier_id, estado: `emitida|confirmada|recibida_parcial|recibida_total|anulada`, monto_total, confirmada_por_proveedor_at, pdf_attachment_id.
- `po_items` — po_id, pedido_item_id, cantidad, precio_unitario (de la cotización aprobada).
- `invoices` — numero_factura, supplier_id, project_id, fecha, monto_total, fuente attachment_id, confianza_extraccion, estado: `pendiente_revision|conciliada|disputada`, registrada_por (bodeguero).
- `invoice_items` — invoice_id, descripcion, cantidad, precio_unitario.
- `invoice_po_links` — invoice_id, po_id, N:M con montos asignados (una factura puede cubrir parcialmente una OC y una OC recibe varias facturas).
- `receipt_confirmations` — invoice_id, bodeguero_user_id, cantidades confirmadas por ítem (jsonb), diferencias_detectadas jsonb, confirmado_at.
- `credit_notes` — numero, invoice_id, monto, motivo, attachment_id, estado: `pendiente_asociacion|aplicada`, aplicada_por/aplicada_at.
- `credit_note_items` — opcional, detalle por ítem.

**Costo real del pedido** = Σ facturas conciliadas − Σ NC aplicadas (vista `v_pedido_costo_real`, nunca columna materializada editable).

## Equipos de alquiler (§4.4)

- `equipment_rentals` — project_id, supplier_id, descripcion_equipo, cantidad_inicial, cantidad_activa (check ≥ 0), boleta_attachment_id, estado: `activo|cerrado`, abierto_at/cerrado_at.
- `equipment_movements` — rental_id, tipo: `entrada|devolucion`, cantidad, boleta_attachment_id, registrado_por, at. `cantidad_activa` se recalcula en la misma transacción.

## Mensajería y operación

- `inbound_messages` — **wamid unique** (clave de idempotencia), from_phone, tipo, payload jsonb, attachment_id, received_at, processed_at, conversation_id.
- `outbox_messages` — destino, template|texto, payload, estado: `pendiente|enviado|fallido`, wamid_salida, intentos, next_retry_at. Insertado en la misma transacción que el efecto de dominio.
- `conversations` — phone, user_id|supplier_contact_id, contexto jsonb (reemplaza el Map en memoria de server.js:958), last_message_at, ventana_24h_expira_at.
- `attachments` — blob_path, content_type, sha256, origen (wamid), bytes. Blobs privados; acceso por SAS de corta vida.
- `review_queue` — tipo (`factura_sin_oc|diferencia_monto|nc_ambigua|cotizacion_incompleta|extraccion_baja_confianza|material_no_coincide`), referencia polimórfica (tabla+id), detalle jsonb, estado: `pendiente|resuelta`, resuelta_por/resolucion.
- `approval_events` — tipo (`lista_proveedores|ganador|emision_oc|recepcion|nc|cierre`), pedido_id, aprobado_por, canal (`whatsapp|web`), detalle jsonb, at.
- `audit_events` — **append-only** (sin UPDATE/DELETE por permisos + trigger): actor_user_id|system, accion, entidad, entidad_id, antes/despues jsonb, origen (wamid|web|cron), at. Índice por (entidad, entidad_id) y por pedido_id.
- `feedback` — paridad con `registrar_retroalimentacion` del prototipo: user_id, tipo (`error|sugerencia`), texto, contexto.

## Invariantes globales

1. Ninguna escritura de dominio fuera de una transacción que incluya su `audit_event`.
2. Ningún envío de WhatsApp fuera de `outbox_messages`.
3. Ninguna fila de `invoices` con `confianza_extraccion` bajo el umbral pasa a `conciliada` sin `receipt_confirmations` + revisión.
4. Numeración PED/OC: `SELECT ... FOR UPDATE` sobre tabla de secuencias por año; nunca max()+1.
5. RLS: el portal no accede a Postgres directo; solo la API con su rol. Sin políticas anon.
