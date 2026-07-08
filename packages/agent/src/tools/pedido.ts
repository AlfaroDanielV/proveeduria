import { err, ok, puedeTransicionar, puedeUsarTool } from '@proveeduria/core';
import type {
  Ctx,
  ErrorTool,
  ItemPedidoInput,
  Pedido,
  PedidoItem,
  Proyecto,
  Proveedor,
  QuoteRequest,
  ResultadoTool,
} from '../runtime/types.js';

export interface CrearPedidoInput {
  readonly projectId: string;
  readonly items: readonly ItemPedidoInput[];
  readonly fechaRequerida?: string;
  readonly urgencia?: string;
}

export interface ResumenPedidoCreado {
  readonly pedidoId: string;
  readonly numero: string;
  readonly estado: 'borrador';
  readonly proyecto: Pick<Proyecto, 'id' | 'nombre' | 'codigo'>;
  readonly items: readonly PedidoItem[];
  readonly fechaRequerida: string | null;
  readonly urgencia: string | null;
}

export interface ConfirmarPedidoInput {
  readonly pedidoId: string;
}

export interface ResumenPedidoConfirmado {
  readonly pedidoId: string;
  readonly numero: string;
  readonly estado: Pedido['estado'];
  readonly confirmadoAt: Date;
  readonly confirmadoPor: string;
  readonly notificaciones: number;
}

export interface SugerirProveedoresInput {
  readonly pedidoId: string;
}

export interface ProveedorSugerido {
  readonly supplierId: string;
  readonly nombre: string;
  readonly categorias: readonly string[];
  readonly contacto: {
    readonly id: string;
    readonly nombre: string | null;
    readonly telefonoWhatsapp: string;
  };
  readonly puntaje: number;
  readonly razones: readonly string[];
  readonly historialCompras: number;
  readonly tasaRespuesta: number | null;
}

export interface ResumenProveedoresSugeridos {
  readonly pedidoId: string;
  readonly numero: string;
  readonly proveedores: readonly ProveedorSugerido[];
}

export interface EnviarRfqInput {
  readonly pedidoId: string;
  readonly supplierIds: readonly string[];
  readonly plazoHoras?: number;
}

export interface ResumenRfqEnviado {
  readonly pedidoId: string;
  readonly numero: string;
  readonly estado: 'cotizando';
  readonly supplierIds: readonly string[];
  readonly quoteRequests: readonly QuoteRequest[];
  readonly plazoAt: Date;
  readonly outbox: number;
}

const errorRol: ErrorTool = {
  codigo: 'rol_insuficiente',
  mensaje: 'No tenes permiso para usar esta herramienta.',
};

function validationError(mensaje: string): ErrorTool {
  return { codigo: 'validacion', mensaje };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseCrearPedidoInput(input: unknown): ResultadoTool<CrearPedidoInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, [
    'projectId',
    'items',
    'fechaRequerida',
    'urgencia',
  ])) {
    return err(validationError('El input de crear_pedido tiene campos invalidos.'));
  }

  if (typeof input.projectId !== 'string' || input.projectId.trim() === '') {
    return err(validationError('Indicame un projectId valido para crear el pedido.'));
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return err(validationError('El pedido debe incluir al menos un item.'));
  }

  const items: ItemPedidoInput[] = [];
  for (const [index, item] of input.items.entries()) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['descripcion', 'cantidad', 'unidad'])) {
      return err(validationError(`El item ${index + 1} tiene campos invalidos.`));
    }
    if (typeof item.descripcion !== 'string' || item.descripcion.trim() === '') {
      return err(validationError(`El item ${index + 1} necesita descripcion.`));
    }
    if (
      typeof item.cantidad !== 'number' ||
      !Number.isFinite(item.cantidad) ||
      item.cantidad <= 0
    ) {
      return err(validationError(`La cantidad del item ${index + 1} debe ser mayor que 0.`));
    }
    if (typeof item.unidad !== 'string' || item.unidad.trim() === '') {
      return err(validationError(`El item ${index + 1} necesita unidad.`));
    }
    items.push({
      descripcion: item.descripcion.trim(),
      cantidad: item.cantidad,
      unidad: item.unidad.trim(),
    });
  }

  const parsed: {
    projectId: string;
    items: readonly ItemPedidoInput[];
    fechaRequerida?: string;
    urgencia?: string;
  } = {
    projectId: input.projectId.trim(),
    items,
  };

  if (input.fechaRequerida !== undefined) {
    if (
      typeof input.fechaRequerida !== 'string' ||
      input.fechaRequerida.trim() === '' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.fechaRequerida)
    ) {
      return err(validationError('fechaRequerida debe venir en formato YYYY-MM-DD.'));
    }
    parsed.fechaRequerida = input.fechaRequerida;
  }

  if (input.urgencia !== undefined) {
    if (typeof input.urgencia !== 'string' || input.urgencia.trim() === '') {
      return err(validationError('urgencia debe ser texto no vacio.'));
    }
    parsed.urgencia = input.urgencia.trim();
  }

  return ok(parsed);
}

function parseConfirmarPedidoInput(input: unknown): ResultadoTool<ConfirmarPedidoInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pedidoId'])) {
    return err(validationError('El input de confirmar_pedido tiene campos invalidos.'));
  }
  if (typeof input.pedidoId !== 'string' || input.pedidoId.trim() === '') {
    return err(validationError('Indicame un pedidoId valido para confirmar el pedido.'));
  }
  return ok({ pedidoId: input.pedidoId.trim() });
}

function parseSugerirProveedoresInput(input: unknown): ResultadoTool<SugerirProveedoresInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pedidoId'])) {
    return err(validationError('El input de sugerir_proveedores tiene campos invalidos.'));
  }
  if (typeof input.pedidoId !== 'string' || input.pedidoId.trim() === '') {
    return err(validationError('Indicame un pedidoId valido para sugerir proveedores.'));
  }
  return ok({ pedidoId: input.pedidoId.trim() });
}

function parseEnviarRfqInput(input: unknown): ResultadoTool<EnviarRfqInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pedidoId', 'supplierIds', 'plazoHoras'])) {
    return err(validationError('El input de enviar_rfq tiene campos invalidos.'));
  }
  if (typeof input.pedidoId !== 'string' || input.pedidoId.trim() === '') {
    return err(validationError('Indicame un pedidoId valido para enviar RFQ.'));
  }
  if (!Array.isArray(input.supplierIds) || input.supplierIds.length === 0) {
    return err(validationError('Selecciona al menos un proveedor para enviar RFQ.'));
  }
  const supplierIds = input.supplierIds.map((supplierId) => {
    if (typeof supplierId !== 'string') return '';
    return supplierId.trim();
  });
  if (supplierIds.some((supplierId) => supplierId === '')) {
    return err(validationError('Todos los supplierIds deben ser texto no vacio.'));
  }
  if (new Set(supplierIds).size !== supplierIds.length) {
    return err(validationError('La lista de proveedores no debe repetir supplierIds.'));
  }

  const parsed: {
    pedidoId: string;
    supplierIds: readonly string[];
    plazoHoras?: number;
  } = {
    pedidoId: input.pedidoId.trim(),
    supplierIds,
  };
  if (input.plazoHoras !== undefined) {
    if (
      typeof input.plazoHoras !== 'number' ||
      !Number.isFinite(input.plazoHoras) ||
      input.plazoHoras <= 0
    ) {
      return err(validationError('plazoHoras debe ser un numero mayor que 0.'));
    }
    parsed.plazoHoras = input.plazoHoras;
  }
  return ok(parsed);
}

function normalizarTexto(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function puntuarProveedor(
  proveedor: Proveedor,
  items: readonly PedidoItem[],
): ProveedorSugerido | null {
  const contacto = proveedor.contactoPrincipal;
  if (contacto === null || contacto.optinAt === null) return null;

  const textoItems = normalizarTexto(items.map((item) => item.descripcion).join(' '));
  const categoriasMatched = proveedor.categorias.filter((categoria) => (
    categoria.trim() !== '' && textoItems.includes(normalizarTexto(categoria))
  ));
  const razones = categoriasMatched.map((categoria) => `categoria: ${categoria}`);
  if (razones.length === 0) {
    razones.push('proveedor activo con contacto opt-in');
  }

  return {
    supplierId: proveedor.id,
    nombre: proveedor.nombre,
    categorias: proveedor.categorias,
    contacto: {
      id: contacto.id,
      nombre: contacto.nombre,
      telefonoWhatsapp: contacto.telefonoWhatsapp,
    },
    puntaje: categoriasMatched.length * 10,
    razones,
    historialCompras: 0,
    tasaRespuesta: null,
  };
}

function detalleItems(items: readonly PedidoItem[]): string {
  return items
    .map((item, index) => `${index + 1}. ${item.descripcion} - ${item.cantidad} ${item.unidad}`)
    .join('\n');
}

function canalAprobacionDesdeCtx(ctx: Ctx): 'whatsapp' | 'web' {
  return ctx.origen === 'web' ? 'web' : 'whatsapp';
}

export async function crearPedido(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenPedidoCreado>> {
  if (!puedeUsarTool('crear_pedido', ctx.actor.roles)) return err(errorRol);

  const parsed = parseCrearPedidoInput(input);
  if (!parsed.ok) return parsed;

  const proyecto = await ctx.repos.proyectos.activoPorId(parsed.value.projectId);
  if (proyecto === null) {
    return err({
      codigo: 'E7',
      mensaje: 'No logre identificar un proyecto activo. Decime para cual proyecto es el pedido.',
    });
  }

  const numero = await ctx.repos.pedidos.siguienteNumeroPedido(ctx.ahora);
  const pedido = await ctx.repos.pedidos.crear({
    numero,
    projectId: proyecto.id,
    solicitanteUserId: ctx.actor.userId,
    fechaRequerida: parsed.value.fechaRequerida ?? null,
    urgencia: parsed.value.urgencia ?? null,
  });
  const items = await ctx.repos.pedidoItems.insertarMuchos(pedido.id, parsed.value.items);

  await ctx.audit({
    accion: 'crear_pedido',
    entidad: 'pedido',
    entidadId: pedido.id,
    pedidoId: pedido.id,
    antes: null,
    despues: { pedido, items },
  });

  return ok({
    pedidoId: pedido.id,
    numero: pedido.numero,
    estado: 'borrador',
    proyecto: {
      id: proyecto.id,
      nombre: proyecto.nombre,
      codigo: proyecto.codigo,
    },
    items,
    fechaRequerida: pedido.fechaRequerida,
    urgencia: pedido.urgencia,
  });
}

export async function sugerirProveedores(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenProveedoresSugeridos>> {
  if (!puedeUsarTool('sugerir_proveedores', ctx.actor.roles)) return err(errorRol);

  const parsed = parseSugerirProveedoresInput(input);
  if (!parsed.ok) return parsed;

  const pedido = await ctx.repos.pedidos.porId(parsed.value.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre ese pedido para sugerir proveedores.',
    });
  }

  const items = await ctx.repos.pedidoItems.porPedido(pedido.id);
  if (items.length === 0) {
    return err(validationError('El pedido no tiene items para sugerir proveedores.'));
  }

  const proveedores = await ctx.repos.proveedores.activosConContactoOptIn();
  const sugeridos = proveedores
    .map((proveedor) => puntuarProveedor(proveedor, items))
    .filter((proveedor): proveedor is ProveedorSugerido => proveedor !== null)
    .sort((a, b) => b.puntaje - a.puntaje || a.nombre.localeCompare(b.nombre));

  await ctx.audit({
    accion: 'sugerir_proveedores',
    entidad: 'pedido',
    entidadId: pedido.id,
    pedidoId: pedido.id,
    antes: null,
    despues: {
      pedido_id: pedido.id,
      sugerencias: sugeridos.map((proveedor) => ({
        supplier_id: proveedor.supplierId,
        puntaje: proveedor.puntaje,
        razones: proveedor.razones,
      })),
    },
  });

  return ok({
    pedidoId: pedido.id,
    numero: pedido.numero,
    proveedores: sugeridos,
  });
}

export async function enviarRfq(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenRfqEnviado>> {
  if (!puedeUsarTool('enviar_rfq', ctx.actor.roles)) return err(errorRol);

  const parsed = parseEnviarRfqInput(input);
  if (!parsed.ok) return parsed;

  const pedido = await ctx.repos.pedidos.bloquearPorId(parsed.value.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre ese pedido para enviar RFQ.',
    });
  }

  const transicion = puedeTransicionar(pedido.estado, 'cotizando');
  if (!transicion.ok) return err(transicion.error);

  const items = await ctx.repos.pedidoItems.porPedido(pedido.id);
  if (items.length === 0) {
    return err(validationError('El pedido no tiene items para enviar RFQ.'));
  }

  const proveedores = await ctx.repos.proveedores.porIdsConContactoOptIn(parsed.value.supplierIds);
  const encontrados = new Set(proveedores.map((proveedor) => proveedor.id));
  const faltantes = parsed.value.supplierIds.filter((supplierId) => !encontrados.has(supplierId));
  if (faltantes.length > 0) {
    return err(validationError(
      `Hay proveedores inexistentes, inactivos o sin contacto opt-in: ${faltantes.join(', ')}.`,
    ));
  }

  const proyecto = await ctx.repos.proyectos.porId(pedido.projectId);
  if (proyecto === null) {
    return err(validationError('El proyecto del pedido ya no existe.'));
  }

  const plazoHoras = parsed.value.plazoHoras ?? 24;
  const plazoAt = new Date(ctx.ahora.getTime() + plazoHoras * 60 * 60 * 1000);
  const quoteRequests: QuoteRequest[] = [];
  for (const proveedor of proveedores) {
    quoteRequests.push(await ctx.repos.quoteRequests.crear({
      pedidoId: pedido.id,
      supplierId: proveedor.id,
      plazoAt,
    }));
  }

  await ctx.approval({
    tipo: 'lista_proveedores',
    pedidoId: pedido.id,
    canal: canalAprobacionDesdeCtx(ctx),
    detalle: {
      supplier_ids: parsed.value.supplierIds,
      plazo_horas: plazoHoras,
      plazo_at: plazoAt.toISOString(),
    },
  });

  const actualizado = await ctx.repos.pedidos.marcarCotizando(pedido.id, plazoAt);

  await ctx.audit({
    accion: 'enviar_rfq',
    entidad: 'pedido',
    entidadId: pedido.id,
    pedidoId: pedido.id,
    antes: pedido,
    despues: {
      pedido: actualizado,
      quote_requests: quoteRequests,
    },
  });

  const itemsTexto = detalleItems(items);
  for (const proveedor of proveedores) {
    const contacto = proveedor.contactoPrincipal;
    if (contacto === null) continue;
    const quoteRequest = quoteRequests.find((qr) => qr.supplierId === proveedor.id);
    await ctx.outbox({
      destino: contacto.telefonoWhatsapp,
      template: 'rfq_solicitud',
      payload: {
        variables: [
          contacto.nombre ?? proveedor.nombre,
          proyecto.nombre,
          itemsTexto,
          plazoAt.toISOString(),
          pedido.numero,
        ],
        pedido_id: pedido.id,
        supplier_id: proveedor.id,
        quote_request_id: quoteRequest?.id ?? null,
      },
    });
  }

  return ok({
    pedidoId: actualizado.id,
    numero: actualizado.numero,
    estado: 'cotizando',
    supplierIds: parsed.value.supplierIds,
    quoteRequests,
    plazoAt,
    outbox: proveedores.length,
  });
}

export async function confirmarPedido(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenPedidoConfirmado>> {
  if (!puedeUsarTool('confirmar_pedido', ctx.actor.roles)) return err(errorRol);

  const parsed = parseConfirmarPedidoInput(input);
  if (!parsed.ok) return parsed;

  const pedido = await ctx.repos.pedidos.porId(parsed.value.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre ese pedido para confirmar.',
    });
  }

  if (pedido.solicitanteUserId !== ctx.actor.userId) {
    return err({
      codigo: 'rol_insuficiente',
      mensaje: 'Solo el solicitante original puede confirmar este pedido.',
    });
  }

  if (pedido.estado !== 'borrador') {
    return err({
      codigo: 'E12',
      mensaje: `El pedido ${pedido.numero} esta en estado "${pedido.estado}" y ya no puede confirmarse como borrador.`,
    });
  }

  const confirmado = await ctx.repos.pedidos.confirmar(
    pedido.id,
    ctx.ahora,
    ctx.actor.userId,
  );

  await ctx.audit({
    accion: 'confirmar_pedido',
    entidad: 'pedido',
    entidadId: confirmado.id,
    pedidoId: confirmado.id,
    antes: pedido,
    despues: confirmado,
  });

  const admins = await ctx.repos.usuarios.activosPorRol('admin_materiales');
  for (const admin of admins) {
    await ctx.outbox({
      destino: admin.telefonoWhatsapp,
      template: 'notificacion_interna',
      payload: {
        variables: [
          admin.nombre,
          `Pedido ${confirmado.numero} confirmado por ${ctx.actor.nombre}.`,
        ],
        pedido_id: confirmado.id,
      },
    });
  }

  return ok({
    pedidoId: confirmado.id,
    numero: confirmado.numero,
    estado: confirmado.estado,
    confirmadoAt: ctx.ahora,
    confirmadoPor: ctx.actor.userId,
    notificaciones: admins.length,
  });
}
