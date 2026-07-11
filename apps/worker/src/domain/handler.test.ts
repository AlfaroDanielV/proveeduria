import { describe, expect, it } from 'vitest';
import type { Actor, ConversacionRepo, ConversacionUpsertResultado, MensajeHistorial, NuevaConversacionInput, Tx } from '@proveeduria/agent';
import { InMemoryConsumer } from '../queue/index.js';
import type { Job } from '../queue/index.js';
import type { LogSink } from '../handlers/echo.js';
import { procesarUno } from '../consumer.js';
import { crearDomainHandler } from './handler.js';
import type {
  ContextoRemitenteDominio,
  DomainEngine,
  DomainEngineInput,
  InboundMessage,
  InboundMessageRepo,
  RemitenteResolver,
  TransactionRunner,
  UnknownSenderReporter,
} from './types.js';

const AHORA = new Date('2026-07-08T12:00:00.000Z');

const actorAdmin: Actor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    wamid: 'wamid.1',
    intento: 1,
    ...overrides,
  };
}

function mensaje(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: '70000000-0000-4000-8000-000000000001',
    wamid: 'wamid.1',
    fromPhone: '+50688880002',
    tipo: 'texto',
    payload: { text: 'hola' },
    receivedAt: AHORA,
    processedAt: null,
    ...overrides,
  };
}

class FakeTx implements Tx {
  readonly queries: { sql: string; params: readonly unknown[] }[] = [];

  async query<T = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params });
    return { rows: [], rowCount: 0 };
  }
}

class FakeRunner implements TransactionRunner {
  readonly tx = new FakeTx();
  commits = 0;
  rollbacks = 0;

  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      const result = await fn(this.tx);
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

class FakeInboundRepo implements InboundMessageRepo {
  marcados: { id: string; at: Date }[] = [];
  conversacionesFijadas: { id: string; conversationId: string }[] = [];

  constructor(private readonly value: InboundMessage | null) {}

  async bloquearPorWamid(_wamid: string): Promise<InboundMessage | null> {
    return this.value;
  }

  async marcarProcesado(id: string, at: Date): Promise<void> {
    this.marcados.push({ id, at });
  }

  async fijarConversacion(id: string, conversationId: string): Promise<void> {
    this.conversacionesFijadas.push({ id, conversationId });
  }
}

/** Fake de ConversacionRepo (agente-conversacional.md §A4): registra los upserts recibidos. */
class FakeConversacionRepo implements ConversacionRepo {
  upserts: NuevaConversacionInput[] = [];
  private seq = 0;

  async upsertPorTelefono(input: NuevaConversacionInput): Promise<ConversacionUpsertResultado> {
    this.upserts.push(input);
    this.seq += 1;
    return { id: `conversacion-${this.seq}` };
  }

  async ventanaVigente(): Promise<boolean> {
    return true;
  }

  async historialPorTelefono(): Promise<readonly MensajeHistorial[]> {
    return [];
  }
}

class FakeResolver implements RemitenteResolver {
  constructor(private readonly contexto: ContextoRemitenteDominio) {}

  async resolverPorTelefono(_phone: string): Promise<ContextoRemitenteDominio> {
    return this.contexto;
  }
}

class SpyEngine implements DomainEngine {
  inputs: DomainEngineInput[] = [];
  fail = false;

  async procesar(input: DomainEngineInput): Promise<void> {
    this.inputs.push(input);
    if (this.fail) throw new Error('fallo motor dominio');
  }
}

class SpyUnknownReporter implements UnknownSenderReporter {
  calls: Parameters<UnknownSenderReporter['reportar']>[0][] = [];

  async reportar(input: Parameters<UnknownSenderReporter['reportar']>[0]): Promise<void> {
    this.calls.push(input);
  }
}

function logSpy(): LogSink {
  return {
    info() {
      // no-op
    },
  };
}

describe('crearDomainHandler', () => {
  it('resuelve interno, crea Ctx, toma lock por pedido y marca processed_at', async () => {
    const runner = new FakeRunner();
    const inbound = new FakeInboundRepo(mensaje());
    const resolver = new FakeResolver({
      tipo: 'interno',
      actor: actorAdmin,
      telefonoWhatsapp: '+50688880002',
    });
    const engine = new SpyEngine();
    const conversaciones = new FakeConversacionRepo();
    const handler = crearDomainHandler({
      runner,
      engine,
      inboundRepo: () => inbound,
      remitenteResolver: () => resolver,
      conversacionRepo: () => conversaciones,
      ahora: () => AHORA,
      log: logSpy(),
    });

    await handler.manejar(job({ pedidoId: 'pedido-1' }));

    expect(runner.commits).toBe(1);
    expect(runner.rollbacks).toBe(0);
    expect(runner.tx.queries[0]).toMatchObject({
      sql: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      params: ['pedido:pedido-1'],
    });
    expect(engine.inputs).toHaveLength(1);
    expect(engine.inputs[0]?.contexto.tipo).toBe('interno');
    expect(engine.inputs[0]?.ctx?.actor).toEqual(actorAdmin);
    expect(engine.inputs[0]?.ctx?.origen).toBe('wamid');
    expect(inbound.marcados).toEqual([
      { id: '70000000-0000-4000-8000-000000000001', at: AHORA },
    ]);
    // A4: upsert de conversacion (vinculada al usuario interno) y conversation_id fijado.
    expect(conversaciones.upserts).toEqual([
      {
        phone: '+50688880002',
        userId: actorAdmin.userId,
        supplierContactId: null,
        recibidoAt: AHORA,
      },
    ]);
    expect(inbound.conversacionesFijadas).toEqual([
      { id: '70000000-0000-4000-8000-000000000001', conversationId: 'conversacion-1' },
    ]);
  });

  it('no reprocesa un inbound con processed_at', async () => {
    const runner = new FakeRunner();
    const inbound = new FakeInboundRepo(mensaje({ processedAt: AHORA }));
    const engine = new SpyEngine();
    const conversaciones = new FakeConversacionRepo();
    const handler = crearDomainHandler({
      runner,
      engine,
      inboundRepo: () => inbound,
      remitenteResolver: () => new FakeResolver({
        tipo: 'interno',
        actor: actorAdmin,
        telefonoWhatsapp: '+50688880002',
      }),
      conversacionRepo: () => conversaciones,
      ahora: () => AHORA,
      log: logSpy(),
    });

    await handler.manejar(job());

    expect(engine.inputs).toHaveLength(0);
    expect(inbound.marcados).toHaveLength(0);
    expect(runner.commits).toBe(1);
    // Un inbound ya procesado no llega ni a resolver remitente: sin upsert de conversacion.
    expect(conversaciones.upserts).toHaveLength(0);
  });

  it('resuelve proveedor y delega sin Ctx interno', async () => {
    const inbound = new FakeInboundRepo(mensaje({ fromPhone: '+50688881001' }));
    const engine = new SpyEngine();
    const conversaciones = new FakeConversacionRepo();
    const handler = crearDomainHandler({
      runner: new FakeRunner(),
      engine,
      inboundRepo: () => inbound,
      remitenteResolver: () => new FakeResolver({
        tipo: 'proveedor',
        supplierContact: {
          id: 'contacto-1',
          supplierId: 'proveedor-1',
          nombre: 'Ventas Rodex',
          telefonoWhatsapp: '+50688881001',
          optinAt: AHORA,
        },
      }),
      conversacionRepo: () => conversaciones,
      ahora: () => AHORA,
      log: logSpy(),
    });

    await handler.manejar(job());

    expect(engine.inputs).toHaveLength(1);
    expect(engine.inputs[0]?.contexto.tipo).toBe('proveedor');
    expect(engine.inputs[0]?.ctx).toBeUndefined();
    expect(inbound.marcados).toHaveLength(1);
    // A4: el vinculo es supplierContactId, nunca userId, para un remitente proveedor.
    expect(conversaciones.upserts).toEqual([
      {
        phone: '+50688881001',
        userId: null,
        supplierContactId: 'contacto-1',
        recibidoAt: AHORA,
      },
    ]);
  });

  it('maneja E11 sin ejecutar engine y marca processed_at', async () => {
    const inbound = new FakeInboundRepo(mensaje({ fromPhone: '+50689999999' }));
    const engine = new SpyEngine();
    const reporter = new SpyUnknownReporter();
    const conversaciones = new FakeConversacionRepo();
    const handler = crearDomainHandler({
      runner: new FakeRunner(),
      engine,
      inboundRepo: () => inbound,
      remitenteResolver: () => new FakeResolver({
        tipo: 'desconocido',
        telefonoWhatsapp: '+50689999999',
      }),
      unknownSenderReporter: reporter,
      conversacionRepo: () => conversaciones,
      ahora: () => AHORA,
      log: logSpy(),
    });

    await handler.manejar(job());

    expect(engine.inputs).toHaveLength(0);
    expect(reporter.calls).toHaveLength(1);
    expect(reporter.calls[0]?.contexto.tipo).toBe('desconocido');
    expect(inbound.marcados).toHaveLength(1);
    // Decision A4 (ver comentario en handler.ts): el desconocido TAMBIEN obtiene una
    // conversacion, anonima (sin user/supplier), para que la respuesta E11 no choque con la
    // ventana 24h del dispatcher.
    expect(conversaciones.upserts).toEqual([
      {
        phone: '+50689999999',
        userId: null,
        supplierContactId: null,
        recibidoAt: AHORA,
      },
    ]);
    expect(inbound.conversacionesFijadas).toEqual([
      { id: '70000000-0000-4000-8000-000000000001', conversationId: 'conversacion-1' },
    ]);
  });

  it('propaga fallo del engine para que consumer haga nack y no marca processed_at', async () => {
    const runner = new FakeRunner();
    const inbound = new FakeInboundRepo(mensaje());
    const engine = new SpyEngine();
    engine.fail = true;
    const handler = crearDomainHandler({
      runner,
      engine,
      inboundRepo: () => inbound,
      remitenteResolver: () => new FakeResolver({
        tipo: 'interno',
        actor: actorAdmin,
        telefonoWhatsapp: '+50688880002',
      }),
      conversacionRepo: () => new FakeConversacionRepo(),
      ahora: () => AHORA,
      log: logSpy(),
    });
    const queued = job();
    const consumer = new InMemoryConsumer([queued]);

    const result = await procesarUno({ consumer, handler, log: logSpy() });

    expect(result.estado).toBe('reintentar');
    expect(consumer.reconocidos).toHaveLength(0);
    expect(consumer.devueltos).toEqual([queued]);
    expect(inbound.marcados).toHaveLength(0);
    expect(runner.rollbacks).toBe(1);
  });
});
