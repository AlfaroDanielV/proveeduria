/**
 * Orquestacion persistir -> encolar del webhook (EXECUTION_PLAN §1.3-4), y aplicacion
 * INLINE de statuses de entrega de Meta (docs/specs/outbox-whatsapp.md "Statuses de
 * Meta").
 *
 * Por cada mensaje: se persiste en `inbound_messages` y SOLO si la insercion fue
 * nueva (no duplicado por `wamid`) se encola el job. Asi un reintento de Meta con el
 * mismo `wamid` produce un unico efecto. Persistir SIEMPRE ocurre antes de encolar.
 *
 * Los `statuses[]` del mismo payload se aplican DESPUES, con un UPDATE indexado por
 * `wamid_salida` (sin cola: no amerita IA ni trabajo pesado). Un `wamid` desconocido
 * (trafico del prototipo legado u otro canal) se ignora con log, nunca lanza.
 *
 * Sin IO propio: recibe `store`/`queue`/`entregas` inyectados (interfaces), testeable
 * con fakes en memoria.
 */

import type { MensajeEntrante, StatusEntrega } from './parse.js';
import type { EntregaStore } from '../db/entregas.js';
import type { InboundStore } from '../db/inbound.js';
import type { QueueClient } from '../queue/index.js';

export interface DependenciasIngesta {
  readonly store: InboundStore;
  readonly queue: QueueClient;
}

export interface ResultadoIngesta {
  readonly recibidos: number;
  readonly encolados: number;
  readonly duplicados: number;
}

export async function ingestar(
  mensajes: readonly MensajeEntrante[],
  { store, queue }: DependenciasIngesta,
): Promise<ResultadoIngesta> {
  let encolados = 0;
  let duplicados = 0;

  for (const m of mensajes) {
    const insertado = await store.insertarSiNuevo({
      wamid: m.wamid,
      fromPhone: m.from,
      tipo: m.tipo,
      payload: m.raw,
    });

    if (insertado) {
      await queue.enqueue({ wamid: m.wamid });
      encolados += 1;
    } else {
      duplicados += 1;
    }
  }

  return { recibidos: mensajes.length, encolados, duplicados };
}

export interface ResultadoAplicarStatuses {
  readonly recibidos: number;
  readonly aplicados: number;
  /** `wamid` desconocido o status de rango menor bloqueado por el guard monotonico. */
  readonly ignorados: number;
}

/**
 * Aplica cada `StatusEntrega` a `outbox_messages` via `entregas` (interfaz inyectada).
 * Un status ignorado (wamid desconocido) NO lanza: se cuenta y se loguea, para no
 * convertir trafico ajeno al outbox en un 500 que Meta reintentaria sin sentido.
 */
export async function aplicarStatuses(
  statuses: readonly StatusEntrega[],
  entregas: EntregaStore,
): Promise<ResultadoAplicarStatuses> {
  let aplicados = 0;
  let ignorados = 0;

  for (const s of statuses) {
    const aplicado = await entregas.aplicarStatus(s);
    if (aplicado) {
      aplicados += 1;
    } else {
      ignorados += 1;
      // eslint-disable-next-line no-console
      console.warn(`status de entrega ignorado (wamid desconocido o fuera de orden): ${s.wamid} -> ${s.estado}`);
    }
  }

  return { recibidos: statuses.length, aplicados, ignorados };
}
