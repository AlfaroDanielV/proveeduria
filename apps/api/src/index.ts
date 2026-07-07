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

import { cargarConfig } from './config.js';
import type { Config } from './config.js';
import { verificarFirma, verificarChallenge } from './webhook/verify.js';
import { parseMeta } from './webhook/parse.js';
import { ingestar } from './webhook/ingest.js';
import type { InboundStore } from './db/inbound.js';
import { PgInboundStore } from './db/inbound.js';
import type { QueueClient } from './queue/index.js';
import { AzureStorageQueue, InMemoryQueue } from './queue/index.js';

const { Pool } = pg;

const RUTA_WEBHOOK = '/webhook';
const MAX_BODY_BYTES = 1_048_576; // 1 MiB; los webhooks de Meta son pequenos.

export interface Dependencias {
  readonly config: Config;
  readonly store: InboundStore;
  readonly queue: QueueClient;
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

export function crearManejador(deps: Dependencias) {
  const { config, store, queue } = deps;

  return async function manejar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

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

      const mensajes = parseMeta(payload);

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
  const queue = crearQueue(config);

  const manejar = crearManejador({ config, store, queue });
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
