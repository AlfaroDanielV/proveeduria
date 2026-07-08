import {
  cotizacionIncompleta,
  err,
  excedioRepreguntas,
  FUENTES_EXTRACCION,
  ok,
  puedeTransicionar,
  puedeUsarTool,
} from '@proveeduria/core';
import type { FuenteExtraccion } from '@proveeduria/core';
import type {
  Ctx,
  ErrorTool,
  ComparativoCotizacionFila,
  ItemPedidoInput,
  Pedido,
  PedidoItem,
  Proyecto,
  Proveedor,
  QuoteItem,
  QuoteItemInput,
  QuoteRequest,
  QuoteResponse,
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

export interface RegistrarCotizacionItemInput {
  readonly pedidoItemId?: string;
  readonly precioUnitario?: number | null;
  readonly cantidad?: number | null;
  readonly disponible?: boolean | null;
  readonly notas?: string;
}

export interface RegistrarCotizacionInput {
  readonly quoteRequestId: string;
  readonly fuente: FuenteExtraccion;
  readonly condiciones?: string;
  readonly plazoEntrega?: string;
  readonly confianzaExtraccion: number;
  readonly items: readonly RegistrarCotizacionItemInput[];
}

export interface GenerarComparativoInput {
  readonly pedidoId: string;
}

export interface ComparativoProveedorResumen {
  readonly supplierId: string;
  readonly nombre: string;
  readonly quoteRequestId: string;
  readonly quoteRequestEstado: QuoteRequest['estado'];
  readonly quoteResponseId: string | null;
  readonly condiciones: string | null;
  readonly plazoEntrega: string | null;
  readonly total: number;
  readonly itemsCotizados: number;
  readonly itemsFaltantes: number;
}

export interface ResumenComparativoGenerado {
  readonly pedidoId: string;
  readonly numero: string;
  readonly estado: 'en_revision';
  readonly filas: readonly ComparativoCotizacionFila[];
  readonly resumenProveedores: readonly ComparativoProveedorResumen[];
  readonly portalPath: string;
  readonly notificaciones: number;
}

export interface ResumenCotizacionRegistrada {
  readonly quoteRequestId: string;
  readonly quoteResponse: QuoteResponse;
  readonly items: readonly QuoteItem[];
  readonly pedidoId: string;
  readonly pedidoEstado: Pedido['estado'];
  readonly transicionoAEnRevision: boolean;
  readonly comparativo: ResumenComparativoGenerado | null;
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

function parseRegistrarCotizacionInput(input: unknown): ResultadoTool<RegistrarCotizacionInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, [
    'quoteRequestId',
    'fuente',
    'condiciones',
    'plazoEntrega',
    'confianzaExtraccion',
    'items',
  ])) {
    return err(validationError('El input de registrar_cotizacion tiene campos invalidos.'));
  }

  if (typeof input.quoteRequestId !== 'string' || input.quoteRequestId.trim() === '') {
    return err(validationError('Indicame un quoteRequestId valido para registrar la cotizacion.'));
  }
  if (
    typeof input.fuente !== 'string' ||
    !(FUENTES_EXTRACCION as readonly string[]).includes(input.fuente)
  ) {
    return err(validationError('fuente debe ser texto, imagen, pdf o audio.'));
  }
  if (
    typeof input.confianzaExtraccion !== 'number' ||
    !Number.isFinite(input.confianzaExtraccion) ||
    input.confianzaExtraccion < 0 ||
    input.confianzaExtraccion > 1
  ) {
    return err(validationError('confianzaExtraccion debe estar entre 0 y 1.'));
  }
  if (!Array.isArray(input.items)) {
    return err(validationError('items debe ser una lista.'));
  }

  const parsedItems: RegistrarCotizacionItemInput[] = [];
  for (const [index, item] of input.items.entries()) {
    if (!isRecord(item) || !hasOnlyKeys(item, [
      'pedidoItemId',
      'precioUnitario',
      'cantidad',
      'disponible',
      'notas',
    ])) {
      return err(validationError(`El item cotizado ${index + 1} tiene campos invalidos.`));
    }
    const parsedItem: {
      pedidoItemId?: string;
      precioUnitario?: number | null;
      cantidad?: number | null;
      disponible?: boolean | null;
      notas?: string;
    } = {};
    if (item.pedidoItemId !== undefined) {
      if (typeof item.pedidoItemId !== 'string' || item.pedidoItemId.trim() === '') {
        return err(validationError(`pedidoItemId del item cotizado ${index + 1} es invalido.`));
      }
      parsedItem.pedidoItemId = item.pedidoItemId.trim();
    }
    if (item.precioUnitario !== undefined) {
      if (
        item.precioUnitario !== null &&
        (typeof item.precioUnitario !== 'number' || !Number.isFinite(item.precioUnitario))
      ) {
        return err(validationError(`precioUnitario del item cotizado ${index + 1} es invalido.`));
      }
      parsedItem.precioUnitario = item.precioUnitario;
    }
    if (item.cantidad !== undefined) {
      if (
        item.cantidad !== null &&
        (typeof item.cantidad !== 'number' || !Number.isFinite(item.cantidad))
      ) {
        return err(validationError(`cantidad del item cotizado ${index + 1} es invalida.`));
      }
      parsedItem.cantidad = item.cantidad;
    }
    if (item.disponible !== undefined) {
      if (item.disponible !== null && typeof item.disponible !== 'boolean') {
        return err(validationError(`disponible del item cotizado ${index + 1} es invalido.`));
      }
      parsedItem.disponible = item.disponible;
    }
    if (item.notas !== undefined) {
      if (typeof item.notas !== 'string') {
        return err(validationError(`notas del item cotizado ${index + 1} debe ser texto.`));
      }
      parsedItem.notas = item.notas.trim();
    }
    parsedItems.push(parsedItem);
  }

  const parsed: {
    quoteRequestId: string;
    fuente: FuenteExtraccion;
    confianzaExtraccion: number;
    items: readonly RegistrarCotizacionItemInput[];
    condiciones?: string;
    plazoEntrega?: string;
  } = {
    quoteRequestId: input.quoteRequestId.trim(),
    fuente: input.fuente as FuenteExtraccion,
    confianzaExtraccion: input.confianzaExtraccion,
    items: parsedItems,
  };

  if (input.condiciones !== undefined) {
    if (typeof input.condiciones !== 'string') {
      return err(validationError('condiciones debe ser texto.'));
    }
    parsed.condiciones = input.condiciones.trim();
  }
  if (input.plazoEntrega !== undefined) {
    if (typeof input.plazoEntrega !== 'string') {
      return err(validationError('plazoEntrega debe ser texto.'));
    }
    parsed.plazoEntrega = input.plazoEntrega.trim();
  }

  return ok(parsed);
}

function parseGenerarComparativoInput(input: unknown): ResultadoTool<GenerarComparativoInput> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pedidoId'])) {
    return err(validationError('El input de generar_comparativo tiene campos invalidos.'));
  }
  if (typeof input.pedidoId !== 'string' || input.pedidoId.trim() === '') {
    return err(validationError('Indicame un pedidoId valido para generar el comparativo.'));
  }
  return ok({ pedidoId: input.pedidoId.trim() });
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

function toQuoteItemInput(item: RegistrarCotizacionItemInput): QuoteItemInput {
  return {
    pedidoItemId: item.pedidoItemId ?? null,
    precioUnitario: item.precioUnitario ?? null,
    cantidad: item.cantidad ?? null,
    disponible: item.disponible ?? null,
    notas: item.notas ?? null,
  };
}

async function notificarAdmins(
  ctx: Ctx,
  pedidoId: string,
  resumen: string,
  payloadExtra?: Record<string, unknown>,
): Promise<number> {
  const admins = await ctx.repos.usuarios.activosPorRol('admin_materiales');
  for (const admin of admins) {
    await ctx.outbox({
      destino: admin.telefonoWhatsapp,
      template: 'notificacion_interna',
      payload: {
        variables: [admin.nombre, resumen],
        pedido_id: pedidoId,
        ...(payloadExtra ?? {}),
      },
    });
  }
  return admins.length;
}

function portalPathComparativo(pedidoId: string): string {
  return `/pedidos/${pedidoId}/comparativo`;
}

function formatCRC(value: number): string {
  return `CRC ${value.toFixed(2)}`;
}

function resumirProveedores(
  filas: readonly ComparativoCotizacionFila[],
): readonly ComparativoProveedorResumen[] {
  const porProveedor = new Map<string, {
    supplierId: string;
    nombre: string;
    quoteRequestId: string;
    quoteRequestEstado: QuoteRequest['estado'];
    quoteResponseId: string | null;
    condiciones: string | null;
    plazoEntrega: string | null;
    total: number;
    itemsCotizados: number;
    itemsFaltantes: number;
  }>();

  for (const fila of filas) {
    const actual = porProveedor.get(fila.supplierId) ?? {
      supplierId: fila.supplierId,
      nombre: fila.proveedor,
      quoteRequestId: fila.quoteRequestId,
      quoteRequestEstado: fila.quoteRequestEstado,
      quoteResponseId: fila.quoteResponseId,
      condiciones: fila.condiciones,
      plazoEntrega: fila.plazoEntrega,
      total: 0,
      itemsCotizados: 0,
      itemsFaltantes: 0,
    };

    actual.total += fila.subtotal ?? 0;
    if (fila.faltante) {
      actual.itemsFaltantes += 1;
    } else {
      actual.itemsCotizados += 1;
    }
    if (actual.quoteResponseId === null && fila.quoteResponseId !== null) {
      actual.quoteResponseId = fila.quoteResponseId;
      actual.condiciones = fila.condiciones;
      actual.plazoEntrega = fila.plazoEntrega;
    }

    porProveedor.set(fila.supplierId, actual);
  }

  return [...porProveedor.values()].sort((a, b) => (
    a.itemsFaltantes - b.itemsFaltantes ||
    a.total - b.total ||
    a.nombre.localeCompare(b.nombre)
  ));
}

function resumenCortoComparativo(
  pedido: Pedido,
  resumenProveedores: readonly ComparativoProveedorResumen[],
): string {
  const proveedores = resumenProveedores
    .slice(0, 3)
    .map((proveedor) => (
      `${proveedor.nombre}: ${formatCRC(proveedor.total)}, ` +
      `${proveedor.itemsFaltantes} faltantes`
    ))
    .join('; ');
  return `Comparativo ${pedido.numero} listo. ${proveedores}`;
}

function payloadComparativo(
  pedido: Pedido,
  filas: readonly ComparativoCotizacionFila[],
  resumenProveedores: readonly ComparativoProveedorResumen[],
  portalPath: string,
  generadoAt: Date,
): Record<string, unknown> {
  return {
    portal_path: portalPath,
    comparativo: {
      pedido_id: pedido.id,
      numero: pedido.numero,
      generado_at: generadoAt.toISOString(),
      resumen_proveedores: resumenProveedores.map((proveedor) => ({
        supplier_id: proveedor.supplierId,
        nombre: proveedor.nombre,
        quote_request_id: proveedor.quoteRequestId,
        quote_request_estado: proveedor.quoteRequestEstado,
        quote_response_id: proveedor.quoteResponseId,
        condiciones: proveedor.condiciones,
        plazo_entrega: proveedor.plazoEntrega,
        total: proveedor.total,
        items_cotizados: proveedor.itemsCotizados,
        items_faltantes: proveedor.itemsFaltantes,
      })),
      filas: filas.map((fila) => ({
        pedido_item_id: fila.pedidoItemId,
        descripcion: fila.descripcion,
        cantidad_solicitada: fila.cantidadSolicitada,
        unidad: fila.unidad,
        supplier_id: fila.supplierId,
        proveedor: fila.proveedor,
        quote_request_id: fila.quoteRequestId,
        quote_request_estado: fila.quoteRequestEstado,
        quote_response_id: fila.quoteResponseId,
        precio_unitario: fila.precioUnitario,
        cantidad_cotizada: fila.cantidadCotizada,
        disponible: fila.disponible,
        condiciones: fila.condiciones,
        plazo_entrega: fila.plazoEntrega,
        subtotal: fila.subtotal,
        faltante: fila.faltante,
        notas: fila.notas,
      })),
    },
  };
}

async function generarComparativoParaPedido(
  pedido: Pedido,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenComparativoGenerado>> {
  const filas = await ctx.repos.comparativos.porPedido(pedido.id);
  if (filas.length === 0) {
    return err(validationError('El pedido no tiene RFQs/cotizaciones para generar comparativo.'));
  }

  const resumenProveedores = resumirProveedores(filas);
  const portalPath = portalPathComparativo(pedido.id);

  await ctx.audit({
    accion: 'generar_comparativo',
    entidad: 'pedido',
    entidadId: pedido.id,
    pedidoId: pedido.id,
    antes: null,
    despues: {
      pedido_id: pedido.id,
      resumen_proveedores: resumenProveedores,
      filas,
      portal_path: portalPath,
    },
  });

  const notificaciones = await notificarAdmins(
    ctx,
    pedido.id,
    resumenCortoComparativo(pedido, resumenProveedores),
    payloadComparativo(pedido, filas, resumenProveedores, portalPath, ctx.ahora),
  );

  return ok({
    pedidoId: pedido.id,
    numero: pedido.numero,
    estado: 'en_revision',
    filas,
    resumenProveedores,
    portalPath,
    notificaciones,
  });
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

export async function registrarCotizacion(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenCotizacionRegistrada>> {
  if (!puedeUsarTool('registrar_cotizacion', ctx.actor.roles)) return err(errorRol);

  const parsed = parseRegistrarCotizacionInput(input);
  if (!parsed.ok) return parsed;

  const quoteRequest = await ctx.repos.quoteRequests.bloquearPorId(parsed.value.quoteRequestId);
  if (quoteRequest === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre esa solicitud de cotizacion.',
    });
  }
  if (quoteRequest.estado !== 'enviada') {
    return err(validationError(`La solicitud de cotizacion ya esta en estado "${quoteRequest.estado}".`));
  }

  const pedido = await ctx.repos.pedidos.bloquearPorId(quoteRequest.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre el pedido asociado a la cotizacion.',
    });
  }
  if (pedido.estado !== 'cotizando') {
    return err({
      codigo: 'E12',
      mensaje: `El pedido ${pedido.numero} esta en estado "${pedido.estado}" y no puede recibir cotizaciones.`,
    });
  }

  const pedidoItems = await ctx.repos.pedidoItems.porPedido(pedido.id);
  const pedidoItemIds = new Set(pedidoItems.map((item) => item.id));
  const itemAjeno = parsed.value.items.find((item) => (
    item.pedidoItemId !== undefined && !pedidoItemIds.has(item.pedidoItemId)
  ));
  if (itemAjeno !== undefined) {
    return err(validationError(`El pedido_item_id ${itemAjeno.pedidoItemId} no pertenece al pedido.`));
  }

  const umbrales = await ctx.repos.config.umbrales();
  const quoteItemInputs = parsed.value.items.map(toQuoteItemInput);
  const esIncompleta = cotizacionIncompleta(
    quoteItemInputs.map((item) => ({
      precioUnitario: item.precioUnitario,
      cantidad: item.cantidad,
    })),
    parsed.value.confianzaExtraccion,
    umbrales,
  );
  const intentosPrevios = await ctx.repos.quoteResponses.contarIncompletas(quoteRequest.id);
  const escala = esIncompleta && excedioRepreguntas(intentosPrevios, umbrales);
  const intentosRepregunta = esIncompleta
    ? Math.min(intentosPrevios + (escala ? 0 : 1), umbrales.maxRepreguntasProveedor)
    : intentosPrevios;

  const quoteResponse = await ctx.repos.quoteResponses.crear({
    quoteRequestId: quoteRequest.id,
    recibidoAt: ctx.ahora,
    fuente: parsed.value.fuente,
    condiciones: parsed.value.condiciones ?? null,
    plazoEntrega: parsed.value.plazoEntrega ?? null,
    confianzaExtraccion: parsed.value.confianzaExtraccion,
    estado: esIncompleta ? 'incompleta' : 'completa',
    intentosRepregunta,
  });
  const quoteItems = await ctx.repos.quoteResponses.insertarItems(
    quoteResponse.id,
    quoteItemInputs,
  );

  let pedidoFinal = pedido;
  let quoteRequestFinal = quoteRequest;
  let transicionoAEnRevision = false;
  let reviewQueueId: string | null = null;
  let comparativo: ResumenComparativoGenerado | null = null;

  if (esIncompleta) {
    if (escala) {
      const review = await ctx.repos.reviewQueue.crear({
        tipo: 'cotizacion_incompleta',
        entidad: 'quote_responses',
        entidadId: quoteResponse.id,
        pedidoId: pedido.id,
        detalle: {
          quote_request_id: quoteRequest.id,
          supplier_id: quoteRequest.supplierId,
          confianza_extraccion: parsed.value.confianzaExtraccion,
          intentos_repregunta: intentosRepregunta,
        },
      });
      reviewQueueId = review.id;
      await notificarAdmins(
        ctx,
        pedido.id,
        `Cotizacion incompleta escalada para ${pedido.numero}.`,
      );
    } else {
      const proveedores = await ctx.repos.proveedores.porIdsConContactoOptIn([
        quoteRequest.supplierId,
      ]);
      const proveedor = proveedores[0];
      const contacto = proveedor?.contactoPrincipal ?? null;
      if (contacto !== null) {
        await ctx.outbox({
          destino: contacto.telefonoWhatsapp,
          texto: `No logramos identificar precio y cantidad en la cotizacion del pedido ${pedido.numero}. ¿Nos lo confirmas por favor?`,
          payload: {
            pedido_id: pedido.id,
            quote_request_id: quoteRequest.id,
            quote_response_id: quoteResponse.id,
            intento: intentosRepregunta,
          },
        });
      } else {
        await notificarAdmins(
          ctx,
          pedido.id,
          `Cotizacion incompleta sin contacto opt-in para ${pedido.numero}.`,
        );
      }
    }
  } else {
    quoteRequestFinal = await ctx.repos.quoteRequests.marcarRespondida(quoteRequest.id);
    const pendientes = await ctx.repos.quoteRequests.contarPendientesPorPedido(pedido.id);
    if (pendientes === 0) {
      const transicion = puedeTransicionar(pedido.estado, 'en_revision');
      if (!transicion.ok) return err(transicion.error);
      pedidoFinal = await ctx.repos.pedidos.marcarEnRevision(pedido.id);
      transicionoAEnRevision = true;
    }
  }

  await ctx.audit({
    accion: 'registrar_cotizacion',
    entidad: 'quote_response',
    entidadId: quoteResponse.id,
    pedidoId: pedido.id,
    antes: {
      pedido,
      quote_request: quoteRequest,
    },
    despues: {
      pedido: pedidoFinal,
      quote_request: quoteRequestFinal,
      quote_response: quoteResponse,
      quote_items: quoteItems,
      review_queue_id: reviewQueueId,
    },
  });

  if (transicionoAEnRevision) {
    const comparativoResult = await generarComparativoParaPedido(pedidoFinal, ctx);
    if (!comparativoResult.ok) {
      throw new Error(`No se pudo generar comparativo para ${pedido.numero}: ${comparativoResult.error.mensaje}`);
    }
    comparativo = comparativoResult.value;
  }

  if (esIncompleta) {
    return err({
      codigo: 'E2',
      mensaje: escala
        ? 'La cotizacion sigue incompleta; se escalo a Proveeduria para revision.'
        : 'La cotizacion esta incompleta; se pidio aclaracion al proveedor.',
    });
  }

  return ok({
    quoteRequestId: quoteRequest.id,
    quoteResponse,
    items: quoteItems,
    pedidoId: pedido.id,
    pedidoEstado: pedidoFinal.estado,
    transicionoAEnRevision,
    comparativo,
  });
}

export async function generarComparativo(
  input: unknown,
  ctx: Ctx,
): Promise<ResultadoTool<ResumenComparativoGenerado>> {
  if (!puedeUsarTool('generar_comparativo', ctx.actor.roles)) return err(errorRol);

  const parsed = parseGenerarComparativoInput(input);
  if (!parsed.ok) return parsed;

  const pedido = await ctx.repos.pedidos.bloquearPorId(parsed.value.pedidoId);
  if (pedido === null) {
    return err({
      codigo: 'no_encontrado',
      mensaje: 'No encontre ese pedido para generar comparativo.',
    });
  }

  if (pedido.estado !== 'en_revision') {
    return err({
      codigo: 'E12',
      mensaje: `El pedido ${pedido.numero} esta en estado "${pedido.estado}" y aun no puede generar comparativo.`,
    });
  }

  return generarComparativoParaPedido(pedido, ctx);
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
