import { describe, expect, it } from 'vitest';

import { ingestar } from './ingest.js';
import type { MensajeEntrante } from './parse.js';
import { FakeInboundStore } from '../db/inbound.js';
import { InMemoryQueue } from '../queue/index.js';

function msg(wamid: string, texto = 'hola'): MensajeEntrante {
  return { wamid, from: '50688887777', tipo: 'texto', texto, raw: { id: wamid } };
}

describe('ingestar', () => {
  it('persiste y encola un mensaje nuevo (un solo efecto)', async () => {
    const store = new FakeInboundStore();
    const queue = new InMemoryQueue();

    const res = await ingestar([msg('w1')], { store, queue });

    expect(res).toEqual({ recibidos: 1, encolados: 1, duplicados: 0 });
    expect(store.registros).toHaveLength(1);
    expect(store.registros[0]).toMatchObject({ wamid: 'w1', fromPhone: '50688887777', tipo: 'texto' });
    expect(queue.jobs).toEqual([{ wamid: 'w1', from: '50688887777', tipo: 'texto' }]);
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
