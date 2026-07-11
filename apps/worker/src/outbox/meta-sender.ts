/**
 * Sender real de outbox contra Meta WhatsApp Cloud API (docs/specs/outbox-whatsapp.md).
 *
 * Implementa `OutboxSender`: el dispatcher (`dispatcher.ts`) lo llama fuera de toda
 * transaccion y traduce cualquier `ErrorEnvio` que lance a la accion correspondiente
 * (`descartado` / `fallido` con backoff / corte de batch por rate limit). Este modulo NO
 * conoce Postgres ni el ciclo claim->send->mark; solo sabe hablar con el Graph API.
 *
 * Contrato de contenido (spec §"Contenido del mensaje"):
 *  - `texto != null` -> `type: text`, partido en chunks de <=4096 caracteres si hace falta;
 *    `wamidSalida` es el del PRIMER chunk. Si un chunk posterior falla, se propaga el error
 *    mapeado y el envio completo se considera fallido (puede duplicar el primer chunk en un
 *    reintento; aceptado por la spec, los textos del dominio son cortos).
 *  - `template != null` -> `type: template`; `language.code = payload.idioma ?? 'es'`;
 *    `components` con un body de parametros posicionales desde `payload.variables` (debe ser
 *    un array de strings no vacio: si falta o es invalido, error PERMANENTE sin llamar
 *    `fetch` — no tiene sentido reintentar una plantilla mal formada). Documento (header),
 *    en orden de precedencia (spec §"Contenido del mensaje", camino 1 gana):
 *      1. `attachmentId != null` -> el sender arma el link firmado al momento del envio
 *         (`firmarLinkAttachment`, requiere `publicApiUrl`/`attachmentsLinkSecret`
 *         configurados; si faltan, error PERMANENTE sin llamar `fetch` — nunca se envia sin
 *         el documento que la fila pide). `filename` = `payload.documento_nombre` (string no
 *         vacio) o `documento.pdf`.
 *      2. si no, `payload.documento = { link, filename }` explicito, como antes.
 *  - `texto != null` y `attachmentId != null` a la vez: combinacion no contemplada por la
 *    spec (el documento solo se adjunta como header de PLANTILLA) -> error PERMANENTE sin
 *    llamar `fetch`.
 *  - Ni texto ni template -> error PERMANENTE sin llamar `fetch`.
 *
 * Taxonomia de errores (spec §"Taxonomia de errores"): los codigos de Meta se mapean 1:1 a
 * `permanente` / `rate_limit` (con `retryAfterMs` del header `Retry-After`, en segundos) /
 * `transitorio` (cualquier otro codigo, 5xx sin cuerpo interpretable, o fallo de red).
 */

import { ErrorEnvio } from './dispatcher.js';
import type { OutboxMessagePendiente, OutboxSender } from './dispatcher.js';
import { firmarLinkAttachment } from './attachment-link.js';

const GRAPH_URL_DEFAULT = 'https://graph.facebook.com/v23.0';

/** Limite de Meta para `type: text` (`text.body`). */
const LONGITUD_MAXIMA_TEXTO = 4096;

/** Codigos de Meta que nunca se benefician de un reintento (spec, columna `permanente`). */
const CODIGOS_PERMANENTES = new Set([
  100, 131026, 131047, 131051, 132000, 132001, 132005, 132007, 132012,
]);

/** Codigos de Meta de throttling (spec, columna `rate_limit`). */
const CODIGOS_RATE_LIMIT = new Set([4, 80007, 130429, 131048, 131056]);

/** Codigo sintetico usado cuando la plantilla no trae `payload.variables` valido. */
const CODIGO_PLANTILLA_SIN_VARIABLES = 132012;

/** `filename` por defecto del documento cuando `payload.documento_nombre` no viene. */
const FILENAME_DOCUMENTO_DEFAULT = 'documento.pdf';

export interface MetaOutboxSenderOptions {
  /** Base del Graph API; sobreescribible en tests. Default: spec `META_GRAPH_URL`. */
  readonly graphUrl?: string;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  /** Inyectable para tests (sin red); default: `fetch` global de Node. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Base publica de `apps/api` para armar el link firmado de `outbox_messages.attachment_id`
   * (`GET /api/attachments/:id?f=<firma>`). Requerida si algun mensaje trae `attachmentId`.
   */
  readonly publicApiUrl?: string;
  /** Secreto HMAC compartido con `apps/api` para firmar el link del attachment. */
  readonly attachmentsLinkSecret?: string;
  /** Reloj inyectable (para tests deterministicos del `iat`/`exp` del link); default `new Date()`. */
  readonly ahora?: () => Date;
}

interface MetaErrorBody {
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

interface MetaOkBody {
  readonly messages?: readonly { readonly id?: string }[];
}

/** Sender real: habla con `${graphUrl}/${phoneNumberId}/messages` via HTTP. */
export class MetaOutboxSender implements OutboxSender {
  private readonly graphUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly publicApiUrl: string | undefined;
  private readonly attachmentsLinkSecret: string | undefined;
  private readonly ahora: () => Date;

  constructor(options: MetaOutboxSenderOptions) {
    this.graphUrl = options.graphUrl ?? GRAPH_URL_DEFAULT;
    this.phoneNumberId = options.phoneNumberId;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.publicApiUrl = options.publicApiUrl;
    this.attachmentsLinkSecret = options.attachmentsLinkSecret;
    this.ahora = options.ahora ?? (() => new Date());
  }

  async enviar(message: OutboxMessagePendiente): Promise<{ readonly wamidSalida: string }> {
    if (message.texto !== null) {
      if (message.attachmentId !== null) {
        throw new ErrorEnvio('permanente', 'texto con adjunto no soportado', {});
      }
      return this.enviarTexto(message.destino, message.texto);
    }
    if (message.template !== null) {
      return this.enviarTemplate(
        message.destino,
        message.template,
        message.payload,
        message.attachmentId,
      );
    }
    throw new ErrorEnvio('permanente', 'Mensaje de outbox sin texto ni template', {});
  }

  private async enviarTexto(
    destino: string,
    texto: string,
  ): Promise<{ readonly wamidSalida: string }> {
    const chunks = partirTexto(texto);
    let wamidSalida: string | undefined;
    for (const chunk of chunks) {
      const wamid = await this.postMensaje({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'text',
        text: { body: chunk },
      });
      if (wamidSalida === undefined) {
        wamidSalida = wamid;
      }
    }
    // chunks siempre tiene al menos un elemento -> wamidSalida siempre queda definido.
    return { wamidSalida: wamidSalida as string };
  }

  private async enviarTemplate(
    destino: string,
    template: string,
    payloadCrudo: unknown,
    attachmentId: string | null,
  ): Promise<{ readonly wamidSalida: string }> {
    const payload = objetoOVacio(payloadCrudo);
    const variables = payload.variables;
    if (!esArrayDeStrings(variables) || variables.length === 0) {
      throw new ErrorEnvio(
        'permanente',
        'Plantilla sin payload.variables valido (array de strings no vacio)',
        { codigo: CODIGO_PLANTILLA_SIN_VARIABLES },
      );
    }
    const idioma = typeof payload.idioma === 'string' && payload.idioma.trim() !== ''
      ? payload.idioma
      : 'es';

    const components: unknown[] = [];
    const documentoHeader = this.resolverDocumentoHeader(payload, attachmentId);
    if (documentoHeader !== null) {
      components.push({
        type: 'header',
        parameters: [{ type: 'document', document: documentoHeader }],
      });
    }
    components.push({
      type: 'body',
      parameters: variables.map((valor) => ({ type: 'text', text: valor })),
    });

    const wamid = await this.postMensaje({
      messaging_product: 'whatsapp',
      to: destino,
      type: 'template',
      template: {
        name: template,
        language: { code: idioma },
        components,
      },
    });
    return { wamidSalida: wamid };
  }

  /**
   * Resuelve el `document` del header de plantilla segun la precedencia de la spec:
   * `attachmentId` (link firmado, armado al momento del envio) gana sobre
   * `payload.documento` explicito. `null` si no hay documento que adjuntar.
   */
  private resolverDocumentoHeader(
    payload: Record<string, unknown>,
    attachmentId: string | null,
  ): { readonly link: string; readonly filename: string } | null {
    if (attachmentId !== null) {
      if (this.publicApiUrl === undefined || this.attachmentsLinkSecret === undefined) {
        throw new ErrorEnvio(
          'permanente',
          'outbox_messages.attachment_id presente pero el sender no tiene publicApiUrl/' +
            'attachmentsLinkSecret configurados: no se puede armar el link del documento',
          {},
        );
      }
      const link = firmarLinkAttachment({
        attachmentId,
        secreto: this.attachmentsLinkSecret,
        ahora: this.ahora(),
        publicApiUrl: this.publicApiUrl,
      });
      const filename = typeof payload.documento_nombre === 'string'
        && payload.documento_nombre.trim() !== ''
        ? payload.documento_nombre
        : FILENAME_DOCUMENTO_DEFAULT;
      return { link, filename };
    }

    const documento = objetoOVacio(payload.documento);
    if (typeof documento.link === 'string' && typeof documento.filename === 'string') {
      return { link: documento.link, filename: documento.filename };
    }
    return null;
  }

  /** POST al Graph API; devuelve el `wamid` o lanza el `ErrorEnvio` mapeado. */
  private async postMensaje(body: Record<string, unknown>): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.graphUrl}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ErrorEnvio(
        'transitorio',
        `Fallo de red enviando a Meta: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.ok) {
      let json: MetaOkBody | null = null;
      try {
        json = (await response.json()) as MetaOkBody;
      } catch {
        json = null;
      }
      const wamid = json?.messages?.[0]?.id;
      if (typeof wamid !== 'string' || wamid === '') {
        throw new ErrorEnvio('transitorio', 'Meta respondio 2xx sin wamid en messages[0].id');
      }
      return wamid;
    }

    let json: MetaErrorBody | null = null;
    try {
      json = (await response.json()) as MetaErrorBody;
    } catch {
      json = null;
    }

    const codigo = json?.error?.code;
    if (typeof codigo === 'number') {
      const mensaje = json?.error?.message ?? `Meta error ${codigo}`;
      if (CODIGOS_PERMANENTES.has(codigo)) {
        throw new ErrorEnvio('permanente', mensaje, { codigo });
      }
      if (CODIGOS_RATE_LIMIT.has(codigo)) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
        throw new ErrorEnvio('rate_limit', mensaje, {
          codigo,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
      }
      // Cualquier otro codigo de Meta no listado en la spec -> transitorio.
      throw new ErrorEnvio('transitorio', mensaje, { codigo });
    }

    // 5xx (u otro !ok) sin cuerpo de error interpretable -> transitorio.
    throw new ErrorEnvio(
      'transitorio',
      `Meta respondio HTTP ${response.status} sin cuerpo de error interpretable`,
    );
  }
}

/** Header `Retry-After` de Meta viene en segundos; `undefined` si falta o es invalido. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const segundos = Number(header);
  if (!Number.isFinite(segundos) || segundos < 0) return undefined;
  return segundos * 1000;
}

function esArrayDeStrings(valor: unknown): valor is string[] {
  return Array.isArray(valor) && valor.every((v) => typeof v === 'string');
}

function objetoOVacio(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/**
 * Parte `texto` en chunks de a lo sumo `maxLen` caracteres. Preferi cortar en el ultimo
 * salto de linea dentro de la ventana cuando no deja un chunk demasiado chico (evita
 * fragmentos de un caracter); si no hay uno razonable, corta duro en `maxLen` (logica del
 * legado `server.js` `sendWhatsAppMessage`, ~linea 1323).
 */
function partirTexto(texto: string, maxLen: number = LONGITUD_MAXIMA_TEXTO): string[] {
  if (texto.length <= maxLen) return [texto];

  const chunks: string[] = [];
  let resto = texto;
  while (resto.length > maxLen) {
    const ventana = resto.slice(0, maxLen);
    const corteEnSalto = ventana.lastIndexOf('\n');
    const cortaEnSalto = corteEnSalto > maxLen / 2;
    const largo = cortaEnSalto ? corteEnSalto : maxLen;
    chunks.push(resto.slice(0, largo));
    resto = cortaEnSalto ? resto.slice(largo + 1) : resto.slice(largo);
  }
  if (resto.length > 0) {
    chunks.push(resto);
  }
  return chunks;
}
