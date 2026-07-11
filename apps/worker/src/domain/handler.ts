import { crearCtx, PgAttachmentRepo, PgConversacionRepo, withTx } from '@proveeduria/agent';
import type { AttachmentRepo, ConversacionRepo, Tx } from '@proveeduria/agent';
import type { Pool } from 'pg';
import type { JobHandler, LogSink } from '../handlers/echo.js';
import { consoleLogSink } from '../handlers/echo.js';
import type { Job } from '../queue/index.js';
import { PgUnknownSenderReporter } from './e11.js';
import { PgInboundMessageRepo } from './inbound.js';
import { procesarMediaInbound } from './media.js';
import type { MediaConfig } from './media.js';
import { PgRemitenteResolver } from './router.js';
import type {
  ContextoRemitenteDominio,
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
  readonly conversacionRepo?: (tx: Tx) => ConversacionRepo;
  readonly unknownSenderReporter?: UnknownSenderReporter;
  readonly ahora?: () => Date;
  readonly log?: LogSink;
  /**
   * Config del pipeline de media (A6). Presente -> el handler descarga/persiste la media del
   * inbound antes de delegar al engine; ausente -> se omite (dev/tests sin media). Ver
   * `media.ts` y `docs/specs/agente-conversacional.md` §A6.
   */
  readonly media?: MediaConfig;
  /** Repo de attachments para el pipeline de media; default `PgAttachmentRepo`. */
  readonly attachmentRepo?: (tx: Tx) => AttachmentRepo;
}

/**
 * Telefono "canonico" del remitente resuelto por el router: el mismo valor que las
 * tools/E11 usan como `destino` al responderle (`docs/specs/agente-conversacional.md`
 * §A4), para que `conversations.phone` calce con `outbox_messages.destino` (ventana 24h
 * del dispatcher, `apps/worker/src/outbox/dispatcher.ts`).
 */
function telefonoDeContexto(contexto: ContextoRemitenteDominio): string {
  if (contexto.tipo === 'proveedor') return contexto.supplierContact.telefonoWhatsapp;
  return contexto.telefonoWhatsapp;
}

export function crearDomainHandler(deps: CrearDomainHandlerDeps): JobHandler {
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? consoleLogSink;
  const inboundRepoFactory = deps.inboundRepo ?? ((tx) => new PgInboundMessageRepo(tx));
  const resolverFactory = deps.remitenteResolver ?? ((tx) => new PgRemitenteResolver(tx));
  const conversacionRepoFactory = deps.conversacionRepo ?? ((tx) => new PgConversacionRepo(tx));
  const attachmentRepoFactory = deps.attachmentRepo ?? ((tx) => new PgAttachmentRepo(tx));
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

        const now = ahora();
        const contexto = await resolverFactory(tx).resolverPorTelefono(mensaje.fromPhone);
        log.info('domain.router', {
          jobId: job.id,
          wamid: job.wamid,
          remitente: contexto.tipo,
        });

        // A4 (docs/specs/agente-conversacional.md): upsert de conversacion + vinculo del
        // inbound EN LA MISMA tx, para los 3 tipos de remitente. Decision (ajusta la spec,
        // que decia "desconocido no crea conversacion"): el `desconocido` TAMBIEN obtiene
        // una conversacion, anonima (sin user_id/supplier_contact_id) — sin ella, la
        // respuesta fija de E11 (texto libre, ver e11.ts) quedaria sujeta a la ventana 24h
        // del dispatcher y un `descartado(ventana_24h_cerrada)` la tumbaria pese a que el
        // remitente ACABA de escribir. La conversacion anonima le abre la ventana con el
        // mismo `recibidoAt` de este mensaje, igual que a interno/proveedor.
        const conversacion = await conversacionRepoFactory(tx).upsertPorTelefono({
          phone: telefonoDeContexto(contexto),
          userId: contexto.tipo === 'interno' ? contexto.actor.userId : null,
          supplierContactId: contexto.tipo === 'proveedor' ? contexto.supplierContact.id : null,
          recibidoAt: now,
        });
        await inbound.fijarConversacion(mensaje.id, conversacion.id);

        if (contexto.tipo === 'desconocido') {
          await unknownReporter.reportar({
            tx,
            mensaje,
            contexto,
            ahora: now,
          });
          await inbound.marcarProcesado(mensaje.id, now);
          return;
        }

        // A6: pipeline de media (antes de delegar al engine). Solo con `deps.media`; para un
        // inbound sin media es un no-op. Best-effort: un fallo audita y sigue sin adjunto.
        const adjunto = deps.media !== undefined
          ? await procesarMediaInbound({
              tx,
              mensaje,
              attachmentRepo: attachmentRepoFactory(tx),
              config: deps.media,
              ahora: now,
              log,
            })
          : null;

        await deps.engine.procesar({
          job,
          mensaje,
          contexto,
          tx,
          ahora: now,
          ...(contexto.tipo === 'interno'
            ? { ctx: crearCtx({ tx, actor: contexto.actor, ahora: now, origen: 'wamid' }) }
            : {}),
          ...(adjunto !== null ? { adjunto } : {}),
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
