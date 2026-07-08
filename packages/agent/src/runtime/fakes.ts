import { formatNumero } from '@proveeduria/core';
import type { Rol } from '@proveeduria/core';
import { crearCtx } from './context.js';
import type {
  Actor,
  ApprovalEvent,
  AuditEvent,
  Ctx,
  ItemPedidoInput,
  NuevoPedido,
  NuevoQuoteRequest,
  OutboxMessage,
  Pedido,
  PedidoItem,
  PedidoItemRepo,
  PedidoRepo,
  Proyecto,
  ProyectoRepo,
  Proveedor,
  ProveedorContacto,
  ProveedorRepo,
  QuoteRequest,
  QuoteRequestRepo,
  Repos,
  Tx,
  UsuarioInterno,
  UsuarioRepo,
} from './types.js';

export class FakeTx implements Tx {
  readonly queries: { sql: string; params: readonly unknown[] }[] = [];

  async query<T = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }
}

interface FakeSnapshot {
  readonly proyectos: Map<string, Proyecto>;
  readonly pedidos: Map<string, Pedido>;
  readonly itemsPorPedido: Map<string, PedidoItem[]>;
  readonly proveedores: Map<string, Proveedor>;
  readonly quoteRequests: QuoteRequest[];
  readonly usuarios: UsuarioInterno[];
  readonly auditEvents: AuditEvent[];
  readonly outboxMessages: OutboxMessage[];
  readonly approvalEvents: ApprovalEvent[];
  readonly pedidoSeq: number;
  readonly idSeq: number;
}

function clonePedido(pedido: Pedido): Pedido {
  return {
    ...pedido,
    confirmadoAt:
      pedido.confirmadoAt === null ? null : new Date(pedido.confirmadoAt.getTime()),
    plazoCotizacionAt:
      pedido.plazoCotizacionAt === null
        ? null
        : new Date(pedido.plazoCotizacionAt.getTime()),
  };
}

function cloneItem(item: PedidoItem): PedidoItem {
  return { ...item };
}

function cloneProyecto(proyecto: Proyecto): Proyecto {
  return { ...proyecto };
}

function cloneUsuario(usuario: UsuarioInterno): UsuarioInterno {
  return { ...usuario, roles: [...usuario.roles] };
}

function cloneContacto(contacto: ProveedorContacto): ProveedorContacto {
  return {
    ...contacto,
    optinAt: contacto.optinAt === null ? null : new Date(contacto.optinAt.getTime()),
  };
}

function cloneProveedor(proveedor: Proveedor): Proveedor {
  return {
    ...proveedor,
    categorias: [...proveedor.categorias],
    contactoPrincipal:
      proveedor.contactoPrincipal === null
        ? null
        : cloneContacto(proveedor.contactoPrincipal),
  };
}

function cloneQuoteRequest(quoteRequest: QuoteRequest): QuoteRequest {
  return {
    ...quoteRequest,
    plazoAt: new Date(quoteRequest.plazoAt.getTime()),
  };
}

export class FakeToolStore {
  readonly tx = new FakeTx();
  proyectos = new Map<string, Proyecto>();
  pedidos = new Map<string, Pedido>();
  itemsPorPedido = new Map<string, PedidoItem[]>();
  proveedores = new Map<string, Proveedor>();
  quoteRequests: QuoteRequest[] = [];
  usuarios: UsuarioInterno[] = [];
  auditEvents: AuditEvent[] = [];
  outboxMessages: OutboxMessage[] = [];
  approvalEvents: ApprovalEvent[] = [];
  pedidoSeq = 1;
  idSeq = 1;
  failAudit = false;
  failOutbox = false;
  failApproval = false;

  agregarProyecto(proyecto: Proyecto): void {
    this.proyectos.set(proyecto.id, cloneProyecto(proyecto));
  }

  agregarUsuario(usuario: UsuarioInterno): void {
    this.usuarios.push(cloneUsuario(usuario));
  }

  agregarProveedor(proveedor: Proveedor): void {
    this.proveedores.set(proveedor.id, cloneProveedor(proveedor));
  }

  snapshot(): FakeSnapshot {
    return {
      proyectos: new Map(
        [...this.proyectos.entries()].map(([id, proyecto]) => [id, cloneProyecto(proyecto)]),
      ),
      pedidos: new Map(
        [...this.pedidos.entries()].map(([id, pedido]) => [id, clonePedido(pedido)]),
      ),
      itemsPorPedido: new Map(
        [...this.itemsPorPedido.entries()].map(([id, items]) => [
          id,
          items.map(cloneItem),
        ]),
      ),
      proveedores: new Map(
        [...this.proveedores.entries()].map(([id, proveedor]) => [
          id,
          cloneProveedor(proveedor),
        ]),
      ),
      quoteRequests: this.quoteRequests.map(cloneQuoteRequest),
      usuarios: this.usuarios.map(cloneUsuario),
      auditEvents: this.auditEvents.map((event) => ({ ...event })),
      outboxMessages: this.outboxMessages.map((message) => ({ ...message })),
      approvalEvents: this.approvalEvents.map((event) => ({ ...event })),
      pedidoSeq: this.pedidoSeq,
      idSeq: this.idSeq,
    };
  }

  restore(snapshot: FakeSnapshot): void {
    this.proyectos = snapshot.proyectos;
    this.pedidos = snapshot.pedidos;
    this.itemsPorPedido = snapshot.itemsPorPedido;
    this.proveedores = snapshot.proveedores;
    this.quoteRequests = snapshot.quoteRequests;
    this.usuarios = snapshot.usuarios;
    this.auditEvents = snapshot.auditEvents;
    this.outboxMessages = snapshot.outboxMessages;
    this.approvalEvents = snapshot.approvalEvents;
    this.pedidoSeq = snapshot.pedidoSeq;
    this.idSeq = snapshot.idSeq;
  }

  nextId(prefix: string): string {
    const id = `${prefix}-${this.idSeq}`;
    this.idSeq += 1;
    return id;
  }
}

class FakeProyectoRepo implements ProyectoRepo {
  constructor(private readonly store: FakeToolStore) {}

  async activoPorId(projectId: string): Promise<Proyecto | null> {
    const proyecto = this.store.proyectos.get(projectId);
    if (proyecto === undefined || !proyecto.activo) return null;
    return cloneProyecto(proyecto);
  }

  async porId(projectId: string): Promise<Proyecto | null> {
    const proyecto = this.store.proyectos.get(projectId);
    return proyecto === undefined ? null : cloneProyecto(proyecto);
  }
}

class FakePedidoRepo implements PedidoRepo {
  constructor(private readonly store: FakeToolStore) {}

  async siguienteNumeroPedido(ahora: Date): Promise<string> {
    const numero = formatNumero('PED', ahora.getFullYear(), this.store.pedidoSeq);
    this.store.pedidoSeq += 1;
    return numero;
  }

  async crear(input: NuevoPedido): Promise<Pedido> {
    const pedido: Pedido = {
      id: this.store.nextId('pedido'),
      numero: input.numero,
      projectId: input.projectId,
      solicitanteUserId: input.solicitanteUserId,
      estado: 'borrador',
      fechaRequerida: input.fechaRequerida,
      urgencia: input.urgencia,
      confirmadoAt: null,
      confirmadoPor: null,
      plazoCotizacionAt: null,
    };
    this.store.pedidos.set(pedido.id, clonePedido(pedido));
    return clonePedido(pedido);
  }

  async porId(pedidoId: string): Promise<Pedido | null> {
    const pedido = this.store.pedidos.get(pedidoId);
    return pedido === undefined ? null : clonePedido(pedido);
  }

  async bloquearPorId(pedidoId: string): Promise<Pedido | null> {
    return this.porId(pedidoId);
  }

  async confirmar(
    pedidoId: string,
    confirmadoAt: Date,
    confirmadoPor: string,
  ): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      confirmadoAt: new Date(confirmadoAt.getTime()),
      confirmadoPor,
    };
    this.store.pedidos.set(pedidoId, clonePedido(actualizado));
    return clonePedido(actualizado);
  }

  async marcarCotizando(pedidoId: string, plazoCotizacionAt: Date): Promise<Pedido> {
    const pedido = this.store.pedidos.get(pedidoId);
    if (pedido === undefined) throw new Error(`Pedido no encontrado: ${pedidoId}.`);
    const actualizado: Pedido = {
      ...pedido,
      estado: 'cotizando',
      plazoCotizacionAt: new Date(plazoCotizacionAt.getTime()),
    };
    this.store.pedidos.set(pedidoId, clonePedido(actualizado));
    return clonePedido(actualizado);
  }
}

class FakePedidoItemRepo implements PedidoItemRepo {
  constructor(private readonly store: FakeToolStore) {}

  async insertarMuchos(
    pedidoId: string,
    items: readonly ItemPedidoInput[],
  ): Promise<readonly PedidoItem[]> {
    const existentes = this.store.itemsPorPedido.get(pedidoId) ?? [];
    const insertados = items.map((item) => ({
      id: this.store.nextId('item'),
      pedidoId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      unidad: item.unidad,
    }));
    this.store.itemsPorPedido.set(pedidoId, [...existentes, ...insertados.map(cloneItem)]);
    return insertados.map(cloneItem);
  }

  async porPedido(pedidoId: string): Promise<readonly PedidoItem[]> {
    return (this.store.itemsPorPedido.get(pedidoId) ?? []).map(cloneItem);
  }
}

class FakeUsuarioRepo implements UsuarioRepo {
  constructor(private readonly store: FakeToolStore) {}

  async porTelefono(phone: string): Promise<Actor | null> {
    const usuario = this.store.usuarios.find((u) => u.telefonoWhatsapp === phone);
    if (usuario === undefined) return null;
    return {
      userId: usuario.userId,
      nombre: usuario.nombre,
      roles: [...usuario.roles],
    };
  }

  async activosPorRol(role: Rol): Promise<readonly UsuarioInterno[]> {
    return this.store.usuarios
      .filter((usuario) => usuario.roles.includes(role))
      .map(cloneUsuario);
  }
}

class FakeProveedorRepo implements ProveedorRepo {
  constructor(private readonly store: FakeToolStore) {}

  async activosConContactoOptIn(): Promise<readonly Proveedor[]> {
    return [...this.store.proveedores.values()]
      .filter((proveedor) => (
        proveedor.activo &&
        proveedor.contactoPrincipal !== null &&
        proveedor.contactoPrincipal.optinAt !== null
      ))
      .map(cloneProveedor);
  }

  async porIdsConContactoOptIn(supplierIds: readonly string[]): Promise<readonly Proveedor[]> {
    return supplierIds.flatMap((supplierId) => {
      const proveedor = this.store.proveedores.get(supplierId);
      if (
        proveedor === undefined ||
        !proveedor.activo ||
        proveedor.contactoPrincipal === null ||
        proveedor.contactoPrincipal.optinAt === null
      ) {
        return [];
      }
      return [cloneProveedor(proveedor)];
    });
  }
}

class FakeQuoteRequestRepo implements QuoteRequestRepo {
  constructor(private readonly store: FakeToolStore) {}

  async crear(input: NuevoQuoteRequest): Promise<QuoteRequest> {
    const quoteRequest: QuoteRequest = {
      id: this.store.nextId('quote-request'),
      pedidoId: input.pedidoId,
      supplierId: input.supplierId,
      plazoAt: new Date(input.plazoAt.getTime()),
      estado: 'enviada',
    };
    this.store.quoteRequests.push(cloneQuoteRequest(quoteRequest));
    return cloneQuoteRequest(quoteRequest);
  }
}

export function crearFakeRepos(store: FakeToolStore): Repos {
  return {
    proyectos: new FakeProyectoRepo(store),
    pedidos: new FakePedidoRepo(store),
    pedidoItems: new FakePedidoItemRepo(store),
    usuarios: new FakeUsuarioRepo(store),
    proveedores: new FakeProveedorRepo(store),
    quoteRequests: new FakeQuoteRequestRepo(store),
  };
}

export function crearFakeCtx(
  store: FakeToolStore,
  actor: Actor,
  ahora: Date,
): Ctx {
  return {
    ...crearCtx({
      tx: store.tx,
      actor,
      ahora,
      repos: crearFakeRepos(store),
    }),
    audit: async (event) => {
      if (store.failAudit) throw new Error('Fallo de auditoria fake.');
      store.auditEvents.push({ ...event });
    },
    outbox: async (message) => {
      if (store.failOutbox) throw new Error('Fallo de outbox fake.');
      store.outboxMessages.push({ ...message });
    },
    approval: async (event) => {
      if (store.failApproval) throw new Error('Fallo de aprobacion fake.');
      store.approvalEvents.push({ ...event });
    },
  };
}

export async function withFakeCtx<T>(
  store: FakeToolStore,
  actor: Actor,
  ahora: Date,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  const snapshot = store.snapshot();
  try {
    return await fn(crearFakeCtx(store, actor, ahora));
  } catch (error) {
    store.restore(snapshot);
    throw error;
  }
}
