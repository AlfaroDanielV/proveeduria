# Spec: Máquina de estados del pedido

Fuente: Propuesta v3 §4.2–§4.3. Esta spec es la fuente de verdad para `packages/core/state-machine`. Toda transición fuera de esta tabla es inválida y debe rechazarse tanto en código como por trigger en base de datos (defensa en profundidad). Toda transición ejecutada registra un `audit_event` con actor, canal y timestamp.

## Estados

| Estado | Significado | Quién lo activa |
|---|---|---|
| `borrador` | Pedido creado; cotizaciones aún no solicitadas | Ingeniero (confirmación del resumen extraído) |
| `cotizando` | RFQs enviadas a proveedores; esperando respuestas | Proveeduría (aprueba lista de proveedores) |
| `en_revision` | Cotizaciones recibidas o plazo vencido; pendiente decisión | Sistema (automático) |
| `aprobado` | Ganador(es) elegido(s); se emitirán OC(s) | Proveeduría |
| `ordenado` | OC(s) emitidas y enviadas a proveedores | Sistema (automático) |
| `recepcion_parcial` | Una o más facturas registradas; falta material | Bodeguero / Sistema |
| `recepcion_total` | Todo el material del pedido recibido y facturado | Sistema (automático) |
| `cerrado` | Revisado y cerrado formalmente; inmutable | Proveeduría |
| `cancelado` | Descartado antes de cerrarse (excepción) | Proveeduría / Gerencia |

## Transiciones válidas

```
borrador          → cotizando          (Proveeduría aprueba lista de proveedores y se envían RFQs)
cotizando         → en_revision        (Sistema: todas las cotizaciones recibidas O plazo vencido)
en_revision       → cotizando          (Proveeduría extiende plazo o invita más proveedores)
en_revision       → aprobado           (Proveeduría selecciona ganador único o división)
aprobado          → ordenado           (Sistema: todas las OCs generadas y enviadas — vía outbox)
ordenado          → recepcion_parcial  (Sistema: primera factura conciliada y recepción confirmada, quedando pendientes)
ordenado          → recepcion_total    (Sistema: recepción confirmada cubre todas las OCs del pedido)
recepcion_parcial → recepcion_parcial  (facturas adicionales que aún no completan)
recepcion_parcial → recepcion_total    (Sistema: última recepción cubre todas las OCs)
recepcion_total   → cerrado            (Proveeduría confirma cierre; agente lo sugiere, nunca cierra solo)
{borrador, cotizando, en_revision, aprobado} → cancelado   (Proveeduría o Gerencia, con motivo obligatorio)
```

## Reglas duras

1. `ordenado`+ no admite `cancelado`: con OCs emitidas, la cancelación es un flujo de excepción manual (Gerencia) que requiere anular las OCs primero y queda fuera del happy path del Módulo 1.
2. `cerrado` es terminal e inmutable: ninguna tool puede escribir sobre un pedido cerrado. Correcciones post-cierre = nota de crédito sobre la factura (que reabre revisión de Proveeduría) o registro nuevo, nunca edición.
3. `recepcion_total` requiere: todas las `po_items` cubiertas por `invoice_items` conciliados **y** confirmación de cantidades por el bodeguero. Las NC no bloquean este estado; bloquean el cierre si están pendientes de asociar.
4. Sugerencia de cierre: cuando el pedido llega a `recepcion_total` y no hay NC pendientes ni ítems en `review_queue`, el sistema notifica a Proveeduría sugiriendo cierre.
5. Transición inválida solicitada por el agente LLM → error de tool, se informa al usuario, se registra en auditoría. Nunca se "fuerza".
6. Cada transición se ejecuta en una transacción que incluye: cambio de estado + `audit_event` + mensajes `outbox` derivados.

## Ciclo paralelo: equipos de alquiler (§4.4)

Los alquileres NO usan la máquina de estados del pedido. Ciclo propio:

| Estado | Regla |
|---|---|
| `activo` | Alta por boleta/factura de alquiler; `cantidad_activa > 0` |
| `cerrado` | `cantidad_activa == 0` tras devoluciones (Sistema, automático) |

- Devoluciones parciales descuentan de `cantidad_activa`; nunca puede quedar negativa (rechazar y escalar).
- Cada movimiento (entrada/devolución) referencia la boleta origen y genera `audit_event`.
