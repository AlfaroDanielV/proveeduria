/**
 * Cliente REST del Centro de Control. Habla SOLO con /api/portal/* (nunca Postgres/Supabase
 * directo). Sesion via cookies httpOnly que maneja el browser — este cliente jamas lee ni
 * guarda tokens (docs/specs/control-center.md §Autenticacion).
 */
import type {
  AdjudicacionAsignacion,
  AdjudicarResultado,
  AprobacionesResponse,
  Comparativo,
  Contacto,
  EmitirOcsResultado,
  EnviarRfqsResultado,
  LoginResultado,
  PedidoDetalle,
  PedidosResponse,
  Proveedor,
  ProveedoresResponse,
  RevisionesResponse,
  Usuario,
} from '../types';

const CSRF_HEADER = 'X-Portal-CSRF';
const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Error de red/servidor con el status HTTP y el codigo (`error`) que devuelve la API. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** La sesion no pudo renovarse (refresh tambien devolvio 401): el cliente queda deslogueado. */
export class SesionExpiradaError extends Error {
  constructor() {
    super('sesion_expirada');
    this.name = 'SesionExpiradaError';
  }
}

type QueryValor = string | number | boolean | undefined | null;

export interface PeticionOpciones {
  readonly method?: string;
  readonly body?: unknown;
  readonly query?: Record<string, QueryValor>;
}

function construirUrl(path: string, query?: Record<string, QueryValor>): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [clave, valor] of Object.entries(query)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(clave, String(valor));
  }
  const qs = params.toString();
  return qs === '' ? path : `${path}?${qs}`;
}

/** fetch crudo: agrega credentials + header CSRF en mutaciones. Sin reintento por 401. */
async function ejecutar(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const metodo = (init.method ?? 'GET').toUpperCase();
  if (METODOS_MUTANTES.has(metodo)) {
    headers.set(CSRF_HEADER, '1');
  }
  return fetch(path, { ...init, method: metodo, headers, credentials: 'include' });
}

async function leerCuerpo(res: Response): Promise<unknown> {
  const texto = await res.text();
  if (texto.trim() === '') return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function errorDesde(status: number, cuerpo: unknown): ApiError {
  const datos = (cuerpo ?? {}) as { message?: string; error?: string };
  return new ApiError(status, datos.message ?? datos.error ?? `HTTP ${status}`, datos.error);
}

// Evita que N peticiones en paralelo disparen N refresh (el refresh rota el token: una
// segunda rotacion concurrente invalidaria la sesion nueva de la primera).
let refrescoEnCurso: Promise<boolean> | null = null;

function refrescarSesion(): Promise<boolean> {
  if (refrescoEnCurso === null) {
    refrescoEnCurso = ejecutar('/api/portal/auth/refresh', { method: 'POST' })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refrescoEnCurso = null;
      });
  }
  return refrescoEnCurso;
}

/**
 * Peticion autenticada a /api/portal/*. Ante un 401 intenta refrescar la sesion UNA vez y
 * reintenta la peticion original; si sigue en 401, lanza `SesionExpiradaError` (el llamador
 * debe tratarlo como "quedo deslogueado", no como un error de negocio).
 */
export async function peticion<T>(path: string, opciones: PeticionOpciones = {}): Promise<T> {
  const url = construirUrl(path, opciones.query);
  const init: RequestInit = {
    method: opciones.method ?? 'GET',
    // `exactOptionalPropertyTypes` no permite `body: undefined` explicito: solo se agrega
    // la llave cuando hay cuerpo.
    ...(opciones.body !== undefined ? { body: JSON.stringify(opciones.body) } : {}),
  };

  let res = await ejecutar(url, init);
  if (res.status === 401) {
    const renovada = await refrescarSesion();
    if (renovada) res = await ejecutar(url, init);
  }
  if (res.status === 401) throw new SesionExpiradaError();

  const cuerpo = await leerCuerpo(res);
  if (!res.ok) throw errorDesde(res.status, cuerpo);
  return cuerpo as T;
}

// --- Autenticacion -----------------------------------------------------------

/** No reintenta sobre 401: un login fallido es una credencial invalida, no una sesion vencida. */
export async function login(identificador: string, password: string): Promise<LoginResultado> {
  const res = await ejecutar('/api/portal/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identificador, password }),
  });
  const cuerpo = await leerCuerpo(res);
  if (!res.ok) throw errorDesde(res.status, cuerpo);
  return cuerpo as LoginResultado;
}

export function obtenerMe(): Promise<{ user: Usuario }> {
  return peticion('/api/portal/me');
}

export function logout(): Promise<void> {
  return peticion('/api/portal/auth/logout', { method: 'POST' });
}

export function cambiarPassword(passwordActual: string, passwordNueva: string): Promise<void> {
  return peticion('/api/portal/auth/cambiar-password', {
    method: 'POST',
    body: { passwordActual, passwordNueva },
  });
}

// --- Pedidos -------------------------------------------------------------------

export interface FiltroPedidos {
  readonly estado?: string;
  readonly projectId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export function listarPedidos(filtro: FiltroPedidos = {}): Promise<PedidosResponse> {
  return peticion('/api/portal/pedidos', { query: { ...filtro } });
}

export function obtenerPedido(pedidoId: string): Promise<PedidoDetalle> {
  return peticion(`/api/portal/pedidos/${pedidoId}`);
}

export function obtenerComparativo(pedidoId: string): Promise<Comparativo> {
  return peticion(`/api/portal/pedidos/${pedidoId}/comparativo`);
}

// --- Aprobaciones y acciones de pedido (docs/specs/portal-api.md §Aprobaciones) --------------
//
// Cada mutacion ejecuta la tool del dominio correspondiente dentro de `withTx` con
// `Ctx.origen='web'` y el mismo advisory lock que WhatsApp (ver spec). El portal solo
// consume el contrato REST; no ejecuta SQL de dominio.

export function obtenerAprobaciones(pedidoId: string): Promise<AprobacionesResponse> {
  return peticion(`/api/portal/pedidos/${pedidoId}/aprobaciones`);
}

export interface DatosEnviarRfqs {
  readonly supplierIds: readonly string[];
  readonly plazoHoras: number;
}

/** Bandeja "aprobar lista de proveedores": ejecuta `enviar_rfq` (`borrador -> cotizando`). */
export function enviarRfqs(pedidoId: string, datos: DatosEnviarRfqs): Promise<EnviarRfqsResultado> {
  return peticion(`/api/portal/pedidos/${pedidoId}/rfqs`, { method: 'POST', body: datos });
}

export interface DatosAdjudicar {
  readonly asignaciones: readonly AdjudicacionAsignacion[];
}

/** Adjudicacion desde el comparativo: ejecuta `aprobar_ganador` (`en_revision -> aprobado`). */
export function adjudicar(pedidoId: string, datos: DatosAdjudicar): Promise<AdjudicarResultado> {
  return peticion(`/api/portal/pedidos/${pedidoId}/adjudicacion`, { method: 'POST', body: datos });
}

/** Sin body: la fuente es la adjudicacion registrada. Ejecuta `emitir_oc` (`aprobado -> ordenado`). */
export function emitirOcs(pedidoId: string): Promise<EmitirOcsResultado> {
  return peticion(`/api/portal/pedidos/${pedidoId}/ocs`, { method: 'POST' });
}

// --- Proveedores -----------------------------------------------------------------

export interface FiltroProveedores {
  readonly activo?: boolean;
  readonly q?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export function listarProveedores(filtro: FiltroProveedores = {}): Promise<ProveedoresResponse> {
  return peticion('/api/portal/proveedores', { query: { ...filtro } });
}

export function obtenerProveedor(id: string): Promise<Proveedor> {
  return peticion(`/api/portal/proveedores/${id}`);
}

export interface DatosCrearProveedor {
  readonly nombre: string;
  readonly cedulaJuridica?: string | undefined;
  readonly categorias?: readonly string[] | undefined;
  readonly notas?: string | undefined;
}

export function crearProveedor(datos: DatosCrearProveedor): Promise<Proveedor> {
  return peticion('/api/portal/proveedores', { method: 'POST', body: datos });
}

export interface DatosActualizarProveedor {
  readonly nombre?: string;
  readonly cedulaJuridica?: string | null;
  readonly categorias?: readonly string[];
  readonly notas?: string | null;
  readonly activo?: boolean;
}

export function actualizarProveedor(id: string, datos: DatosActualizarProveedor): Promise<Proveedor> {
  return peticion(`/api/portal/proveedores/${id}`, { method: 'PUT', body: datos });
}

export interface DatosCrearContacto {
  readonly nombre: string;
  readonly telefonoWhatsapp: string;
  readonly esPrincipal?: boolean;
}

export function crearContacto(proveedorId: string, datos: DatosCrearContacto): Promise<Contacto> {
  return peticion(`/api/portal/proveedores/${proveedorId}/contactos`, { method: 'POST', body: datos });
}

export interface DatosActualizarContacto {
  readonly nombre?: string;
  readonly esPrincipal?: boolean;
}

export function actualizarContacto(contactoId: string, datos: DatosActualizarContacto): Promise<Contacto> {
  return peticion(`/api/portal/contactos/${contactoId}`, { method: 'PUT', body: datos });
}

export function optInContacto(contactoId: string): Promise<Contacto> {
  return peticion(`/api/portal/contactos/${contactoId}/optin`, { method: 'POST' });
}

export function bajaContacto(contactoId: string): Promise<Contacto> {
  return peticion(`/api/portal/contactos/${contactoId}/baja`, { method: 'POST' });
}

// --- Cola de revision --------------------------------------------------------------

export interface FiltroRevisiones {
  readonly estado?: string;
  readonly tipo?: string;
  readonly projectId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export function listarRevisiones(filtro: FiltroRevisiones = {}): Promise<RevisionesResponse> {
  return peticion('/api/portal/revisiones', { query: { ...filtro } });
}

export function resolverRevision(id: string, resolucion: string): Promise<void> {
  return peticion(`/api/portal/revisiones/${id}/resolver`, { method: 'POST', body: { resolucion } });
}
