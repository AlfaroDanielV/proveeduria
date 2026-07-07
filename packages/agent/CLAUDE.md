# packages/agent — agente Claude (prompt + tools + extractores)

Contenido de produccion = **Fase 2** (docs/specs/tools.md). En Fase 1 es un stub que
publica el contrato de nombres de tools y el tipo de contexto del router.

## Limites (AI_ASSISTED_DEVELOPMENT.md §7 — donde NO delegar sin revision humana)

- El **prompt de produccion** y la **politica de decision** los edita el humano, con
  goldens de conversacion como regresion. Un agente de codigo no los reescribe solo.
- Toda tool: valida rol via `@proveeduria/core`, corre en transaccion con `audit_event`,
  y sus mensajes salientes van al `outbox` (nunca envio directo).
- Excepciones E1..E13 = reglas deterministas en las tools (importadas de `@proveeduria/core`),
  no juicio del LLM.
- El parseo de cotizaciones/facturas (Vision/transcripcion) usa **esquema estricto** y
  reporta `confianza_extraccion`; bajo umbral → cola de revision, nunca escritura silenciosa.
