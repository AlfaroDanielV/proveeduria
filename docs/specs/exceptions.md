# Spec: Flujos de excepción

Fuente: Propuesta v3 §4.6 — "el agente está diseñado para no tomar decisiones críticas en silencio". Cada excepción se implementa como **regla determinista en la tool correspondiente**, no como juicio del LLM. Toda excepción genera: entrada en `review_queue` (cuando aplica) + notificación por outbox al rol responsable + `audit_event`.

## Tabla normativa

| # | Situación | Detección (determinista) | Acción del sistema | Escala a |
|---|---|---|---|---|
| E1 | Proveedor no responde cotización en plazo | Cron: `quote_requests.plazo_at` vencido sin `quote_responses` | Marca `vencida`; notifica lista de pendientes; ofrece opciones: extender plazo / continuar sin esa cotización | Proveeduría |
| E2 | Cotización incompleta o ambigua | Extracción sin precio/cantidad para ≥1 ítem, o `confianza_extraccion < 0.8` | Repregunta al proveedor (máx. **2 intentos**, registrados); al tercer fallo marca `incompleta` y escala | Proveeduría (tras 2 intentos) |
| E3 | Factura no coincide con ninguna OC abierta | Cruce por proveedor+proyecto+ítems sin match sobre umbral de similitud | **No registra automáticamente**; crea `review_queue(factura_sin_oc)` con la OC más probable como propuesta | Proveeduría |
| E4 | Factura con diferencia significativa de monto vs OC | `abs(monto_factura − monto_oc_asignado) > max(1%, ₡10.000)` (umbral configurable) | Registra como `pendiente_revision`; no concilia | Proveeduría |
| E5 | Material recibido ≠ ordenado | Bodeguero confirma cantidades distintas, o ítems no presentes en la OC | Registra la diferencia con foto y descripción; **no cierra la OC**; diferencias menores (≤ umbral) se registran y notifican sin bloquear | Proveeduría |
| E6 | Nota de crédito sin factura identificable | Sin match único por proveedor+número de factura referenciado | `pendiente_asociacion`; pide aclaración **antes** de aplicar cualquier ajuste | Proveeduría |
| E7 | Pedido sin proyecto identificable | Extracción no resuelve proyecto contra `projects` activos | Pregunta al ingeniero solicitante; el pedido no se crea hasta resolver | Ingeniero solicitante |
| E8 | Mensaje fuera del alcance de proveeduría | Router clasifica fuera de dominio | Responde indicando el alcance y redirige; no ejecuta tools; registra en `feedback` si es sugerencia | — |
| E9 | Extracción OCR de factura bajo umbral | `confianza_extraccion < 0.85` en campos de monto o número | Pide confirmación campo-por-campo al bodeguero solo para los campos dudosos; si persiste, `review_queue` | Bodeguero → Proveeduría |
| E10 | Devolución de equipo mayor que inventario activo | `cantidad_devuelta > cantidad_activa` | Rechaza el movimiento; pide verificación de boleta | Servicios Generales (Bernal) |
| E11 | Remitente desconocido | Teléfono no está en `users` ni `supplier_contacts` | Respuesta genérica sin datos; registra el intento; no ejecuta tools | Superadmin (resumen diario) |
| E12 | Transición de estado inválida solicitada | Validación de state-machine.md | Error de tool con explicación; sin efecto | — |
| E13 | Pedido atascado | Cron: >24h en `en_revision` sin decisión, o >48h `aprobado` sin OC confirmada por proveedor | Recordatorio al responsable del estado | Proveeduría; Gerencia si reincide |

## Reglas generales

1. **Silencio prohibido**: ninguna rama de excepción termina sin notificación a un humano o respuesta al remitente.
2. **Sin escritura especulativa**: en duda (E3, E6, E9) el dato queda en estado pendiente explícito, jamás conciliado "probablemente bien".
3. Los umbrales (E2, E4, E5, E9) viven en tabla `config` editable por superadmin, con valores iniciales los de esta spec; cambiarlos genera `audit_event`.
4. Toda repregunta a proveedor cuenta intentos en `quote_responses`/`review_queue`; los contadores son visibles en el portal.
5. El resumen diario a Proveeduría incluye: `review_queue` pendientes, E1 vencidas, E13 atascados, remitentes desconocidos.
