# apps/portal — Centro de Control (React + Vite)

Portal web interno para el personal de la constructora (Atemporal). SPA React 19 + Vite,
sin frameworks CSS. Implementa la ola 1 de `docs/specs/control-center.md`: login, shell con
navegacion por rol, pedidos (lista/filtros/paginacion/detalle/comparativo), proveedores
(CRUD + contactos + opt-in/BAJA), cola de revision (lista + resolver) y la bandeja de
aprobaciones (enviar RFQs, adjudicar ganador, emitir OC(s), historial de `approval_events`).

## Invariantes (no negociables)

1. **Solo `/api/portal/*`**. El portal nunca lee Postgres/Supabase directo ni usa el anon
   key de Supabase (a diferencia de `dashboard/`, que es legado y queda intacto). Todo el
   acceso a datos pasa por `src/api/cliente.ts`.
2. **Cookies httpOnly, nunca tokens en JS**. La sesion (`portal_token` JWT 15 min +
   `portal_refresh` opaco 7 dias) vive en cookies `httpOnly; Secure; SameSite=Strict` que
   pone el servidor. El cliente **jamas** lee, decodifica ni guarda un token — ni en
   `localStorage`, ni en memoria, ni en ningun store. Todo fetch usa
   `credentials: 'include'`; el browser hace el resto.
3. **CSRF**: toda mutacion (`POST`/`PUT`/`PATCH`/`DELETE`) contra `/api/portal/*` agrega el
   header `X-Portal-CSRF: 1`. Esto lo hace `src/api/cliente.ts` automaticamente para
   cualquier metodo mutante — no lo agregues a mano en un componente.
4. **401 → reintento unico por refresh**: `peticion()` en `src/api/cliente.ts` es el unico
   choke point para llamadas autenticadas. Ante un 401 intenta
   `POST /api/portal/auth/refresh` una vez y reintenta la peticion original; si vuelve a
   fallar lanza `SesionExpiradaError`, que las pantallas traducen a "sesion vencida" via
   `useAuth().sesionExpirada()` (nunca un throw silencioso ni un loop de reintentos). El
   login (`login()`) y el propio refresh NO pasan por este mecanismo (un 401 ahi es
   credencial invalida, no sesion vencida).
5. **La matriz de permisos vive en el servidor.** `src/permisos.ts` refleja
   `docs/specs/control-center.md` §Matriz de permisos SOLO para decidir que mostrar u
   ocultar en la UI (nav del Shell, botones de escritura en Proveedores/Revisiones). Nunca
   es la fuente de verdad — si el servidor deniega una accion, la UI debe mostrar el error
   que devuelva, no asumir que el usuario nunca deberia haber llegado ahi.
6. **React + Vite, build a `dist/`**: `npm run build` (= `vite build`) debe seguir
   publicando en `apps/portal/dist/` — `build:all` en la raiz depende de ese contrato.
   `npm run dev` levanta Vite con proxy `/api` → `http://localhost:8080` (ver
   `vite.config.ts`); no pegarle a un backend de produccion desde dev.
7. **Sin fetch fuera de `src/api/cliente.ts`.** Cualquier pantalla nueva que necesite un
   endpoint nuevo agrega una funcion tipada ahi (mismo patron: `peticion<T>(...)`), no un
   `fetch()` suelto en un componente.

## Estructura

- `src/api/cliente.ts` — unico cliente HTTP; tipos de request/response en `src/types.ts`.
- `src/context/` — `AuthContext` (sesion, login/logout/cambio de password) y `ToastContext`
  (avisos globales). `src/utils/manejarError.ts` traduce errores de API a toast +
  deslogueo cuando aplica.
- `src/components/` — `Login`, `CambiarPassword`, `Shell` (nav por rol) y las pantallas por
  dominio (`pedidos/`, `proveedores/`, `revisiones/`), mas `Dialog`/`Toast`/`Paginacion`
  compartidos.
- `src/permisos.ts` — listas de roles por accion, espejo de la matriz de la spec.

## Estado conocido / deuda tecnica de esta ola

- `@types/react`/`@types/react-dom` ya estan instalados y `npm run typecheck` corre
  `tsc --noEmit` limpio (cubierto por el `typecheck` raiz).
  Los imports relativos en `src/` **no** llevan extension `.js` (a diferencia de
  `apps/api`/`apps/worker`/`packages/*`): este paquete usa `moduleResolution: "bundler"`
  porque Vite empaqueta el codigo para el navegador, no lo ejecuta con `node`/NodeNext
  directamente.
- **Bandeja de aprobaciones**: ya implementada en `PedidoDetalle` (`EnviarRfqsPanel`,
  `AdjudicacionPanel`, `EmitirOcPanel`, `HistorialAprobaciones`), gateada por
  `pedido.estado` + `permisos.ROLES_APROBAR_PEDIDOS` (`admin_materiales`, `superadmin`).
  La adjudicacion arma `pedidoItemIds`/`supplierId` desde `comparativo.filas`, que ahora
  incluye esos IDs en el tipo cliente (`src/types.ts`) — la spec (`portal-api.md`) muestra
  la respuesta de `GET .../comparativo` abreviada (`"filas": []`) sin detallar sus campos,
  pero el dominio (`ComparativoCotizacionFila` en `packages/agent`) ya los expone; cuando
  `apps/api` implemente el endpoint debe incluirlos para que este flujo funcione.
- Los endpoints de autenticacion/proveedores/revisiones/aprobaciones se consumen segun el contrato de
  `docs/specs/portal-api.md`; si `apps/api` todavia no los expone, esas pantallas mostraran
  errores de red hasta que se implementen (no es responsabilidad de este paquete).
