import type { Actor, Ctx, Tx } from '@proveeduria/agent';
import type { Job } from '../queue/index.js';

export interface InboundMessage {
  readonly id: string;
  readonly wamid: string;
  readonly fromPhone: string;
  readonly tipo: string;
  readonly payload: unknown;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export interface InboundMessageRepo {
  bloquearPorWamid(wamid: string): Promise<InboundMessage | null>;
  marcarProcesado(id: string, at: Date): Promise<void>;
  /** Vincula el inbound a la conversacion resuelta (agente-conversacional.md §A4). */
  fijarConversacion(id: string, conversationId: string): Promise<void>;
}

export interface SupplierContactContext {
  readonly id: string;
  readonly supplierId: string;
  readonly nombre: string | null;
  readonly telefonoWhatsapp: string;
  readonly optinAt: Date | null;
}

export type ContextoRemitenteDominio =
  | {
      readonly tipo: 'interno';
      readonly actor: Actor;
      readonly telefonoWhatsapp: string;
    }
  | {
      readonly tipo: 'proveedor';
      readonly supplierContact: SupplierContactContext;
    }
  | {
      readonly tipo: 'desconocido';
      readonly telefonoWhatsapp: string;
    };

export interface RemitenteResolver {
  resolverPorTelefono(phone: string): Promise<ContextoRemitenteDominio>;
}

export interface TransactionRunner {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Adjunto entrante ya descargado y persistido por el pipeline de media (media.ts,
 * agente-conversacional.md §A6): el engine del proveedor lo convierte en el material del
 * extractor sin re-leer los bytes desde `attachment_blobs`. `fuente` es la fuente extraible
 * (imagen/pdf/audio) derivada del tipo del inbound.
 */
export interface AdjuntoInbound {
  readonly attachmentId: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly fuente: 'imagen' | 'pdf' | 'audio';
}

export interface DomainEngineInput {
  readonly job: Job;
  readonly mensaje: InboundMessage;
  readonly contexto: ContextoRemitenteDominio;
  readonly tx: Tx;
  readonly ahora: Date;
  readonly ctx?: Ctx;
  /** Adjunto descargado por el pipeline de media (A6), si el inbound trae media. */
  readonly adjunto?: AdjuntoInbound;
}

export interface DomainEngine {
  procesar(input: DomainEngineInput): Promise<void>;
}

export interface UnknownSenderReporter {
  reportar(input: {
    readonly tx: Tx;
    readonly mensaje: InboundMessage;
    readonly contexto: Extract<ContextoRemitenteDominio, { tipo: 'desconocido' }>;
    readonly ahora: Date;
  }): Promise<void>;
}
