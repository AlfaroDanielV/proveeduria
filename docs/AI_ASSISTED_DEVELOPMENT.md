# Setup de Desarrollo Asistido por IA

Cómo construir el Módulo 1 como desarrollador solo usando agentes de codificación (Claude Code) sin perder control de calidad. Esto es parte del plan de capacidad: el cronograma de 90 días asume este modo de trabajo.

---

## 1. Principio rector: specs como fuente de verdad

Los agentes de código son excelentes ejecutando contra una especificación verificable y peligrosos improvisando dominio. Por eso el repo mantiene specs versionadas que **tú editas y el agente obedece**:

```
docs/
  specs/
    state-machine.md      # estados del pedido (PDF §4.2) + transiciones válidas + quién dispara cada una
    data-model.md         # tablas, relaciones 1:N, invariantes (pedido→OC→factura→NC)
    exceptions.md         # tabla de excepciones del PDF §4.6 → regla determinista por caso
    tools.md              # contrato de cada tool del agente: input schema, efectos, permisos por rol
    templates-whatsapp.md # texto exacto de plantillas aprobadas por Meta
  EXECUTION_PLAN.md
  DEPLOYMENT_COOKBOOK.md
```

Regla: **ningún cambio de comportamiento sin actualizar la spec primero.** El flujo por feature es: editar spec → pedir plan → aprobar plan → implementar con tests → revisar.

## 2. Estructura del repo para agentes

- **Monorepo** con `CLAUDE.md` raíz (ya existe AGENTS.md — mantenerlo actualizado) que declare: comandos de build/test por paquete, convenciones (español en dominio, 2 espacios, single quotes), y punteros a `docs/specs/`.
- Un `CLAUDE.md` corto por paquete (`apps/api`, `apps/worker`, `packages/core`) con lo no-obvio de ese paquete: qué no tocar, dónde están los tests, invariantes.
- **`packages/core` puro y testeado al 100%**: máquina de estados, política de aprobaciones, numeración correlativa, reglas de excepción. Es el código que un agente jamás debe "ajustar de paso" — protégelo con tests exhaustivos que fallen ruidosamente.
- Datos de prueba realistas versionados: `fixtures/` con fotos reales anonimizadas de facturas, cotizaciones y boletas de Proyekta (pedirlas en Fase 1). La calidad del OCR se desarrolla contra estas, no contra ejemplos inventados.

## 3. Flujo de trabajo diario con Claude Code

1. **Plan mode primero** para cada feature no trivial: pedir el plan citando la spec (`Implementá el paso 6 del flujo según docs/specs/exceptions.md y tools.md; plan primero`). Revisar el plan, no el diff, es donde tu criterio rinde más.
2. **Una feature = una rama** (o worktree si trabajás dos en paralelo). PRs pequeños aunque seas el único revisor — el diff corto es lo que te permite auditar código generado.
3. **Tests como contrato**: pedir siempre "implementación + tests que cubran los casos de la spec, incluidos los de excepción". Para el webhook: tests de firma inválida, wamid duplicado, payload malformado. Para la máquina de estados: test por cada transición inválida.
4. **`/code-review` antes de cada merge** y periódicamente `/security-review` (especialmente webhook, auth del portal, SQL de `consultar_datos`).
5. **Verificación end-to-end real**: mantener un script `npm run e2e:whatsapp` que simule payloads de Meta contra el api local (firmados) y verifique efectos en la DB. El agente puede correrlo y leer los resultados — cierra el loop sin que tengas que probar a mano cada vez.
6. **Sesiones enfocadas**: una tarea por sesión; contexto largo degrada precisión. Al terminar, pedir al agente que actualice la spec/CLAUDE.md si descubrió algo no documentado.

## 4. Dónde usar subagentes / workflows (fan-out)

Casos con retorno real en este proyecto:

- **Migración del prototipo**: server.js (1.500 líneas) → paquetes. Fan-out: un agente inventaría cada tool/handler existente y su comportamiento; otro produce la spec de paridad; luego implementás por módulo contra esa spec. El prototipo queda como referencia de comportamiento, nunca como base de código.
- **Auditorías transversales**: "buscá todo query sin parámetros", "todo envío de WhatsApp fuera del outbox", "todo acceso a DB fuera de packages/db". Baratas con agentes de búsqueda, imposibles de mantener a mano.
- **Generación de casos de prueba OCR**: variantes de cotizaciones de proveedor (formatos, redacciones, audios transcritos) para endurecer los extractores antes del piloto.
- **Revisión multi-lente pre-release** (día ~58 y día ~85): review paralelo por corrección, seguridad e idempotencia sobre el diff acumulado.

## 5. Automatización de CI con IA

- GitHub Actions: lint + tests + build en cada PR (ya hay workflows de deploy; agregar el de CI).
- **Claude Code GitHub Action** para review automático de PRs — segunda mirada gratuita en un equipo de uno.
- Gate de migraciones: job que aplica migraciones a un Postgres efímero y corre los tests de esquema.
- Deploy a dev automático en merge a `main`; deploy a prod con aprobación manual (environment protection rule).

## 6. MCP / herramientas conectadas útiles

- **Postgres MCP (solo lectura, apuntando a dev)**: el agente inspecciona el esquema y datos reales al escribir queries y vistas — elimina una clase entera de errores.
- **GitHub MCP o `gh` CLI**: issues como backlog; cada ítem del cronograma es un issue; le pedís al agente "tomá el issue #23".
- Playwright/browser tooling para verificar el portal visualmente en cambios de UI.

## 7. Límites (donde NO delegar)

- Prompt del agente de producción y reglas de la política de decisión: los editás vos, con tests de regresión de comportamiento (goldens de conversaciones).
- Migraciones destructivas y todo lo que toque `audit_events`.
- Secretos y configuración de Meta/Key Vault: nunca en el contexto del agente de código.
- Cualquier mensaje real a proveedores durante desarrollo: solo números de prueba hasta el cutover del día ~55.

## 8. Ritmo semanal sugerido

- Lun: planificar la semana contra el cronograma (issues), sesiones de spec.
- Mar–Jue: implementación con el flujo del §3; merges diarios a dev.
- Vie: `/code-review` acumulado, e2e completo en dev, actualizar specs, demo corta grabada para Proyekta (mantiene confianza del cliente durante las 13 semanas).
