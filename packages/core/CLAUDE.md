# packages/core — dominio puro

Estados, numeracion, permisos, politica de aprobacion y deteccion de excepciones del
Modulo 1. **Codigo protegido**: un agente jamas lo "ajusta de paso"
(AI_ASSISTED_DEVELOPMENT.md §2). Todo cambio requiere actualizar la spec primero y va
acompañado de tests que fallen ruidosamente.

## Invariantes de este paquete

- **Puro**: sin IO, sin `pg`, sin `fetch`, sin fecha/hora del reloj como dependencia
  oculta. Las funciones que dependen del tiempo reciben `ahora: Date` como parametro
  (testeable, deterministico).
- **Sin lanzar para flujo normal**: las validaciones devuelven `Result<T, E>`
  (`ok`/`err`), no excepciones. Reservar `throw` para invariantes imposibles (bug).
- **Fuente de verdad = docs/specs/**. Cada regla cita su spec en un comentario.
- **100% cubierto por tests**: cada transicion valida y cada transicion invalida de
  `state-machine.md`; cada helper de excepcion PURO (E1, E2, E4, E5, E9, E10, E12, E13 — el
  resto, E3/E6/E7/E8/E11, se detecta fuera del core; ver `exceptions.ts`); numeracion en
  limites de año.

## Mapa de modulos

- `types.ts` — contrato de tipos (enums del dominio, `Result`, `UmbralesConfig`,
  `CampoExtraido<T>`/`CamposFacturaExtraida`). Lo escribio el humano; es el vocabulario que
  todo el monorepo importa. No renombrar sin actualizar todos los consumidores.
- `state-machine.ts` — tabla de transiciones del pedido + `puedeTransicionar`/`transicionar`.
- `oc-state-machine.ts` — tabla de transiciones de la OC + `puedeTransicionarOc`/
  `esTerminalOc` (state-machine.md §Ciclo de la OC). No valida la guardia "anulada solo sin
  recepciones" (depende de datos; queda para la tool).
- `numbering.ts` — formato y siguiente correlativo `PED-YYYY-NNN` / `OC-YYYY-NNN`
  (logica pura; el `FOR UPDATE` transaccional vive en packages/db).
- `roles.ts` — catalogo de roles y matriz tool→roles (equivale a `TOOL_ROLES`).
- `policy.ts` — que accion/transicion exige cual `TipoAprobacion`.
- `exceptions.ts` — deteccion determinista E1, E2, E4, E5, E9 (agregado, incluye E9
  por-campo), E10, E12, E13 (incluye reincidencia) y umbrales por defecto.
- `recepcion.ts` — computo de cobertura de recepcion de OC/pedido (state-machine.md
  §Computo de cobertura, regla dura 3) y sugerencia de cierre (regla dura 4).
- `matching.ts` — matching deterministico factura↔OC (E3): normalizacion de descripciones,
  similitud de tokens (Jaccard), score ponderado y decision unico/E3.
- `agent-control.ts` — predicado de pausa del agente por alcance global/telefono/pedido
  (control-center.md §Pausa del agente).

## Convenciones de TypeScript (tsconfig.base.json es estricto)

- ESM + `moduleResolution: NodeNext`: los imports relativos llevan extension `.js`
  (aunque el archivo sea `.ts`). Ej: `import { ROLES } from './types.js'`.
- `verbatimModuleSyntax`: usar `import type { Rol } from './types.js'` para tipos.
- `noUncheckedIndexedAccess`: todo acceso por indice puede ser `undefined`; manejarlo.
- `exactOptionalPropertyTypes`: no confundir `prop?: T` con `prop: T | undefined`.

## Reconciliacion de roles (spec)

`data-model.md` fija 5 roles: `superadmin, admin_materiales, admin_equipos, ingeniero,
bodeguero`. `tools.md`/`state-machine.md` usan los nombres de negocio del PDF:
**"Proveeduria" = `admin_materiales`**, **"Gerencia" (lectura amplia / cancelacion) =
`superadmin`**. No existe un rol `gerencia` separado en el esquema. Si esto cambia,
actualizar `data-model.md` §Identidad y este archivo antes de tocar codigo.
