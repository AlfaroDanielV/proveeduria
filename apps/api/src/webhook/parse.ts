/**
 * Normaliza el payload de Meta (WhatsApp Cloud API) a `{ mensajes, statuses }` tipado.
 *
 * Defensivo: cualquier payload malformado devuelve listas vacias sin lanzar. No hace
 * IO ni red; solo transforma datos. El `wamid` (id del mensaje) es la clave de
 * idempotencia (data-model.md `inbound_messages.wamid`), asi que un mensaje sin id
 * o sin remitente se descarta.
 *
 * `FuenteAdjunto` refleja el vocabulario del dominio `FuenteExtraccion`
 * (quote_responses.fuente, data-model.md: `texto|imagen|pdf|audio`) restringido a las
 * fuentes extraibles de un adjunto. Se define local a proposito: el hilo del webhook
 * NO debe depender del runtime de `@proveeduria/core` (packages/core es puro pero su
 * carga se evita para mantener el ingest aislado). Si se decidiera compartir el tipo,
 * seria via `import type` desde '@proveeduria/core' (nunca import de valor).
 *
 * `value.statuses[]` (docs/specs/outbox-whatsapp.md "Statuses de Meta") se extrae a
 * `StatusEntrega[]`; un `status` con `estado` fuera de `sent|delivered|read|failed` se
 * descarta silenciosamente (status desconocido = se ignora).
 */

/** Fuente de un adjunto extraible (subconjunto de `FuenteExtraccion` sin 'texto'). */
export type FuenteAdjunto = 'imagen' | 'pdf' | 'audio';

/** Tipo de mensaje entrante normalizado (dominio en espanol). */
export type TipoMensaje =
  | 'texto'
  | 'imagen'
  | 'audio'
  | 'documento'
  | 'video'
  | 'sticker'
  | 'ubicacion'
  | 'contactos'
  | 'interactivo'
  | 'boton'
  | 'sistema'
  | 'desconocido';

export interface Adjunto {
  /** Media id de Meta; el worker lo descarga luego (fuera del hilo del webhook). */
  readonly mediaId: string;
  readonly mimeType?: string;
  readonly sha256?: string;
  readonly nombreArchivo?: string;
  /** Presente solo para adjuntos extraibles (imagen/audio/documento). */
  readonly fuente?: FuenteAdjunto;
}

export interface MensajeEntrante {
  /** `wamid` de Meta: clave de idempotencia. */
  readonly wamid: string;
  /** Telefono del remitente (E.164 sin '+', tal cual lo envia Meta). */
  readonly from: string;
  readonly tipo: TipoMensaje;
  readonly timestamp?: string;
  /** Texto del mensaje o caption del adjunto, si aplica. */
  readonly texto?: string;
  readonly adjunto?: Adjunto;
  /** Objeto crudo del mensaje de Meta; se persiste como `payload` jsonb. */
  readonly raw: unknown;
}

/** Estados de entrega reportados por Meta que reconocemos (resto = "desconocido", se ignora). */
export type EstadoEntrega = 'sent' | 'delivered' | 'read' | 'failed';

/** `value.statuses[]` del webhook de Meta, normalizado (docs/specs/outbox-whatsapp.md). */
export interface StatusEntrega {
  /** `id` de Meta: es el `wamid_salida` de `outbox_messages` (lookup por indice). */
  readonly wamid: string;
  readonly estado: EstadoEntrega;
  readonly timestamp?: string;
  readonly recipientId?: string;
  /** `errors[]` crudo de Meta cuando `estado === 'failed'`. */
  readonly errores?: unknown;
}

/** Salida de `parseMeta`: mensajes entrantes y statuses de entrega del mismo payload. */
export interface ResultadoParseMeta {
  readonly mensajes: MensajeEntrante[];
  readonly statuses: StatusEntrega[];
}

const ESTADOS_ENTREGA_VALIDOS: ReadonlySet<string> = new Set([
  'sent',
  'delivered',
  'read',
  'failed',
]);

const MAPA_TIPO: Readonly<Record<string, TipoMensaje>> = {
  text: 'texto',
  image: 'imagen',
  audio: 'audio',
  voice: 'audio',
  document: 'documento',
  video: 'video',
  sticker: 'sticker',
  location: 'ubicacion',
  contacts: 'contactos',
  interactive: 'interactivo',
  button: 'boton',
  system: 'sistema',
};

function esRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function esArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function fuenteDe(tipo: TipoMensaje): FuenteAdjunto | undefined {
  switch (tipo) {
    case 'imagen':
      return 'imagen';
    case 'audio':
      return 'audio';
    case 'documento':
      return 'pdf';
    default:
      return undefined;
  }
}

function construirAdjunto(
  tipo: TipoMensaje,
  mediaObj: Record<string, unknown> | undefined,
): Adjunto | undefined {
  if (mediaObj === undefined) return undefined;
  const mediaId = str(mediaObj.id);
  if (mediaId === undefined) return undefined;

  const mimeType = str(mediaObj.mime_type);
  const sha256 = str(mediaObj.sha256);
  const nombreArchivo = str(mediaObj.filename);
  const fuente = fuenteDe(tipo);

  return {
    mediaId,
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(sha256 !== undefined ? { sha256 } : {}),
    ...(nombreArchivo !== undefined ? { nombreArchivo } : {}),
    ...(fuente !== undefined ? { fuente } : {}),
  };
}

function construirMensaje(m: Record<string, unknown>): MensajeEntrante | undefined {
  const wamid = str(m.id);
  const from = str(m.from);
  if (wamid === undefined || from === undefined) return undefined;

  const metaTipo = str(m.type);
  const tipo: TipoMensaje =
    metaTipo !== undefined ? (MAPA_TIPO[metaTipo] ?? 'desconocido') : 'desconocido';

  const posibleMedia = metaTipo !== undefined ? m[metaTipo] : undefined;
  const mediaObj = esRecord(posibleMedia) ? posibleMedia : undefined;

  const textoObj = esRecord(m.text) ? m.text : undefined;
  let texto = textoObj !== undefined ? str(textoObj.body) : undefined;
  if (texto === undefined && mediaObj !== undefined) {
    texto = str(mediaObj.caption);
  }

  const timestamp = str(m.timestamp);
  const adjunto = construirAdjunto(tipo, mediaObj);

  return {
    wamid,
    from,
    tipo,
    raw: m,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(texto !== undefined ? { texto } : {}),
    ...(adjunto !== undefined ? { adjunto } : {}),
  };
}

function construirStatus(s: Record<string, unknown>): StatusEntrega | undefined {
  const wamid = str(s.id);
  const estadoRaw = str(s.status);
  if (wamid === undefined || estadoRaw === undefined) return undefined;
  if (!ESTADOS_ENTREGA_VALIDOS.has(estadoRaw)) return undefined; // status desconocido: se ignora
  const estado = estadoRaw as EstadoEntrega;

  const timestamp = str(s.timestamp);
  const recipientId = str(s.recipient_id);
  const errores = estado === 'failed' && esArray(s.errors) ? s.errors : undefined;

  return {
    wamid,
    estado,
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(recipientId !== undefined ? { recipientId } : {}),
    ...(errores !== undefined ? { errores } : {}),
  };
}

export function parseMeta(payload: unknown): ResultadoParseMeta {
  const mensajes: MensajeEntrante[] = [];
  const statuses: StatusEntrega[] = [];

  const root = esRecord(payload) ? payload : undefined;
  if (root === undefined) return { mensajes, statuses };

  const entries = esArray(root.entry) ? root.entry : [];
  for (const entry of entries) {
    if (!esRecord(entry)) continue;
    const changes = esArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!esRecord(change)) continue;
      const value = esRecord(change.value) ? change.value : undefined;
      if (value === undefined) continue;

      const messages = esArray(value.messages) ? value.messages : [];
      for (const m of messages) {
        if (!esRecord(m)) continue;
        const msg = construirMensaje(m);
        if (msg !== undefined) mensajes.push(msg);
      }

      const statusesValue = esArray(value.statuses) ? value.statuses : [];
      for (const s of statusesValue) {
        if (!esRecord(s)) continue;
        const status = construirStatus(s);
        if (status !== undefined) statuses.push(status);
      }
    }
  }

  return { mensajes, statuses };
}
