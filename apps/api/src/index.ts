/**
 * Servidor HTTP del webhook (node:http, sin framework).
 *
 * GET  /webhook  -> handshake de verificacion de Meta (hub.challenge).
 * POST /webhook  -> lee el CUERPO CRUDO, verifica la firma (401 si invalida/ausente),
 *                   parsea, persiste + encola (ingesta idempotente) y responde 200.
 *
 * Nada de IA/OCR/red externa en el hilo del webhook (EXECUTION_PLAN §1; apps/api/CLAUDE.md).
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pg from 'pg';
import { crearAuditInserter, withTx } from '@proveeduria/agent';
import type { Actor } from '@proveeduria/agent';

import { cargarConfig } from './config.js';
import type { Config } from './config.js';
import type { AttachmentBlobStore } from './attachments/store.js';
import { PgAttachmentBlobStore } from './attachments/store.js';
import type { AttachmentsDeps } from './attachments/routes.js';
import { manejarAttachmentsApi } from './attachments/routes.js';
import { verificarFirma, verificarChallenge } from './webhook/verify.js';
import { parseMeta } from './webhook/parse.js';
import { aplicarStatuses, ingestar } from './webhook/ingest.js';
import type { EntregaStore } from './db/entregas.js';
import { PgEntregaStore } from './db/entregas.js';
import type { InboundStore } from './db/inbound.js';
import { PgInboundStore } from './db/inbound.js';
import type { QueueClient } from './queue/index.js';
import { AzureStorageQueue, InMemoryQueue } from './queue/index.js';
import type { AprobacionesStore, PortalStore, ProveedoresStore, RevisionesStore } from './portal/types.js';
import { PgPortalStore } from './portal/repo.js';
import type { AuthStore } from './portal/auth-store.js';
import { PgAuthStore } from './portal/auth-store.js';
import { PgProveedoresStore } from './portal/proveedores-store.js';
import { PgRevisionesStore } from './portal/revisiones-store.js';
import { PgAprobacionesStore } from './portal/aprobaciones-store.js';
import { crearEjecutorToolPedido } from './portal/acciones-pedido.js';
import type { EmitirCredencialesInput } from './portal/auth-routes.js';
import type { PortalDeps } from './portal/routes.js';
import { manejarPortalApi } from './portal/routes.js';
import { crearLimitadorLogin } from './portal/rate-limit.js';

const { Pool } = pg;

const RUTA_WEBHOOK = '/webhook';
const MAX_BODY_BYTES = 1_048_576; // 1 MiB; los webhooks de Meta son pequenos.

export interface Dependencias {
  readonly config: Config;
  readonly store: InboundStore;
  readonly queue: QueueClient;
  readonly portalStore: PortalStore;
  readonly authStore: AuthStore;
  readonly proveedoresStore: ProveedoresStore;
  readonly revisionesStore: RevisionesStore;
  readonly aprobacionesStore: AprobacionesStore;
  readonly entregas: EntregaStore;
  readonly attachmentsStore: AttachmentBlobStore;
  readonly pool: pg.Pool;
}

function leerCuerpoCrudo(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function encabezadoFirma(req: IncomingMessage): string {
  const h = req.headers['x-hub-signature-256'];
  return typeof h === 'string' ? h : '';
}

/**
 * Alta/reset de credencial + `audit_events('credencial_emitida')` en LA MISMA transaccion
 * (control-center.md; docs/specs/portal-api.md §usuarios/:id/credenciales). Unico punto de
 * `PortalDeps` que abre una transaccion explicita: el resto de operaciones de auth son
 * escrituras de una sola sentencia (atomicas por si solas via el pool).
 */
function crearEmitirCredenciales(pool: pg.Pool): (input: EmitirCredencialesInput) => Promise<void> {
  return (input) =>
    withTx(pool, async (tx) => {
      await new PgAuthStore(tx).crearOResetearCredencial(input.targetUserId, input.passwordHash);
      const actor: Actor = { userId: input.actorUserId, roles: [], nombre: '' };
      await crearAuditInserter(tx, actor, input.ahora, 'web')({
        accion: 'credencial_emitida',
        entidad: 'user_credentials',
        entidadId: input.targetUserId,
      });
    });
}

function crearPortalDeps(deps: Dependencias): PortalDeps {
  const { config, portalStore, authStore, proveedoresStore, revisionesStore, aprobacionesStore, pool } = deps;
  return {
    store: portalStore,
    authStore,
    portalStore,
    proveedoresStore,
    revisionesStore,
    aprobacionesStore,
    ejecutarToolPedido: crearEjecutorToolPedido(pool),
    portalJwtSecret: config.portalJwtSecret,
    portalOrigin: config.portalOrigin,
    esProduccion: config.nodeEnv === 'production',
    ahora: () => new Date(),
    emitirCredenciales: crearEmitirCredenciales(pool),
    // Singleton por proceso: 5 fallos/15min por identificador, 20/15min por IP.
    limitadorLogin: crearLimitadorLogin(),
  };
}

function crearAttachmentsDeps(deps: Dependencias): AttachmentsDeps {
  return {
    store: deps.attachmentsStore,
    secreto: deps.config.attachmentsLinkSecret,
    ahora: () => new Date(),
  };
}

export function crearManejador(deps: Dependencias) {
  const { config, store, queue, entregas } = deps;
  const portalDeps = crearPortalDeps(deps);
  const attachmentsDeps = crearAttachmentsDeps(deps);

  return async function manejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Adjuntos: publico, sin cookie de sesion (Meta lo descarga). ANTES del portal para no
    // pasar por CSRF/auth de sesion que no aplica aqui (docs/specs/outbox-whatsapp.md).
    if (await manejarAttachmentsApi(req, res, attachmentsDeps)) {
      return;
    }

    if (await manejarPortalApi(req, res, portalDeps)) {
      return;
    }

    // GET de verificacion (handshake de suscripcion).
    if (req.method === 'GET' && url.pathname === RUTA_WEBHOOK) {
      const challenge = verificarChallenge(
        {
          mode: url.searchParams.get('hub.mode') ?? undefined,
          token: url.searchParams.get('hub.verify_token') ?? undefined,
          challenge: url.searchParams.get('hub.challenge') ?? undefined,
        },
        config.metaVerifyToken,
      );
      if (challenge !== null) {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(challenge);
      } else {
        res.writeHead(403);
        res.end();
      }
      return;
    }

    // POST de eventos.
    if (req.method === 'POST' && url.pathname === RUTA_WEBHOOK) {
      let raw: Buffer;
      try {
        raw = await leerCuerpoCrudo(req, MAX_BODY_BYTES);
      } catch {
        res.writeHead(413);
        res.end();
        return;
      }

      // 1. Firma sobre el cuerpo CRUDO antes de cualquier otra cosa.
      if (!verificarFirma(raw, encabezadoFirma(req), config.metaAppSecret)) {
        res.writeHead(401);
        res.end();
        return;
      }

      // 2. Parseo defensivo. JSON invalido: 200 para no gatillar reintentos de Meta.
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        res.writeHead(200);
        res.end();
        return;
      }

      const { mensajes, statuses } = parseMeta(payload);

      // 3-4. Persistir + encolar (idempotente por wamid). Si falla, 500 -> Meta reintenta.
      try {
        await ingestar(mensajes, { store, queue });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('ingesta fallida', e);
        res.writeHead(500);
        res.end();
        return;
      }

      // Statuses de entrega (value.statuses[]): INLINE, sin cola (UPDATE indexado por
      // wamid_salida, docs/specs/outbox-whatsapp.md). Un error de DB aqui tambien
      // responde 500; es seguro porque aplicar un status es idempotente (Meta reintenta).
      try {
        await aplicarStatuses(statuses, entregas);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('aplicar statuses de entrega fallido', e);
        res.writeHead(500);
        res.end();
        return;
      }

      // 5. 200 rapido.
      res.writeHead(200);
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

function crearQueue(config: Config): QueueClient {
  if (config.queueConnection !== undefined) {
    return new AzureStorageQueue({
      connectionString: config.queueConnection,
      queueName: config.queueName,
    });
  }
  // Solo se llega aqui en dev/test o con ALLOW_INMEMORY_QUEUE=true: cargarConfig ya
  // fallo-cerrado en produccion sin cola real (config.ts). Los jobs en memoria se pierden
  // al reiniciar y ningun worker los consume; ver DEPLOYMENT_COOKBOOK §1.4.
  // eslint-disable-next-line no-console
  console.warn('Usando InMemoryQueue (no apta para produccion; solo dev/test).');
  return new InMemoryQueue();
}

function main(): void {
  const config = cargarConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const store = new PgInboundStore(pool);
  const portalStore = new PgPortalStore(pool);
  const authStore = new PgAuthStore(pool);
  const proveedoresStore = new PgProveedoresStore(pool);
  const revisionesStore = new PgRevisionesStore(pool);
  const aprobacionesStore = new PgAprobacionesStore(pool);
  const entregas = new PgEntregaStore(pool);
  const attachmentsStore = new PgAttachmentBlobStore(pool);
  const queue = crearQueue(config);

  const manejar = crearManejador({
    config,
    store,
    queue,
    portalStore,
    authStore,
    proveedoresStore,
    revisionesStore,
    aprobacionesStore,
    entregas,
    attachmentsStore,
    pool,
  });
  const server = createServer((req, res) => {
    manejar(req, res).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('error no controlado en el handler', e);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  });

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`apps/api escuchando en :${config.port}`);
  });
}

main();
