# Work order — Fase 2a · Slice 1: framework de tools + `crear_pedido` / `confirmar_pedido`

> Instrucciones autocontenidas para un agente de codigo. Segui esto en orden. No asumas
> contexto de conversaciones previas. **Fuente de verdad = `docs/specs/*` y `docs/EXECUTION_PLAN.md`;
> regla de oro: ningun cambio de comportamiento sin actualizar la spec primero.**

## 0. Objetivo (una frase)

Construir el **framework de ejecucion de tools** (contexto inyectable + transaccion + auditoria +
outbox + resolucion de actor por telefono) y con el implementar las dos primeras tools del flujo de
pedido — `crear_pedido` y `confirmar_pedido` — deterministas, con validacion de rol, en una sola
transaccion que incluye su `audit_event` y sus mensajes de `outbox`, y con tests exhaustivos.

Fuera de alcance de este slice (NO lo hagas): extraccion NL/voz/foto→estructurado, el loop del agente
Claude, el prompt de produccion, RFQ/cotizaciones/comparativo. Esos son slices siguientes (§9).

## 1. Antes de empezar — leer (en este orden)

1. `docs/EXECUTION_PLAN.md` §1 (controles no negociables) y §2 (arquitectura, modelo del agente).
2. `docs/specs/tools.md` — contratos de `crear_pedido` y `confirmar_pedido` (§Pedidos) y las reglas
   transversales del encabezado.
3. `docs/specs/state-machine.md` — estado inicial `borrador`; quien dispara cada transicion.
4. `docs/specs/data-model.md` — tablas `pedidos`, `pedido_items`, `approval_events`, `audit_events`,
   `outbox_messages`, `users`, `user_roles`, `conversations`.
5. `docs/specs/exceptions.md` — E7 (pedido sin proyecto), E8 (fuera de alcance), E11 (remitente
   desconocido), E12 (transicion invalida).
6. `packages/core/CLAUDE.md`, `packages/agent/CLAUDE.md`, `apps/worker/CLAUDE.md`.
7. El codigo ya hecho que vas a REUSAR, no reimplementar:
   - `packages/core/src/index.ts` — exports: `puedeTransicionar`, `TOOL_ROLES`/`puedeUsarTool`,
     `requiereAprobacion*` (policy), `formatNumero`, `siguienteCorrelativo`, tipos de `types.ts`.
   - `packages/db/migrations/001_*.sql` — busca la **funcion SQL de numeracion** (`siguiente_numero`
     o similar; confirma nombre y parametros) que entrega el correlativo PED con `FOR UPDATE`. USALA
     dentro de la transaccion; no calcules el numero en JS con max()+1.
   - `apps/api/src/webhook/ingest.ts` y `apps/api/src/db/inbound.ts` — patron de referencia:
     logica pura + interfaces inyectadas + fakes en tests.

## 2. Reglas no negociables (si dudas, PARA y preguntá; nunca las relajes)

1. **Rol primero**: cada tool valida el rol del solicitante con `puedeUsarTool` de `@proveeduria/core`
   ANTES de cualquier efecto. El LLM nunca decide permisos. Rol insuficiente → error explicable, sin efecto.
2. **Una transaccion por tool**: el cambio de dominio + su `audit_event` + los `outbox_messages`
   derivados se escriben en la **misma** transaccion de Postgres. Si algo falla, rollback total.
3. **Ningun envio de WhatsApp directo**: toda notificacion saliente se inserta en `outbox_messages`
   dentro de esa transaccion. Nada de llamar a Meta desde la tool.
4. **Transiciones solo via core**: usá `puedeTransicionar`; si es invalida → E12 (error de tool,
   sin forzar). El trigger de la BD es la segunda barrera, no la primera.
5. **Numeracion transaccional**: PED via la funcion SQL con `FOR UPDATE` (paso §1.7).
6. **Sin escritura especulativa**: en duda (E7: proyecto no resuelto) NO se crea el pedido; se
   devuelve el codigo de excepcion y un mensaje que pide la aclaracion.
7. **Errores explicables**: nunca stack traces al usuario. Inputs con schema estricto.
8. **No toques el contrato congelado**: `packages/core/src/types.ts`, ni el scaffold (tsconfig base,
   configs), ni el prototipo legado (`server.js`, `dashboard/`).

## 3. Setup del paquete `packages/agent` (donde viven las tools, EXECUTION_PLAN §2)

Las tools y su runtime van en `packages/agent/src/`. Ajustá el scaffold del paquete para que
compile y testee como los demas (espejá `packages/core` / `apps/api`):

- `packages/agent/package.json`: agregá `"pg": "^8.13.1"` a `dependencies`; agregá scripts
  `"test": "vitest run"` y cambiá `typecheck` a `"tsc -p tsconfig.test.json"`.
- `packages/agent/tsconfig.json`: agregá `"src/**/*.test.ts"` a `exclude` (para no emitir tests a dist).
- Creá `packages/agent/tsconfig.test.json` (espejo del de core: `extends` base, `noEmit: true`,
  `types: ["node"]`, incluye `src/**/*.ts`).
- Creá `packages/agent/vitest.config.ts` con alias `@proveeduria/core` → `../core/src/index.ts`
  (espejo de `apps/api/vitest.config.ts`), para que los tests resuelvan core sin build previo.
- Corré `npm install` en la raiz para enlazar `pg`.

## 4. Framework de ejecucion (construilo primero — todas las tools futuras lo reusan)

Diseño obligatorio: tools = funciones deterministas que reciben input tipado + un `Ctx` con
dependencias **inyectadas** (interfaces), de modo que se testeen con fakes sin tocar la BD, y una
implementacion pg real para el worker. Sugerido en `packages/agent/src/runtime/`:

```ts
// Actor resuelto por telefono (router). null => remitente desconocido (E11).
export interface Actor {
  readonly userId: string;
  readonly roles: readonly Rol[];
  readonly nombre: string;
}

// Handle de transaccion (una sola por invocacion de tool).
export interface Tx {
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

// Servicios que toda tool puede usar DENTRO de la transaccion.
export interface Ctx {
  readonly tx: Tx;
  readonly actor: Actor;
  readonly ahora: Date;                 // reloj inyectado (determinista en tests)
  readonly audit: (e: AuditEvent) => Promise<void>;     // inserta en audit_events
  readonly outbox: (m: OutboxMessage) => Promise<void>; // inserta en outbox_messages
  readonly repos: Repos;                // PedidoRepo, ProyectoRepo, UsuarioRepo, ...
}

// Toda tool retorna un Result explicable (nunca lanza para flujo normal).
export type ResultadoTool<T> = Result<T, { codigo: CodigoExcepcion | 'rol_insuficiente'; mensaje: string }>;
```

Construí:
- `runtime/withTx(pool, fn)` — abre `BEGIN`, corre `fn(tx)`, `COMMIT`; en error `ROLLBACK` y re-lanza.
- `runtime/audit.ts` — helper que arma e inserta un `audit_event` (actor, accion, entidad, entidad_id,
  antes/despues jsonb, origen). Cada tool DEBE registrar el suyo.
- `runtime/outbox.ts` — helper que inserta en `outbox_messages` (destino, template|texto, payload).
- `runtime/repos.ts` — interfaces `PedidoRepo`, `PedidoItemRepo`, `ProyectoRepo`, `UsuarioRepo` +
  implementaciones pg (queries **parametrizadas**, jamas SQL por string). `UsuarioRepo.porTelefono(phone)`
  devuelve `Actor | null` (join users+user_roles).
- `runtime/fakes.ts` (en tests o junto a los tests) — fakes en memoria de repos/tx/audit/outbox para
  tests unitarios sin BD.

## 5. Tool `crear_pedido` (tools.md §Pedidos)

- **Roles permitidos**: `ingeniero`, `admin_materiales`, `superadmin` (verificá con `puedeUsarTool('crear_pedido', actor.roles)`).
- **Input** (schema estricto, `additionalProperties: false`): `{ projectId: string; items: {descripcion: string; cantidad: number; unidad: string}[]; fechaRequerida?: string; urgencia?: string }`.
- **Reglas**:
  - `projectId` debe corresponder a un proyecto **activo**; si no resuelve → **E7**: no crear, devolver
    mensaje pidiendo el proyecto al ingeniero solicitante. (La resolucion nombre→id la hara el router
    en un slice futuro; acá exigí un `projectId` valido y devolvé E7 si no lo es.)
  - `items` no vacio; cantidades > 0; unidad no vacia.
- **Efecto** (una transaccion): obtener numero `PED-YYYY-NNN` (funcion SQL con FOR UPDATE) →
  insertar `pedidos` en estado `borrador` con `solicitante_user_id = actor.userId` → insertar
  `pedido_items` → registrar `audit_event(accion='crear_pedido', entidad='pedido', ...)`.
- **NO hace**: enviar RFQs; ni transicionar de estado.
- **Devuelve**: resumen del pedido (numero, proyecto, items, fecha) para que el usuario confirme.

## 6. Tool `confirmar_pedido` (tools.md §Pedidos)

- **Rol permitido**: **el solicitante del pedido** (comparar `actor.userId` con `pedido.solicitante_user_id`;
  si no coincide → error de permiso, sin efecto).
- **Guard**: el pedido existe y esta en `borrador`.
- **Efecto** (una transaccion): fija el resumen confirmado (marca el pedido como confirmado; el estado
  sigue `borrador` — la lista de proveedores/RFQ es otro paso) → `audit_event(accion='confirmar_pedido')`
  → **outbox**: notifica a Proveeduria (rol `admin_materiales`) que hay un pedido nuevo por gestionar
  (plantilla `notificacion_interna`, ver `docs/specs/templates-whatsapp.md`; el destino se resuelve por
  los usuarios con rol admin_materiales).
- **Sin escritura sobre pedidos ya no-borrador** (respetá la maquina de estados).

## 7. Tests (contrato de este slice — cubrí los casos de la spec, incluidos los de excepcion)

Unitarios con fakes (sin BD), en `packages/agent/src/**/*.test.ts`:
- `crear_pedido`: rol permitido crea en `borrador` con numero e items; rol NO permitido → sin efecto;
  `projectId` inactivo/inexistente → **E7**, no se crea nada; items vacios / cantidad ≤ 0 → error;
  se registra exactamente un `audit_event`; NO se generan outbox de RFQ.
- `confirmar_pedido`: solicitante confirma → audit + un outbox a Proveeduria; NO-solicitante → sin
  efecto; pedido inexistente o no-`borrador` → error explicable, sin efecto.
- Framework: `withTx` hace rollback ante error de la tool (verificá que un fallo despues del insert
  no deja rastro en los fakes/estado).

Integracion (opcional pero recomendado) contra Postgres efimero (ver §8): crear→confirmar un pedido
real y verificar filas en `pedidos`/`pedido_items`/`audit_events`/`outbox_messages` y que el numero
sigue el formato y el correlativo avanza.

## 8. Verificacion (corré TODO esto y dejalo verde antes de terminar)

Desde la raiz del repo:
```bash
npm run build:all        # libs primero, luego apps (debe pasar)
npm run typecheck        # incluye tests (debe pasar)
npm run test:all         # todos los paquetes (debe pasar)
```
Migraciones + tu integracion contra Postgres real (el CI usa este mismo gate):
```bash
CID=$(docker run -d --rm -e POSTGRES_PASSWORD=provee -e POSTGRES_USER=provee \
  -e POSTGRES_DB=provee_test -p 55432:5432 postgres:16)
export DATABASE_URL=postgres://provee:provee@127.0.0.1:55432/provee_test
# Esperá readiness REAL (postgres re-arranca durante el init):
timeout 90 bash -c 'until psql "$DATABASE_URL" -c "select 1" >/dev/null 2>&1; do :; done'
npm run migrate && npm run seed
# ...corré tu test de integracion apuntando a DATABASE_URL...
docker stop "$CID"
```

## 9. Guardrails y ambiguedades

- **No inventes esquema.** Si necesitas una columna/tabla que no esta en `data-model.md` (p.ej. una
  bandera "confirmado" en `pedidos`), primero actualizá `docs/specs/data-model.md` y agregá una
  migracion **nueva** (`005_*.sql`; nunca edites migraciones ya numeradas si el equipo ya las aplico).
  Documentá el porque.
- **Preguntas de spec abiertas** (ya conocidas — no las re-decidas sola; usá el default y dejá nota):
  "Gerencia"=`superadmin`; `confirmar_recepcion` sin `superadmin` es literal de la spec; umbral E5=0.
  Ver comentarios en `packages/core/src/*` y la memoria del proyecto.
- **No toques**: `packages/core/src/types.ts`, tsconfig base/scaffold, `server.js`, `dashboard/`.
- **Idioma**: dominio en español (tablas, tipos, tools, copy; tono "vos"). 2 espacios, comillas simples.
- **TS**: ESM NodeNext (imports relativos con `.js`), `import type` para tipos, strict.

## 10. Definition of Done

- [ ] Framework (`runtime/`) con `withTx`, `audit`, `outbox`, repos (interfaces + impl pg) y fakes.
- [ ] `crear_pedido` y `confirmar_pedido` implementadas segun §5/§6, con validacion de rol via core,
      una sola transaccion con `audit_event` + outbox, numeracion via la funcion SQL, E7 respetado.
- [ ] Tests unitarios (fakes) cubriendo happy path + rol insuficiente + E7 + guardas de estado; verde.
- [ ] `build:all`, `typecheck`, `test:all` verdes; migraciones aplican en Postgres efimero.
- [ ] Si descubriste algo no documentado, actualizaste la spec correspondiente y lo notaste.
- [ ] Resumen final: que se implemento, resultados de verificacion, y preguntas abiertas nuevas.

## Siguientes slices (contexto, NO los hagas ahora)

2. `sugerir_proveedores` + `enviar_rfq` (transicion `borrador→cotizando`, outbox plantilla `rfq_solicitud`,
   `approval_events(lista_proveedores)`).
3. `registrar_cotizacion` (extraccion texto/foto/audio con esquema estricto + `confianza_extraccion`,
   E2) → `cotizando→en_revision`.
4. `generar_comparativo` (SQL determinista, sin LLM) + vista/enlace al portal.
5. Wiring del worker: router por remitente + loop del agente Claude (prompt = humano) que invoca estas tools.
