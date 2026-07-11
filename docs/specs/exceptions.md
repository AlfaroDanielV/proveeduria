# Spec: Flujos de excepción

Fuente: Propuesta v3 §4.6 — "el agente está diseñado para no tomar decisiones críticas en silencio". Cada excepción se implementa como **regla determinista en la tool correspondiente**, no como juicio del LLM. Toda excepción genera: entrada en `review_queue` (cuando aplica) + notificación por outbox al rol responsable + `audit_event`.

## Tabla normativa

| # | Situación | Detección (determinista) | Acción del sistema | Escala a |
|---|---|---|---|---|
| E1 | Proveedor no responde cotización en plazo | Cron: `quote_requests.plazo_at` vencido sin `quote_responses` | Marca `vencida`; notifica lista de pendientes; ofrece opciones: extender plazo / continuar sin esa cotización | Proveeduría |
| E2 | Cotización incompleta o ambigua | Extracción sin precio/cantidad para ≥1 ítem, o `confianza_extraccion < 0.8` | Repregunta al proveedor (máx. **2 intentos**, registrados); al tercer fallo marca `incompleta` y escala | Proveeduría (tras 2 intentos) |
| E3 | Factura no coincide con ninguna OC abierta | Cruce determinista contra OCs abiertas del proveedor en el proyecto: score = similitud de ítems (overlap de tokens sobre descripciones normalizadas — minúsculas, sin tildes) ponderada con cercanía de monto. Sin candidato único con `score ≥ umbral_similitud_factura_oc` (default **0.6**, en `config` y `UmbralesConfig.similitudMinFacturaOc`) → E3. El algoritmo exacto vive en `packages/core` (puro) y se calibra con el corpus del piloto antes del go-live | **No registra automáticamente**; crea `review_queue(factura_sin_oc)` con la OC más probable como propuesta | Proveeduría |
| E4 | Factura con diferencia significativa de monto vs OC | `abs(monto_factura − monto_oc_asignado) > max(1%, ₡10.000)` (umbral configurable) | Registra como `pendiente_revision`; no concilia | Proveeduría |
| E5 | Material recibido ≠ ordenado | Bodeguero confirma cantidades distintas, o ítems no presentes en la OC | Registra la diferencia con foto y descripción; **no cierra la OC**; diferencias menores (≤ umbral) se registran y notifican sin bloquear | Proveeduría |
| E6 | Nota de crédito sin factura identificable | Sin match único por proveedor+número de factura referenciado | `pendiente_asociacion`; pide aclaración **antes** de aplicar cualquier ajuste | Proveeduría |
| E7 | Pedido sin proyecto identificable | Extracción no resuelve proyecto contra `projects` activos | Pregunta al ingeniero solicitante; el pedido no se crea hasta resolver | Ingeniero solicitante |
| E8 | Mensaje fuera del alcance de proveeduría | Router clasifica fuera de dominio | Responde indicando el alcance y redirige; no ejecuta tools; registra en `feedback` si es sugerencia | — |
| E9 | Extracción OCR de factura bajo umbral | El extractor entrega confianza **por campo** (`CampoExtraido<T> = { valor, confianza }` en `packages/core`: número de factura, monto total, fecha, proveedor, y por línea). E9 dispara si `confianza < 0.85` en número de factura o cualquier monto | Pide confirmación campo-por-campo al bodeguero **solo** para los campos dudosos; si persiste, `review_queue`. `invoices.confianza_extraccion` guarda el mínimo de los campos críticos | Bodeguero → Proveeduría |
| E10 | Devolución de equipo mayor que inventario activo | `cantidad_devuelta > cantidad_activa` | Rechaza el movimiento; pide verificación de boleta | Servicios Generales (Bernal) |
| E11 | Remitente desconocido | Teléfono no está en `users` ni `supplier_contacts` | Respuesta genérica sin datos; registra el intento; no ejecuta tools | Superadmin (resumen diario) |
| E12 | Transición de estado inválida solicitada | Validación de state-machine.md | Error de tool con explicación; sin efecto | — |
| E13 | Pedido atascado | Cron: >24h en `en_revision` sin decisión, o >48h `aprobado` sin OC confirmada por proveedor. **Reincidencia** (determinista): ≥2 recordatorios E13 emitidos para el mismo pedido desde su último cambio de estado — se cuenta desde `audit_events(accion='e13_recordatorio')`, sin tabla nueva | Recordatorio al responsable del estado; cada recordatorio registra `audit_event(e13_recordatorio)` | Proveeduría; a partir del 2.º recordatorio consecutivo también superadmin (Gerencia) |

## Reglas generales

1. **Silencio prohibido**: ninguna rama de excepción termina sin notificación a un humano o respuesta al remitente.
2. **Sin escritura especulativa**: en duda (E3, E6, E9) el dato queda en estado pendiente explícito, jamás conciliado "probablemente bien".
3. Los umbrales (E2, E3, E4, E5, E9) viven en tabla `config` editable por superadmin, con valores iniciales los de esta spec; cambiarlos genera `audit_event`. La clave nueva `umbral_similitud_factura_oc` (E3) se siembra en la migración 008 y se agrega a `UmbralesConfig` (`packages/core/src/types.ts`) como `similitudMinFacturaOc` — cambio de core protegido: esta spec es su autorización.
4. Toda repregunta a proveedor cuenta intentos en `quote_responses`/`review_queue`; los contadores son visibles en el portal.
5. El resumen diario a Proveeduría incluye: `review_queue` pendientes, E1 vencidas, E13 atascados, remitentes desconocidos.
