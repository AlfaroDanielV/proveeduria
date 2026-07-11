/**
 * Handlers puros de mutaciones de Proveedores del portal (docs/specs/portal-api.md
 * §Proveedores; docs/specs/control-center.md §CRUD proveedores). Reciben el actor ya
 * autenticado/autorizado y el `ProveedoresStore` inyectado; no tocan `node:http` ni
 * Postgres directamente (mismo patron que `auth-routes.ts`).
 */

import type {
  ActualizarContactoInput,
  ActualizarProveedorInput,
  NuevoContactoInput,
  NuevoProveedorInput,
  PortalActor,
  ProveedoresStore,
} from './types.js';

export interface ProveedorRouteResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body?: unknown;
}

function json(status: number, body: unknown): ProveedorRouteResponse {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
}

const RE_E164 = /^\+[1-9]\d{6,14}$/;

function esTelefonoE164(value: string): boolean {
  return RE_E164.test(value);
}

function comoTextoNoVacio(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export async function manejarCrearProveedor(
  actor: PortalActor,
  body: unknown,
  store: ProveedoresStore,
  ahora: Date,
): Promise<ProveedorRouteResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const nombre = comoTextoNoVacio(b.nombre);
  if (nombre === null) {
    return json(400, { error: 'request_invalido', message: 'nombre es requerido.' });
  }
  if (b.cedulaJuridica !== undefined && b.cedulaJuridica !== null && typeof b.cedulaJuridica !== 'string') {
    return json(400, { error: 'request_invalido', message: 'cedulaJuridica debe ser texto.' });
  }
  if (b.categorias !== undefined && (!Array.isArray(b.categorias) || !b.categorias.every((v) => typeof v === 'string'))) {
    return json(400, { error: 'request_invalido', message: 'categorias debe ser un arreglo de texto.' });
  }
  if (b.notas !== undefined && b.notas !== null && typeof b.notas !== 'string') {
    return json(400, { error: 'request_invalido', message: 'notas debe ser texto.' });
  }

  const input: NuevoProveedorInput = {
    nombre,
    cedulaJuridica: (b.cedulaJuridica as string | null | undefined) ?? null,
    categorias: (b.categorias as readonly string[] | undefined) ?? [],
    notas: (b.notas as string | null | undefined) ?? null,
  };

  const proveedor = await store.crear(actor, input, ahora);
  return json(201, proveedor);
}

export async function manejarActualizarProveedor(
  actor: PortalActor,
  supplierId: string,
  body: unknown,
  store: ProveedoresStore,
  ahora: Date,
): Promise<ProveedorRouteResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const input: {
    nombre?: string;
    cedulaJuridica?: string | null;
    categorias?: readonly string[];
    notas?: string | null;
    activo?: boolean;
  } = {};

  if (b.nombre !== undefined) {
    if (typeof b.nombre !== 'string' || b.nombre.trim() === '') {
      return json(400, { error: 'request_invalido', message: 'nombre no puede estar vacio.' });
    }
    input.nombre = b.nombre;
  }
  if (b.cedulaJuridica !== undefined) {
    if (b.cedulaJuridica !== null && typeof b.cedulaJuridica !== 'string') {
      return json(400, { error: 'request_invalido', message: 'cedulaJuridica debe ser texto o null.' });
    }
    input.cedulaJuridica = b.cedulaJuridica;
  }
  if (b.categorias !== undefined) {
    if (!Array.isArray(b.categorias) || !b.categorias.every((v) => typeof v === 'string')) {
      return json(400, { error: 'request_invalido', message: 'categorias debe ser un arreglo de texto.' });
    }
    input.categorias = b.categorias;
  }
  if (b.notas !== undefined) {
    if (b.notas !== null && typeof b.notas !== 'string') {
      return json(400, { error: 'request_invalido', message: 'notas debe ser texto o null.' });
    }
    input.notas = b.notas;
  }
  if (b.activo !== undefined) {
    if (typeof b.activo !== 'boolean') {
      return json(400, { error: 'request_invalido', message: 'activo debe ser booleano.' });
    }
    input.activo = b.activo;
  }

  const proveedor = await store.actualizar(actor, supplierId, input as ActualizarProveedorInput, ahora);
  return proveedor === null ? json(404, { error: 'proveedor_no_encontrado' }) : json(200, proveedor);
}

export async function manejarCrearContacto(
  actor: PortalActor,
  supplierId: string,
  body: unknown,
  store: ProveedoresStore,
  ahora: Date,
): Promise<ProveedorRouteResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const telefonoWhatsapp = comoTextoNoVacio(b.telefonoWhatsapp);
  if (telefonoWhatsapp === null || !esTelefonoE164(telefonoWhatsapp)) {
    return json(400, {
      error: 'request_invalido',
      message: 'telefonoWhatsapp debe ser E.164 valido (ej. +50688880000).',
    });
  }
  if (b.nombre !== undefined && b.nombre !== null && typeof b.nombre !== 'string') {
    return json(400, { error: 'request_invalido', message: 'nombre debe ser texto.' });
  }
  if (b.esPrincipal !== undefined && typeof b.esPrincipal !== 'boolean') {
    return json(400, { error: 'request_invalido', message: 'esPrincipal debe ser booleano.' });
  }

  const input: NuevoContactoInput = {
    nombre: (b.nombre as string | null | undefined) ?? null,
    telefonoWhatsapp,
    esPrincipal: (b.esPrincipal as boolean | undefined) ?? false,
  };

  const resultado = await store.crearContacto(actor, supplierId, input, ahora);
  if (!resultado.ok) {
    return resultado.error === 'no_encontrado'
      ? json(404, { error: 'proveedor_no_encontrado' })
      : json(409, { error: 'telefono_duplicado' });
  }
  return json(201, resultado.value);
}

export async function manejarActualizarContacto(
  actor: PortalActor,
  contactoId: string,
  body: unknown,
  store: ProveedoresStore,
  ahora: Date,
): Promise<ProveedorRouteResponse> {
  const b = (body ?? {}) as Record<string, unknown>;
  const input: { nombre?: string | null; esPrincipal?: boolean } = {};

  if (b.nombre !== undefined) {
    if (b.nombre !== null && typeof b.nombre !== 'string') {
      return json(400, { error: 'request_invalido', message: 'nombre debe ser texto o null.' });
    }
    input.nombre = b.nombre;
  }
  if (b.esPrincipal !== undefined) {
    if (typeof b.esPrincipal !== 'boolean') {
      return json(400, { error: 'request_invalido', message: 'esPrincipal debe ser booleano.' });
    }
    input.esPrincipal = b.esPrincipal;
  }

  const contacto = await store.actualizarContacto(actor, contactoId, input as ActualizarContactoInput, ahora);
  return contacto === null ? json(404, { error: 'contacto_no_encontrado' }) : json(200, contacto);
}

export async function manejarOptinContacto(
  actor: PortalActor,
  contactoId: string,
  store: ProveedoresStore,
  ahora: Date,
): Promise<ProveedorRouteResponse> {
  const contacto = await store.optinContacto(actor, contactoId, ahora);
  return contacto === null ? json(404, { error: 'contacto_no_encontrado' }) : json(200, contacto);
}

export async function manejarBajaContacto(
  actor: PortalActor,
  contactoId: string,
  store: ProveedoresStore,
  ahora: Date,
): Promise<ProveedorRouteResponse> {
  const contacto = await store.bajaContacto(actor, contactoId, ahora);
  return contacto === null ? json(404, { error: 'contacto_no_encontrado' }) : json(200, contacto);
}
