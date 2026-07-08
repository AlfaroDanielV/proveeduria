# Handoff — Fase 2a estado actual

Ultima actualizacion: despues de implementar las tools deterministas de pedido, RFQ y
registro de cotizaciones en `packages/agent`.

## Estado del proyecto segun `docs/EXECUTION_PLAN.md`

El proyecto esta en **Fase 2a — Prototipo navegable**, pero aun no alcanza el hito completo
de dia 30. La capa deterministica de tools ya cubre el flujo pedido hasta `en_revision`; falta
conectarla al worker/router/Claude loop y construir comparativo + portal.

## Ya implementado

En `packages/agent/src/tools/pedido.ts`:

- `crearPedido`
  - Valida rol con `puedeUsarTool('crear_pedido', actor.roles)`.
  - Valida proyecto activo e items.
  - Usa numeracion PED via `siguiente_numero('PED', anio)` desde Postgres.
  - Inserta `pedidos` en `borrador`, `pedido_items` y `audit_events`.
- `confirmarPedido`
  - Solo permite confirmar al solicitante original.
  - Mantiene `estado=borrador` y fija `confirmado_at`/`confirmado_por`.
  - Notifica a `admin_materiales` por `outbox_messages` con `notificacion_interna`.
- `sugerirProveedores`
  - Solo lectura de pedido/items/proveedores.
  - Rankea proveedores activos con contacto opt-in por match de categorias contra items.
  - Historial/tasa de respuesta queda neutro hasta que haya datos suficientes.
- `enviarRfq`
  - Valida `borrador -> cotizando` con `puedeTransicionar`.
  - Valida proveedores activos con contacto opt-in.
  - Inserta `approval_events(lista_proveedores)`, `quote_requests`, audit y outbox
    `rfq_solicitud`.
  - Transiciona `pedidos.estado` a `cotizando`.
- `registrarCotizacion`
  - Recibe input estructurado del extractor/router; no hace OCR/LLM.
  - Inserta `quote_responses` y `quote_items`.
  - Usa E2 del core: cotizacion incompleta por confianza baja, item sin precio/cantidad o
    sin items.
  - Si E2 aun no agoto repreguntas: guarda intento y encola repregunta al proveedor.
  - Si E2 agoto repreguntas: guarda intento, crea `review_queue(cotizacion_incompleta)` y
    notifica a Proveeduria.
  - Si es completa: marca `quote_requests.estado='respondida'`.
  - Cuando no quedan RFQs pendientes: transiciona `cotizando -> en_revision`.

En `packages/agent/src/runtime/`:

- `types.ts`: contratos `Actor`, `Ctx`, repos, audit/outbox/approval, quotes/review/config.
- `tx.ts`: transaccion PG (`BEGIN`/`COMMIT`/`ROLLBACK`).
- `audit.ts`, `outbox.ts`, `approval.ts`: insertores transaccionales.
- `repos.ts`: implementaciones PG con SQL parametrizado.
- `fakes.ts`: fakes en memoria con snapshot/rollback para unit tests.

En `packages/db/migrations/005_pedidos_confirmacion.sql`:

- Agrega `pedidos.confirmado_at` y `pedidos.confirmado_por`.

## Verificacion ya corrida

Pasaron:

```bash
npm run build:all
npm run typecheck
npm run test:all
```

Tambien paso un integration test contra Postgres efimero con:

- migraciones `001` a `005`
- `npm run seed`
- flujo real `crear -> confirmar -> sugerir -> enviar RFQ -> registrar 2 cotizaciones -> en_revision`

El test esta en `packages/agent/src/tools/pedido.integration.test.ts` y solo corre si
`DATABASE_URL` contiene `provee_test`; si no, queda skipped.

## Lo que falta para completar Fase 2a

Siguiente bloque natural:

1. `generarComparativo`
   - Debe ser SQL deterministico, no LLM.
   - Leer `pedido_items`, `quote_requests`, `quote_responses`, `quote_items`.
   - Producir tabla item x proveedor con precio, cantidad, disponibilidad, condiciones,
     subtotales y faltantes.
   - Enviar por `outbox` o devolver estructura para WhatsApp/portal segun spec.
2. Worker/router
   - Resolver remitente interno/proveedor/desconocido.
   - Crear `Ctx` real con actor, origen, `withTx` y repos PG.
   - Invocar tools desde jobs persistidos de `inbound_messages`.
3. Claude/tool loop
   - Prompt de produccion lo edita el humano.
   - El agente solo decide tool calls dentro del contrato; permisos y excepciones quedan en tools.
4. Portal Fase 2a
   - Lista de pedidos por estado.
   - Detalle de pedido.
   - Vista de comparativo.

## Guardrails para la siguiente sesion

- Leer primero `CLAUDE.md`, `packages/agent/CLAUDE.md`, este handoff y `docs/CODEBASE_GUIDE.md`.
- No tocar `server.js` ni `dashboard/` para nuevas features de produccion; son referencia/prototipo.
- No modificar `packages/core/src/types.ts` salvo que primero se cambie la spec.
- No inventar schema; si falta una columna/tabla, actualizar `docs/specs/data-model.md` y crear
  migracion nueva.
- Todas las tools escriben dominio + audit + outbox/approval/review derivados en una transaccion.
- Nada de envio WhatsApp directo desde tools.
- Transiciones solo via `@proveeduria/core` y el trigger de DB como segunda barrera.
