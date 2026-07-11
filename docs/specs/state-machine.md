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
| `recepcion_parcial` | Una o más facturas registradas; falta material | Sistema (tras confirmación del bodeguero — la transición la ejecuta `ActorSistema` en la misma transacción que registra `approval_events(recepcion)`) |
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

## Ciclo de la Orden de Compra (OC)

Las OCs tienen máquina de estados propia (estados en `data-model.md`), implementada como
tabla de transiciones en `packages/core` (mismo patrón que `TRANSICIONES` del pedido) y
verificada por trigger de DB (migración 009) como segunda barrera.

```
emitida            → confirmada         (Proveedor confirma recepción de la OC; fija confirmada_por_proveedor_at)
emitida            → recibida_parcial   (Sistema: primera recepción conciliada — la confirmación del proveedor NO es prerequisito para recibir)
confirmada         → recibida_parcial   (Sistema: primera recepción que no cubre todos los po_items)
emitida            → recibida_total     (Sistema: la recepción cubre todos los po_items)
confirmada         → recibida_total     (Sistema)
recibida_parcial   → recibida_parcial   (recepciones adicionales que aún no completan)
recibida_parcial   → recibida_total     (Sistema: última recepción cubre todo)
emitida            → anulada            (flujo manual de Gerencia, con motivo; fuera del happy path del Módulo 1)
confirmada         → anulada            (ídem)
```

Reglas duras de la OC:

1. Una OC con al menos una recepción registrada **no es anulable** (corrección = NC).
2. `recibida_total` y `anulada` son terminales (los ajustes por NC no cambian el estado de
   la OC; afectan el costo real vía vista).
3. No existe tool de anular OC en Módulo 1 (pregunta abierta de negocio); si se necesita,
   se especifica aquí y en `tools.md` antes de implementarla.

### Cómputo de cobertura de recepción (regla dura 3, determinista)

- `cantidad_recibida(po_item)` = Σ de cantidades confirmadas por el bodeguero
  (`receipt_confirmations`) de facturas **conciliadas** linkeadas a la OC
  (`invoice_po_links`) para ese ítem.
- OC `recibida_total` ⟺ para **todo** `po_item`: `cantidad_recibida ≥ cantidad −
  difCantidadMenor` (umbral E5, hoy 0). OC `recibida_parcial` ⟺ existe recepción y no es
  total.
- Pedido `recepcion_total` ⟺ **todas** sus OCs no-anuladas están `recibida_total`; pedido
  `recepcion_parcial` ⟺ existe al menos una recepción y no es total.
- El cómputo vive como **función pura en `packages/core`** (entrada: cantidades pedidas y
  confirmadas agregadas; salida: estado objetivo de OC y pedido); el agregado SQL vive en
  `packages/agent`. Tests cruzados core↔SQL obligatorios.

## Ciclo paralelo: equipos de alquiler (§4.4)

Los alquileres NO usan la máquina de estados del pedido. Ciclo propio:

| Estado | Regla |
|---|---|
| `activo` | Alta por boleta/factura de alquiler; `cantidad_activa > 0` |
| `cerrado` | `cantidad_activa == 0` tras devoluciones (Sistema, automático) |

- Devoluciones parciales descuentan de `cantidad_activa`; nunca puede quedar negativa (rechazar y escalar).
- Cada movimiento (entrada/devolución) referencia la boleta origen y genera `audit_event`.
