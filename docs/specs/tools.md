# Spec: Tools del agente

Contrato de cada herramienta expuesta al agente Claude. Reglas transversales:

- Toda tool valida **rol del solicitante** (resuelto por teléfono → `users`/`user_roles`) antes de ejecutar; el LLM nunca decide permisos.
- Toda tool corre en transacción con su `audit_event`; los envíos WhatsApp que dispare van al `outbox` en esa misma transacción.
- Errores de validación devuelven mensaje explicable al usuario; nunca stack traces.
- Inputs con schema JSON estricto (`additionalProperties: false`).
- El router decide el contexto: remitente interno (usuario) vs proveedor (`supplier_contacts`) vs desconocido (E11) — los proveedores solo activan el flujo de captura de cotización/confirmación de OC, jamás tools internas.
- El loop de agente solo puede ejecutar llamadas de tool con nombre whitelisted y input JSON estructurado. En Fase 2a se acepta un `tool_call` ya estructurado como harness determinístico; el texto libre y adjuntos deben pasar por extractor/Claude antes de llegar a la tool.

## Pedidos

### `crear_pedido`
- **Roles**: ingeniero, admin_materiales, superadmin.
- **Input**: project_id (resuelto por el agente contra proyectos activos; si ambiguo → E7), items[{descripcion, cantidad, unidad}], fecha_requerida?, urgencia?.
- **Efecto**: crea pedido en `borrador` con numeración PED + items; responde resumen para confirmación.
- **No hace**: enviar RFQs.

### `confirmar_pedido`
- **Roles**: el solicitante del pedido.
- **Efecto**: fija el resumen confirmado (`pedidos.confirmado_at`/`confirmado_por`, sin cambiar `estado=borrador`); notifica a Proveeduría que hay pedido nuevo por gestionar.

## Cotizaciones

### `sugerir_proveedores`
- **Roles**: admin_materiales, superadmin.
- **Input**: pedido_id.
- **Efecto**: solo lectura — ranking por categoría e historial (compras previas, tasa de respuesta; si aún no hay historial suficiente, esa señal queda neutra). Devuelve lista editable.

### `enviar_rfq`
- **Roles**: admin_materiales, superadmin. Registra `approval_events(lista_proveedores)`.
- **Input**: pedido_id, supplier_ids[], plazo_horas (default 24).
- **Efecto**: crea `quote_requests`, encola plantilla `rfq_solicitud` por proveedor, transición `borrador→cotizando`.
- **Guard**: pedido en `borrador`; todos los proveedores con contacto y opt-in.

### `registrar_cotizacion`
- **Contexto**: mensaje de proveedor (o reenvío manual de Proveeduría — E2/adopción).
- **Actor** (agente-conversacional.md §A6): el mensaje de proveedor se ejecuta como **actor sistema** (`actor_sistema=true`, sin roles, origen `wamid`) con el `quote_request_id` resuelto determinísticamente por remitente (contacto → proveedor → RFQ `enviada`); la tool acepta actor sistema SOLO por esa vía. La entrada con roles internos (`admin_materiales`, `superadmin`) queda para el reenvío manual.
- **Input**: quote_request_id (resuelto por remitente + pedido activo), fuente (texto/imagen/pdf/audio → extractor correspondiente), condiciones?, plazo_entrega?, confianza_extraccion, items[{pedido_item_id?, precio_unitario?, cantidad?, disponible?, notas?}]. La tool recibe el resultado estructurado del extractor/router; no hace OCR/LLM.
- **Efecto**: `quote_response` + `quote_items` con `confianza_extraccion`; si incompleta → E2 (repregunta por outbox, máx 2; al tercer fallo escala a `review_queue`). Cuando todas responden completas o vence plazo → `cotizando→en_revision` y se genera el comparativo.

### `generar_comparativo`
- **Roles**: admin_materiales, superadmin. "Gerencia" del PDF se modela como `superadmin` (ver `data-model.md` roles).
- **Input**: pedido_id.
- **Guard**: pedido `en_revision`; si el pedido sigue `cotizando`, primero deben completarse/vencerse las RFQs y ejecutarse la transición `cotizando→en_revision`.
- **Efecto**: SQL determinista (sin LLM): tabla ítem×proveedor calculada desde `pedido_items`, `quote_requests`, la última `quote_response` completa por proveedor y sus `quote_items`. Incluye precio, cantidad cotizada, disponibilidad, plazo, condiciones, subtotales y faltantes marcados (sin respuesta, sin ítem cotizado, precio/cantidad faltante, cantidad menor a la solicitada o `disponible=false`). Registra `audit_event(generar_comparativo)` y encola `notificacion_interna` por `outbox` con resumen compacto y payload de la tabla para WhatsApp/portal.
- **No hace**: adjudicar ganador, emitir OC ni persistir un snapshot editable. En Fase 2a el portal puede recalcular la misma vista. La evidencia inmutable de adjudicación quedó resuelta sin schema nuevo: `aprobar_ganador` guarda el snapshot del comparativo en `approval_events.detalle` (ver su contrato).

## Adjudicación y OC

### `aprobar_ganador`
- **Roles**: admin_materiales, superadmin. Registra `approval_events(ganador)`.
- **Input**: pedido_id, asignaciones[{supplier_id, pedido_item_ids[]}] — permite división entre proveedores.
- **Guard**: pedido `en_revision`; cada ítem asignado exactamente una vez (ni sin asignar ni duplicado); cada supplier asignado debe tener `quote_response` completa para los ítems que gana; el agente puede **recomendar** pero el input viene de decisión humana explícita.
- **Efecto**: `en_revision→aprobado`. **Evidencia**: `approval_events.detalle` guarda el snapshot jsonb del comparativo calculado en esa misma transacción (lo que "vio" el aprobador) + las asignaciones — sin tabla nueva (decisión D5 del plan).
- **Forma normativa de `detalle`** (la lee `emitir_oc`): `{ "asignaciones": [{ "supplierId", "pedidoItemIds": [], "quoteResponseId" }], "comparativo": <snapshot> }`. `quoteResponseId` es la última respuesta completa del proveedor asignado (la misma que usó el comparativo): fija de forma determinista los precios que `emitir_oc` copiará a `po_items`.

### `emitir_oc`
- **Roles**: admin_materiales, superadmin. Registra `approval_events(emision_oc)`.
- **Efecto**: genera OC(s) con numeración correlativa + PDF, encola envío al proveedor con la plantilla `oc_emitida` (que ya solicita confirmación de recepción y fecha — no existe plantilla `oc_confirmacion_solicitada`; el seguimiento es `oc_confirmacion_recordatorio` vía cron B11), `aprobado→ordenado` en la misma transacción (el envío real es asíncrono vía outbox). El ciclo de estados de la OC vive en `state-machine.md` §Ciclo de la OC.
- **PDF de la OC** (determinista; bytes en `attachment_blobs`, entrega por link firmado — `outbox-whatsapp.md` §Documentos adjuntos): encabezado Atemporal + número OC + fecha, proyecto, proveedor (nombre y cédula), tabla de ítems (descripción, cantidad, unidad, precio unitario, subtotal), total en CRC, condiciones y plazo de entrega de la cotización ganadora, y referencia al PED de origen.
- **Fuente de datos**: la última `approval_events(tipo='ganador')` del pedido — su `detalle.asignaciones` (decisión humana registrada) fija proveedores, ítems y `quoteResponseId`; los precios unitarios de `po_items` se copian de los `quote_items` de esa respuesta. Si no existe approval de ganador → error explicable (no se emite "de memoria").
- **Guard**: nunca auto-invocada por el agente sin instrucción humana en el turno.
- **Anular OC**: sin tool en Módulo 1 — flujo manual de Gerencia (pregunta abierta de negocio; se especifica antes de implementarse).

## Recepción

### `registrar_factura`
- **Roles**: bodeguero, admin_materiales, superadmin.
- **Input**: foto de factura (attachment).
- **Efecto**: extracción (Document Intelligence prebuilt-invoice; fallback Claude Vision) → `invoices` + `invoice_items` en `pendiente_revision`; cruce contra OCs abiertas del proyecto → propone `invoice_po_links`. Excepciones E3/E4/E9 según spec.

### `confirmar_recepcion`
- **Roles**: bodeguero (del proyecto), admin_materiales.
- **Input**: invoice_id, cantidades confirmadas por ítem.
- **Efecto**: `receipt_confirmations`; diferencias → E5; si concilia, actualiza estado de OC y del pedido (`recepcion_parcial|recepcion_total`). Registra `approval_events(recepcion)`.

### `asociar_nota_credito`
- **Roles**: admin_materiales, superadmin (proveedor puede enviarla; la aplicación es interna). Registra `approval_events(nc)` al aplicar (aprobación humana obligatoria, EXECUTION_PLAN §1.5 "aplicación de NC ambigua").
- **Efecto**: match a factura origen; único e inequívoco → `aplicada` y ajuste de costo real (vista); ambiguo → E6.

### `cerrar_pedido`
- **Roles**: admin_materiales, superadmin. Registra `approval_events(cierre)`.
- **Guard**: `recepcion_total`, sin NC pendientes ni `review_queue` abiertas del pedido.
- **Efecto**: `→cerrado`; notifica al ingeniero solicitante.

## Equipos de alquiler

### `registrar_equipo`
- **Roles**: bodeguero, admin_equipos, superadmin.
- **Input**: foto de boleta/factura de alquiler → extracción → `equipment_rentals` (nuevo o suma a activo existente) + `equipment_movements(entrada)`.

### `registrar_devolucion`
- **Roles**: bodeguero, admin_equipos, superadmin.
- **Efecto**: asocia a alquiler origen, `equipment_movements(devolucion)`, descuenta activo; guard E10; llega a 0 → cierra alquiler.

### `consultar_inventario_equipos`
- **Roles**: admin_equipos, gerencia, superadmin. Solo lectura por proyecto/proveedor/equipo.

## Consultas y utilidades

### `consultar_datos`
- **Roles**: todos los internos; el alcance de datos se filtra por rol (ingeniero: sus proyectos; gerencia/superadmin: todo).
- **Implementación**: SQL **parametrizado sobre vistas whitelisted** (`v_compras_por_proveedor`, `v_pedido_costo_real`, `v_ejecucion_presupuesto`, `v_inventario_equipos`, ...). Solo lectura; sin SQL libre generado por LLM contra tablas base.

### `generar_link_dashboard`
- **Roles**: admin_materiales, admin_equipos, gerencia, superadmin.
- **Efecto**: token en `dashboard_links` (24h, renovable), URL firmada del portal por proyecto. Paridad con el prototipo.

### `exportar_datos`
- **Roles**: admin_materiales, gerencia, superadmin.
- **Efecto**: CSV/Excel (facturas registradas, compras por periodo) a blob con SAS corto; enlace por WhatsApp.

### `registrar_retroalimentacion`
- **Roles**: todos los internos. Paridad con prototipo → tabla `feedback`.

## Acciones web del Centro de Control

Las acciones portal-only (CRUD de proveedores/contactos, resolver `review_queue`, pausa del
agente, reintentar/cancelar outbox, edición de umbrales) **no son tools del agente**: se
rigen por `control-center.md` (matriz de permisos y semántica) y `portal-api.md`
(endpoints). Las acciones web que sí mapean a tools (aprobar lista → `enviar_rfq`,
adjudicar → `aprobar_ganador`, emitir OC) ejecutan la tool con `Ctx.origen='web'` y canal
de aprobación `web` — mismo contrato, mismo lock por pedido.

## Paridad con el prototipo (server.js)

| Prototipo | Destino |
|---|---|
| `registrar_movimiento`, `consultar_inventario`, `corregir_movimiento` | Se rediseñan como `registrar_equipo`/`registrar_devolucion`/`consultar_inventario_equipos` (correcciones = movimiento compensatorio auditado, no edición) |
| `registrar_factura_escaneada`, `confirmar_factura` | `registrar_factura` + `confirmar_recepcion` |
| `listar_proyectos` | Se absorbe en resolución de contexto del router |
| `registrar_contratista/contrato/orden_cambio/pago_contratista`, `consultar_contratistas` | **Fuera del Módulo 1** (gestión de subcontratistas es módulo posterior, PDF §5); no migrar |
| `generar_link_dashboard`, `registrar_retroalimentacion` | Paridad directa |
