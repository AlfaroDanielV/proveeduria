import { describe, expect, it } from 'vitest';

import { aplicarStatuses, ingestar } from './ingest.js';
import { parseMeta } from './parse.js';
import type { MensajeEntrante, StatusEntrega } from './parse.js';
import { FakeEntregaStore } from '../db/entregas.js';
import { FakeInboundStore } from '../db/inbound.js';
import { InMemoryQueue } from '../queue/index.js';

function msg(wamid: string, texto = 'hola'): MensajeEntrante {
  return { wamid, from: '50688887777', tipo: 'texto', texto, raw: { id: wamid } };
}

function status(wamid: string, estado: StatusEntrega['estado'], errores?: unknown): StatusEntrega {
  return { wamid, estado, ...(errores !== undefined ? { errores } : {}) };
}

describe('ingestar', () => {
  it('persiste y encola un mensaje nuevo (un solo efecto)', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();

    const res = await ingestar([msg('w1')], { store, queue });

    expect(res).toEqual({ recibidos: 1, encolados: 1, duplicados: 0 });
    expect(store.registros).toHaveLength(1);
    expect(store.registros[0]).toMatchObject({ wamid: 'w1', fromPhone: '50688887777', tipo: 'texto' });
    expect(queue.jobs).toEqual([{ wamid: 'w1' }]);
  });

  it('ante un wamid DUPLICADO encola exactamente 1 vez', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();

    const res = await ingestar([msg('dup'), msg('dup')], { store, queue });

    expect(res).toEqual({ recibidos: 2, encolados: 1, duplicados: 1 });
    expect(store.registros).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.wamid).toBe('dup');
  });

  it('no re-encola un wamid ya visto en una entrega anterior', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();

    await ingestar([msg('w9')], { store, queue });
    const res = await ingestar([msg('w9')], { store, queue }); // reintento de Meta

    expect(res).toEqual({ recibidos: 1, encolados: 0, duplicados: 1 });
    expect(queue.jobs).toHaveLength(1);
  });

  it('encola cada wamid distinto una vez', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();

    const res = await ingestar([msg('a'), msg('b'), msg('c')], { store, queue });

    expect(res.encolados).toBe(3);
    expect(queue.jobs.map((j) => j.wamid)).toEqual(['a', 'b', 'c']);
  });

  it('con lista vacia no hace nada', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();

    const res = await ingestar([], { store, queue });

    expect(res).toEqual({ recibidos: 0, encolados: 0, duplicados: 0 });
    expect(queue.jobs).toHaveLength(0);
  });
});

describe('aplicarStatuses', () => {
  it('aplica un status de un wamid conocido', async () => {
    const entregas = new FakeEntregaStore(['wOUT1']);

    const res = await aplicarStatuses([status('wOUT1', 'delivered')], entregas);

    expect(res).toEqual({ recibidos: 1, aplicados: 1, ignorados: 0 });
    expect(entregas.estadoDe('wOUT1')).toBe('delivered');
  });

  it('ignora (sin lanzar) un status de wamid desconocido', async () => {
    const entregas = new FakeEntregaStore(); // sin wamids registrados

    const res = await aplicarStatuses([status('wOUT-DESCONOCIDO', 'sent')], entregas);

    expect(res).toEqual({ recibidos: 1, aplicados: 0, ignorados: 1 });
  });

  it('procesa varios statuses, mezclando conocidos y desconocidos', async () => {
    const entregas = new FakeEntregaStore(['a', 'b']);

    const res = await aplicarStatuses(
      [status('a', 'sent'), status('x', 'sent'), status('b', 'delivered')],
      entregas,
    );

    expect(res).toEqual({ recibidos: 3, aplicados: 2, ignorados: 1 });
  });

  it('con lista vacia no hace nada', async () => {
    const entregas = new FakeEntregaStore();

    const res = await aplicarStatuses([], entregas);

    expect(res).toEqual({ recibidos: 0, aplicados: 0, ignorados: 0 });
  });
});

describe('wiring del webhook: parseMeta -> ingestar + aplicarStatuses', () => {
  it('payload con SOLO statuses: no encola nada y aplica el status', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();
    const entregas = new FakeEntregaStore(['wOUT1']);

    const payload = {
      entry: [
        { changes: [{ value: { statuses: [{ id: 'wOUT1', status: 'sent' }] } }] },
      ],
    };
    const { mensajes, statuses } = parseMeta(payload);

    const resMensajes = await ingestar(mensajes, { store, queue });
    const resStatuses = await aplicarStatuses(statuses, entregas);

    expect(resMensajes).toEqual({ recibidos: 0, encolados: 0, duplicados: 0 });
    expect(resStatuses).toEqual({ recibidos: 1, aplicados: 1, ignorados: 0 });
    expect(entregas.estadoDe('wOUT1')).toBe('sent');
  });

  it('payload MIXTO (mensajes + statuses): ingesta el mensaje y aplica el status', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();
    const entregas = new FakeEntregaStore(['wOUT1']);

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '50688887777', id: 'wIN1', type: 'text', text: { body: 'hola' } }],
                statuses: [{ id: 'wOUT1', status: 'read' }],
              },
            },
          ],
        },
      ],
    };
    const { mensajes, statuses } = parseMeta(payload);

    const resMensajes = await ingestar(mensajes, { store, queue });
    const resStatuses = await aplicarStatuses(statuses, entregas);

    expect(resMensajes).toEqual({ recibidos: 1, encolados: 1, duplicados: 0 });
    expect(queue.jobs).toEqual([{ wamid: 'wIN1' }]);
    expect(resStatuses).toEqual({ recibidos: 1, aplicados: 1, ignorados: 0 });
    expect(entregas.estadoDe('wOUT1')).toBe('read');
  });

  it('status de wamid desconocido: se ignora sin afectar la ingesta de mensajes', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();
    const entregas = new FakeEntregaStore(); // sin wamids registrados: todo desconocido

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '50688887777', id: 'wIN1', type: 'text', text: { body: 'hola' } }],
                statuses: [{ id: 'wOUT-LEGADO', status: 'delivered' }],
              },
            },
          ],
        },
      ],
    };
    const { mensajes, statuses } = parseMeta(payload);

    const resMensajes = await ingestar(mensajes, { store, queue });
    const resStatuses = await aplicarStatuses(statuses, entregas);

    expect(resMensajes.encolados).toBe(1);
    expect(resStatuses).toEqual({ recibidos: 1, aplicados: 0, ignorados: 1 });
    expect(entregas.estadoDe('wOUT-LEGADO')).toBeUndefined();
  });
});
