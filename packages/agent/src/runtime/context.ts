import type { Actor, Ctx, Repos, Tx } from './types.js';
import type { OrigenAudit } from '@proveeduria/core';
import { crearAuditInserter } from './audit.js';
import { crearOutboxInserter } from './outbox.js';
import { crearReposPg } from './repos.js';

export interface CrearCtxOptions {
  readonly tx: Tx;
  readonly actor: Actor;
  readonly ahora: Date;
  readonly origen?: OrigenAudit;
  readonly repos?: Repos;
}

export function crearCtx({
  tx,
  actor,
  ahora,
  origen = 'system',
  repos = crearReposPg(tx),
}: CrearCtxOptions): Ctx {
  return {
    tx,
    actor,
    ahora,
    origen,
    audit: crearAuditInserter(tx, actor, ahora, origen),
    outbox: crearOutboxInserter(tx),
    repos,
  };
}
