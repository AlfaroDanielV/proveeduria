# Spec: Plantillas de WhatsApp

Texto candidato de las plantillas a someter a aprobación de Meta (Fase 1). Este archivo debe reflejar **exactamente** el texto aprobado — al aprobarse, actualizar aquí nombre, categoría, idioma (`es`) y variables. Fuera de la ventana de 24h solo se envía con estas plantillas; dentro de la ventana el agente conversa libre.

Reglas de redacción para pasar revisión de Meta y proteger el quality rating:
- Identificarse siempre ("Asistente de Proveeduría de Proyekta").
- Categoría `utility` (transaccionales); evitar lenguaje promocional.
- Variables `{{n}}` posicionales; sin variables al inicio/fin del cuerpo ni variables adyacentes.
- Proveedores nuevos reciben primero el aviso humano de José Pablo + `presentacion_proveedor` (opt-in registrado).

---

## `presentacion_proveedor` — utility
Onboarding de proveedor nuevo al canal.

> Hola {{1}}, le saluda el Asistente de Proveeduría de *Proyekta*. A partir de ahora, las solicitudes de cotización y órdenes de compra de Proyekta le llegarán por este número. Puede responder por aquí con texto, foto o audio. Si prefiere no recibir mensajes por este medio, responda BAJA.
- Variables: 1 = nombre del contacto.

## `rfq_solicitud` — utility
> Estimado {{1}}, le escribe el Asistente de Proveeduría de *Proyekta*. Solicitamos cotización para el proyecto {{2}}:
>
> {{3}}
>
> Por favor indicar precio unitario, disponibilidad, plazo de entrega y condiciones. Plazo para cotizar: {{4}}. Puede responder por este medio con texto, foto de la cotización o audio. Referencia: {{5}}.
- Variables: 1 contacto, 2 proyecto, 3 lista de ítems (multilínea), 4 fecha/hora límite, 5 número de pedido (PED-…).

## `rfq_recordatorio` — utility
> Estimado {{1}}, le recordamos que la solicitud de cotización {{2}} de Proyekta ({{3}}) vence {{4}}. Si ya la envió, omita este mensaje; si necesita más tiempo, indíquelo por este medio.
- Variables: 1 contacto, 2 referencia PED, 3 resumen corto, 4 vencimiento.

## `oc_emitida` — utility (con documento)
> Estimado {{1}}, adjuntamos la Orden de Compra {{2}} de *Proyekta* para el proyecto {{3}}, por un total de {{4}}. Por favor confirmar recepción y fecha estimada de entrega respondiendo a este mensaje.
- Variables: 1 contacto, 2 número OC, 3 proyecto, 4 monto. Header: documento PDF de la OC.

## `oc_confirmacion_recordatorio` — utility
> Estimado {{1}}, aún no registramos su confirmación de la Orden de Compra {{2}}. Por favor confirmar recepción y fecha de entrega respondiendo a este mensaje.
- Variables: 1 contacto, 2 número OC.

## `notificacion_interna` — utility
Aviso genérico a usuarios internos fuera de ventana (comparativo listo, factura en revisión, pedido atascado, sugerencia de cierre).

> {{1}}, hay novedades en Proveeduría: {{2}}. Responda a este mensaje para ver el detalle o continuar la gestión.
- Variables: 1 nombre, 2 resumen corto de la novedad.
- Nota: al responder, se abre la ventana de 24h y el agente entrega el detalle completo conversacionalmente.

## `resumen_diario` — utility
> {{1}}, resumen de Proveeduría de hoy: {{2}}. Responda para consultar cualquier punto.
- Variables: 1 nombre, 2 resumen (pendientes de revisión, cotizaciones vencidas, pedidos atascados).

---

## Mensajes de sesión (dentro de ventana, sin plantilla — referencia de tono)

- Confirmación de pedido: resumen numerado de ítems + proyecto + fecha requerida, cierra con "¿Confirmo el pedido?".
- Comparativo: tabla compacta por proveedor (total, plazo, faltantes) + enlace al portal para la vista completa.
- Repregunta a proveedor (E2): específica al campo faltante ("En su cotización no logramos identificar el precio de la varilla #4, ¿nos lo confirma?").
- Escalamientos: siempre dicen qué se necesita del humano y qué hará el sistema mientras tanto.
- BAJA de proveedor: confirmar, marcar `optin_at = null`, notificar a Proveeduría para gestionar por canal alterno.
