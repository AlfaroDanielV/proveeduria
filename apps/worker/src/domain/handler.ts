import { crearCtx, withTx } from '@proveeduria/agent';
import type { Tx } from '@proveeduria/agent';
import type { Pool } from 'pg';
import type { JobHandler, LogSink } from '../handlers/echo.js';
import { consoleLogSink } from '../handlers/echo.js';
import type { Job } from '../queue/index.js';
import { PgUnknownSenderReporter } from './e11.js';
import { PgInboundMessageRepo } from './inbound.js';
import { PgRemitenteResolver } from './router.js';
import type {
  DomainEngine,
  InboundMessageRepo,
  RemitenteResolver,
  TransactionRunner,
  UnknownSenderReporter,
} from './types.js';

export class PgTransactionRunner implements TransactionRunner {
  constructor(private readonly pool: Pool) {}

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTx(this.pool, fn);
  }
}

export interface CrearDomainHandlerDeps {
  readonly runner: TransactionRunner;
  readonly engine: DomainEngine;
  readonly inboundRepo?: (tx: Tx) => InboundMessageRepo;
  readonly remitenteResolver?: (tx: Tx) => RemitenteResolver;
  readonly unknownSenderReporter?: UnknownSenderReporter;
  readonly ahora?: () => Date;
  readonly log?: LogSink;
}

export function crearDomainHandler(deps: CrearDomainHandlerDeps): JobHandler {
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? consoleLogSink;
  const inboundRepoFactory = deps.inboundRepo ?? ((tx) => new PgInboundMessageRepo(tx));
  const resolverFactory = deps.remitenteResolver ?? ((tx) => new PgRemitenteResolver(tx));
  const unknownReporter = deps.unknownSenderReporter ?? new PgUnknownSenderReporter();

  return {
    async manejar(job: Job): Promise<void> {
      await deps.runner.run(async (tx) => {
        await tomarLockPedidoSiAplica(tx, job);

        const inbound = inboundRepoFactory(tx);
        const mensaje = await inbound.bloquearPorWamid(job.wamid);
        if (mensaje === null) {
          throw new Error(`Job ${job.id} referencia inbound_messages inexistente: ${job.wamid}.`);
        }

        if (mensaje.processedAt !== null) {
          log.info('domain.idempotente_skip', {
            jobId: job.id,
            wamid: job.wamid,
            processedAt: mensaje.processedAt.toISOString(),
          });
          return;
        }

        const contexto = await resolverFactory(tx).resolverPorTelefono(mensaje.fromPhone);
        log.info('domain.router', {
          jobId: job.id,
          wamid: job.wamid,
          remitente: contexto.tipo,
        });

        if (contexto.tipo === 'desconocido') {
          const now = ahora();
          await unknownReporter.reportar({
            tx,
            mensaje,
            contexto,
            ahora: now,
          });
          await inbound.marcarProcesado(mensaje.id, now);
          return;
        }

        const now = ahora();
        await deps.engine.procesar({
          job,
          mensaje,
          contexto,
          tx,
          ahora: now,
          ...(contexto.tipo === 'interno'
            ? { ctx: crearCtx({ tx, actor: contexto.actor, ahora: now, origen: 'wamid' }) }
            : {}),
        });
        await inbound.marcarProcesado(mensaje.id, now);
      });
    },
  };
}

async function tomarLockPedidoSiAplica(tx: Tx, job: Job): Promise<void> {
  if (job.pedidoId === undefined || job.pedidoId.trim() === '') return;
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pedido:${job.pedidoId}`]);
}
