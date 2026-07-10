# Prompt para retomar la siguiente sesion

Usa este prompt si abris una sesion nueva y queres continuar exactamente desde el cierre del
hito navegable de Fase 2a.

```text
Estamos en /home/alaroda/Documents/proveeduria.

Primero lee, en este orden:
1. CLAUDE.md
2. docs/CODEBASE_GUIDE.md
3. docs/handoff/FASE2A-current-status.md
4. docs/handoff/FASE2A-next-session-prompt.md
5. docs/specs/tools.md
6. docs/specs/portal-api.md
7. docs/specs/state-machine.md
8. docs/specs/data-model.md
9. packages/agent/CLAUDE.md
10. apps/api/CLAUDE.md
11. apps/worker/CLAUDE.md

Antes de tocar codigo:
- Corre git status --short --branch.
- Confirma staged/untracked y no cambies staging salvo que te lo pida.
- Respeta cambios existentes; no revertir cambios de usuario.
- No tocar server.js ni dashboard/ legacy para features nuevas.

Contexto actual:
- Fase 2a, hito "Prototipo navegable", ya quedo cubierto con harness estructurado.
- El flujo deterministico pedido -> RFQ -> cotizaciones -> en_revision -> comparativo esta implementado y verificado.
- packages/agent ya tiene runtime transaccional de tools y tools:
  crearPedido, confirmarPedido, sugerirProveedores, enviarRfq, registrarCotizacion,
  generarComparativo.
- packages/agent/src/agent tiene seam sin LLM para tool_call JSON whitelisted:
  structured.ts, tool-dispatcher.ts, loop.ts.
- apps/worker ya tiene domain handler/router, structured-engine usando @proveeduria/agent,
  E11 para remitente desconocido y dispatcher de outbox en apps/worker/src/outbox.
- apps/api ya tiene webhook ingest seguro y REST de portal bajo /api/portal/*.
- apps/portal es el portal nuevo Fase 2a, estatico, sin dependencias externas, para lista,
  detalle y comparativo.
- dashboard/ legacy y server.js son referencia solamente.

Verificacion ya pasada antes de cerrar la sesion anterior:
- npm run build:all
- npm run typecheck
- npm run test:all
- Postgres efimero con migraciones 001-005 y seed.
- Integraciones DB-backed:
  - packages/agent/src/tools/pedido.integration.test.ts
  - apps/api/src/portal/repo.integration.test.ts
  - apps/worker/src/domain/handler.integration.test.ts
  - apps/worker/src/outbox/dispatcher.integration.test.ts

Lo pendiente ya no es el hito navegable, sino runtime productivo sobre WhatsApp real:
1. Prompt/model adapter real de Claude con goldens; el prompt de produccion lo edita el humano.
2. Extractores estructurados texto/voz/foto hacia inputs estrictos de tools.
3. Broker real para API/worker en lugar de stubs/in-memory.
4. Sender real de Meta para OutboxSender, manteniendo todos los envios via outbox_messages.

Siguiente bloque recomendado:
- No rehacer comparativo ni portal.
- Elegir un bloque de endurecimiento runtime pequeno y verificable.
- Si no hay instruccion mas especifica, empezar por el wiring mas deterministico:
  broker real o sender real de outbox con interfaz inyectable, tests unitarios e integracion
  si hay credenciales/servicio disponible.

Guardrails:
- Specs primero si cambia contrato o schema.
- Mantener efectos dominio + audit + outbox/approval/review en una transaccion.
- Usar @proveeduria/core para roles/transiciones.
- Nada de WhatsApp directo desde tools; todo por outbox.
- No poner decisiones criticas en Claude; las tools validan permisos, estado y excepciones.

Verificacion esperada al cerrar cualquier nuevo bloque:
- npm run build:all
- npm run typecheck
- npm run test:all
- Integration test con Postgres efimero si toca SQL/repos/runtime.
```

## Estado del worktree al cerrar Fase 2a navegable

Si se retoma antes de hacer commit, es normal ver cambios no staged en docs, package metadata y
codigo nuevo bajo:

- `packages/agent/src/agent/`
- `apps/api/src/portal/`
- `apps/worker/src/outbox/`
- `apps/portal/`
- `docs/specs/portal-api.md`

No debe haber cambios en `server.js` ni `dashboard/`. Si aparecen, revisalos antes de seguir.
