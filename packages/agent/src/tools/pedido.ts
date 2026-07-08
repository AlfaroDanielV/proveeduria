import { err, ok, puedeUsarTool } from '@proveeduria/core';
import type {
  Ctx,
  ErrorTool,
  ItemPedidoInput,
  Pedido,
  PedidoItem,
  Proyecto,
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
