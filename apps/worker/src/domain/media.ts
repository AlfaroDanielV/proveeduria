/**
 * Pipeline de media entrante (docs/specs/agente-conversacional.md §A6): para un inbound con
 * media (imagen/documento/audio) descarga los bytes de Meta, los persiste en
 * `attachments`/`attachment_blobs` (mismo almacenamiento de B4) y fija
 * `inbound_messages.attachment_id`. Corre en la TX del handler ANTES de delegar al engine.
 *
 * Contrato de descarga (Meta Cloud API, dos saltos):
 *   1. `GET {graphUrl}/{mediaId}` (Bearer) -> `{ url, mime_type }` (URL efimera).
 *   2. `GET {url}` (Bearer) -> bytes.
 *
 * Robustez: la media es "best-effort" para el mensaje. Si falta el token
 * (`media_sin_token`) o la descarga falla (`media_error`), se registra un `audit_event`
 * (actor sistema, origen wamid) y el mensaje SIGUE sin attachment — nunca tumba el handler.
 * La descarga necesita SOLO el `META_ACCESS_TOKEN`, aunque el modo de outbox no sea `meta`.
 */

import { createHash } from 'node:crypto';
import type { AttachmentRepo, Tx } from '@proveeduria/agent';
import type { LogSink } from '../handlers/echo.js';
import type { AdjuntoInbound, InboundMessage } from './types.js';

/** Fuente extraible del adjunto, derivada del tipo normalizado del inbound. */
export type FuenteAdjuntoMedia = 'imagen' | 'pdf' | 'audio';

export interface MediaConfig {
  /** Access token de Meta; sin el la descarga no procede (audit `media_sin_token`). */
  readonly accessToken?: string;
  /** Base del Graph API de Meta. */
  readonly graphUrl: string;
  /** `fetch` inyectable (tests sin red); default: `fetch` global. */
  readonly fetchImpl?: typeof fetch;
}

export interface DescargarMediaMetaOptions {
  readonly mediaId: string;
  readonly accessToken: string;
  readonly graphUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export interface MediaDescargada {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

interface MetaMediaMetaBody {
  readonly url?: string;
  readonly mime_type?: string;
}

/**
 * Descarga los bytes de un `mediaId` de Meta en dos saltos (metadata -> URL efimera -> bytes).
 * Lanza `Error` en cualquier fallo de red/HTTP; el llamador lo captura y audita `media_error`.
 */
export async function descargarMediaMeta(
  opciones: DescargarMediaMetaOptions,
): Promise<MediaDescargada> {
  const fetchImpl = opciones.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opciones.accessToken}` };

  const metaResp = await fetchImpl(`${opciones.graphUrl}/${opciones.mediaId}`, { headers });
  if (!metaResp.ok) {
    throw new Error(`Meta media metadata HTTP ${metaResp.status}`);
  }
  const meta = (await metaResp.json()) as MetaMediaMetaBody;
  if (typeof meta.url !== 'string' || meta.url === '') {
    throw new Error('Meta media metadata sin `url`');
  }
  const mimeType = typeof meta.mime_type === 'string' && meta.mime_type !== ''
    ? meta.mime_type
    : 'application/octet-stream';

  const bytesResp = await fetchImpl(meta.url, { headers });
  if (!bytesResp.ok) {
    throw new Error(`Meta media bytes HTTP ${bytesResp.status}`);
  }
  const bytes = Buffer.from(await bytesResp.arrayBuffer());
  return { bytes, mimeType };
}

export interface ProcesarMediaInboundDeps {
  readonly tx: Tx;
  readonly mensaje: InboundMessage;
  readonly attachmentRepo: AttachmentRepo;
  readonly config: MediaConfig;
  readonly ahora: Date;
  readonly log?: LogSink;
  /** Descargador inyectable (tests); default: `descargarMediaMeta` con el `fetch` de la config. */
  readonly descargar?: (opciones: DescargarMediaMetaOptions) => Promise<MediaDescargada>;
}

/**
 * Descarga + persiste la media del inbound (si la trae) y fija `inbound_messages.attachment_id`.
 * Devuelve el `AdjuntoInbound` (bytes en memoria, para que el engine del proveedor extraiga sin
 * re-leer de la BD) o `null` si el inbound no trae media, si falta token, o si la descarga fallo.
 */
export async function procesarMediaInbound(
  deps: ProcesarMediaInboundDeps,
): Promise<AdjuntoInbound | null> {
  const fuente = fuenteDeTipo(deps.mensaje.tipo);
  if (fuente === null) return null;

  const mediaId = extraerMediaId(deps.mensaje.payload);
  if (mediaId === null) return null;

  if (deps.config.accessToken === undefined || deps.config.accessToken === '') {
    await auditarMedia(deps.tx, deps.mensaje, deps.ahora, 'media_sin_token', {
      wamid: deps.mensaje.wamid,
      media_id: mediaId,
    });
    deps.log?.info('media.sin_token', { wamid: deps.mensaje.wamid });
    return null;
  }

  const descargar = deps.descargar ?? descargarMediaMeta;
  let descargada: MediaDescargada;
  try {
    descargada = await descargar({
      mediaId,
      accessToken: deps.config.accessToken,
      graphUrl: deps.config.graphUrl,
      ...(deps.config.fetchImpl ? { fetchImpl: deps.config.fetchImpl } : {}),
    });
  } catch (error) {
    await auditarMedia(deps.tx, deps.mensaje, deps.ahora, 'media_error', {
      wamid: deps.mensaje.wamid,
      media_id: mediaId,
      error: error instanceof Error ? error.message : String(error),
    });
    deps.log?.info('media.error', {
      wamid: deps.mensaje.wamid,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const sha256 = createHash('sha256').update(descargada.bytes).digest('hex');
  const attachment = await deps.attachmentRepo.crearConBytes({
    contentType: descargada.mimeType,
    sha256,
    origen: deps.mensaje.wamid,
    bytes: descargada.bytes,
  });
  await deps.tx.query('UPDATE inbound_messages SET attachment_id = $2 WHERE id = $1', [
    deps.mensaje.id,
    attachment.id,
  ]);

  return {
    attachmentId: attachment.id,
    contentType: descargada.mimeType,
    bytes: descargada.bytes,
    fuente,
  };
}

/** Mapea el tipo normalizado del inbound a la fuente extraible; `null` si no es media. */
function fuenteDeTipo(tipo: string): FuenteAdjuntoMedia | null {
  if (tipo === 'imagen') return 'imagen';
  if (tipo === 'documento') return 'pdf';
  if (tipo === 'audio') return 'audio';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extrae el `media id` de Meta del payload crudo persistido (`inbound_messages.payload` = el
 * objeto `message` de Meta, ver apps/api/src/webhook/parse.ts `raw`): `payload.type` es la clave
 * cruda de Meta (`image|document|audio|voice`) y bajo ella vive `{ id, mime_type, ... }`.
 */
function extraerMediaId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const tipoMeta = typeof payload.type === 'string' ? payload.type : undefined;
  if (tipoMeta === undefined) return null;
  const mediaObj = payload[tipoMeta];
  if (!isRecord(mediaObj)) return null;
  return typeof mediaObj.id === 'string' && mediaObj.id !== '' ? mediaObj.id : null;
}

async function auditarMedia(
  tx: Tx,
  mensaje: InboundMessage,
  ahora: Date,
  accion: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    'INSERT INTO audit_events ' +
      '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
      'VALUES (null, true, $1, $2, $3, null, null, $4::jsonb, $5, $6)',
    [accion, 'inbound_message', mensaje.id, JSON.stringify(detalle), 'wamid', ahora],
  );
}
