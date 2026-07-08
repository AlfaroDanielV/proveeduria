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

export interface DomainEngineInput {
  readonly job: Job;
  readonly mensaje: InboundMessage;
  readonly contexto: ContextoRemitenteDominio;
  readonly tx: Tx;
  readonly ahora: Date;
  readonly ctx?: Ctx;
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
