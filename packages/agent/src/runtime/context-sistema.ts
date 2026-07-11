import type { OrigenAudit } from '@proveeduria/core';
import type { Actor, AuditEvent, Ctx, Repos, Tx } from './types.js';
import { crearOutboxInserter } from './outbox.js';
import { crearReposPg } from './repos.js';

/**
 * Actor sintetico para operaciones automaticas del sistema (crons: E1 vencimientos, y a
 * futuro E13/resumen). NO representa a un usuario: los procesos de sistema no pasan por
 * `puedeUsarTool` (cada tool/rutina de sistema lo documenta). Su `userId` es nominal y NUNCA
 * se persiste — el `audit_event` de un `Ctx` de sistema va con `actor_user_id = null` y
 * `actor_sistema = true` (misma convencion que `PgUnknownSenderReporter`/el dispatcher de
 * outbox del worker).
 */
export const ACTOR_SISTEMA: Actor = {
  userId: '00000000-0000-0000-0000-000000000000',
  nombre: 'Sistema',
  roles: [],
};

/**
 * `true` si el `Actor` es el sistema sintetico (`ACTOR_SISTEMA`). Lo usa el guard de
 * `registrar_cotizacion` (tools.md §registrar_cotizacion "Actor"): el mensaje de proveedor
 * se ejecuta como actor sistema (sin roles) y esa es la UNICA via por la que la tool acepta
 * un actor sin rol interno — nunca relaja la validacion para actores con roles.
 */
export function esActorSistema(actor: Actor): boolean {
  return actor.userId === ACTOR_SISTEMA.userId;
}

const SQL_INSERT_AUDIT_SISTEMA =
  'INSERT INTO audit_events ' +
  '(actor_user_id, actor_sistema, accion, entidad, entidad_id, pedido_id, antes, despues, origen, at) ' +
  'VALUES (null, true, $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)';

function crearAuditInserterSistema(
  tx: Tx,
  ahora: Date,
  origenDefault: OrigenAudit,
): (event: AuditEvent) => Promise<void> {
  return async (event) => {
    await tx.query(SQL_INSERT_AUDIT_SISTEMA, [
      event.accion,
      event.entidad,
      event.entidadId ?? null,
      event.pedidoId ?? null,
      JSON.stringify(event.antes ?? null),
      JSON.stringify(event.despues ?? null),
      event.origen ?? origenDefault,
      ahora,
    ]);
  };
}

export interface CrearCtxSistemaOptions {
  readonly tx: Tx;
  readonly ahora: Date;
  /** Origen de auditoria; por defecto `cron` (unico consumidor actual son los crons). */
  readonly origen?: OrigenAudit;
  readonly repos?: Repos;
}

/**
 * Construye un `Ctx` para rutinas de sistema (sin usuario). El `audit` escribe filas de
 * sistema (`actor_sistema = true`, `actor_user_id = null`); el `outbox` es el mismo inserter
 * de siempre; `approval` rechaza porque un proceso de sistema no registra aprobaciones (si
 * algun dia hiciera falta, se especifica antes). Lo usan el cron E1 del worker y su test de
 * integracion para ejercer `procesarVencimientos` con la misma convencion.
 */
export function crearCtxSistema({
  tx,
  ahora,
  origen = 'cron',
  repos = crearReposPg(tx),
}: CrearCtxSistemaOptions): Ctx {
  return {
    tx,
    actor: ACTOR_SISTEMA,
    ahora,
    origen,
    audit: crearAuditInserterSistema(tx, ahora, origen),
    outbox: crearOutboxInserter(tx),
    approval: () =>
      Promise.reject(
        new Error('El Ctx de sistema no registra approval_events (operacion automatica).'),
      ),
    repos,
  };
}
