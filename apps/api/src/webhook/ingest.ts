/**
 * Orquestacion persistir -> encolar del webhook (EXECUTION_PLAN §1.3-4).
 *
 * Por cada mensaje: se persiste en `inbound_messages` y SOLO si la insercion fue
 * nueva (no duplicado por `wamid`) se encola el job. Asi un reintento de Meta con el
 * mismo `wamid` produce un unico efecto. Persistir SIEMPRE ocurre antes de encolar.
 *
 * Sin IO propio: recibe `store` y `queue` inyectados (interfaces), testeable con
 * fakes en memoria.
 */

import type { MensajeEntrante } from './parse.js';
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
      await queue.enqueue({ wamid: m.wamid, from: m.from, tipo: m.tipo });
      encolados += 1;
    } else {
      duplicados += 1;
    }
  }

  return { recibidos: mensajes.length, encolados, duplicados };
}
