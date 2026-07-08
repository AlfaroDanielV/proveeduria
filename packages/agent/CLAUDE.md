# packages/agent — agente Claude (prompt + tools + extractores)

Contenido de produccion = **Fase 2** (docs/specs/tools.md). Este paquete ya no es solo
stub: Fase 2a tiene implementado el runtime determinista de tools y el flujo pedido hasta
cotizaciones registradas / pedido `en_revision` con comparativo generado.

## Estado actual Fase 2a

Implementado y verificado con unit tests + integration test contra Postgres efimero:

- `src/runtime/`:
  - `tx.ts`: `withTx(pool, fn)` con `BEGIN`/`COMMIT`/`ROLLBACK`.
  - `context.ts`: crea `Ctx` con actor, reloj, repos, audit, outbox, approval.
  - `repos.ts`: repos PG parametrizados para pedidos, items, usuarios, proveedores,
    quote requests/responses/items, review queue y config.
  - `fakes.ts`: fakes transaccionales para tests sin DB.
- `src/tools/pedido.ts`:
  - `crearPedido`
  - `confirmarPedido`
  - `sugerirProveedores`
  - `enviarRfq`
  - `registrarCotizacion`
  - `generarComparativo`

No implementado aun:

- Loop Claude/tool-use y prompt de produccion.
- Router conversacional del agente. El worker ya tiene una primera resolucion
  `interno|proveedor|desconocido` y crea `Ctx` para internos.
- Extractores OCR/Vision/audio; `registrarCotizacion` recibe input ya estructurado.
- Portal de pedidos/comparativo y dispatcher real de outbox.

## Limites (AI_ASSISTED_DEVELOPMENT.md §7 — donde NO delegar sin revision humana)

- El **prompt de produccion** y la **politica de decision** los edita el humano, con
  goldens de conversacion como regresion. Un agente de codigo no los reescribe solo.
- Toda tool: valida rol via `@proveeduria/core`, corre en transaccion con `audit_event`,
  y sus mensajes salientes van al `outbox` (nunca envio directo).
- Excepciones E1..E13 = reglas deterministas en las tools (importadas de `@proveeduria/core`),
  no juicio del LLM.
- El parseo de cotizaciones/facturas (Vision/transcripcion) usa **esquema estricto** y
  reporta `confianza_extraccion`; bajo umbral → cola de revision, nunca escritura silenciosa.
