import { describe, expect, it } from 'vitest';

import { FakeEntregaStore } from './entregas.js';
import type { StatusEntrega } from '../webhook/parse.js';

function status(wamid: string, estado: StatusEntrega['estado'], errores?: unknown): StatusEntrega {
  return { wamid, estado, ...(errores !== undefined ? { errores } : {}) };
}

describe('FakeEntregaStore', () => {
  it('ignora un wamid desconocido (no registrado)', async () => {
    const store = new FakeEntregaStore();

    const aplicado = await store.aplicarStatus(status('w1', 'sent'));

    expect(aplicado).toBe(false);
    expect(store.estadoDe('w1')).toBeUndefined();
  });

  it('aplica el primer status de un wamid conocido', async () => {
    const store = new FakeEntregaStore(['w1']);

    const aplicado = await store.aplicarStatus(status('w1', 'sent'));

    expect(aplicado).toBe(true);
    expect(store.estadoDe('w1')).toBe('sent');
  });

  it('guard monotonico: sent -> delivered -> read avanza; un rango menor no pisa uno mayor', async () => {
    const store = new FakeEntregaStore(['w1']);

    expect(await store.aplicarStatus(status('w1', 'sent'))).toBe(true);
    expect(await store.aplicarStatus(status('w1', 'delivered'))).toBe(true);
    expect(await store.aplicarStatus(status('w1', 'read'))).toBe(true);
    // 'delivered' llega tarde (fuera de orden): no debe pisar 'read'.
    expect(await store.aplicarStatus(status('w1', 'delivered'))).toBe(false);

    expect(store.estadoDe('w1')).toBe('read');
  });

  it('reaplicar el mismo status es idempotente (no cambia nada)', async () => {
    const store = new FakeEntregaStore(['w1']);

    await store.aplicarStatus(status('w1', 'delivered'));
    const reaplicado = await store.aplicarStatus(status('w1', 'delivered'));

    expect(reaplicado).toBe(false);
    expect(store.estadoDe('w1')).toBe('delivered');
  });

  it("'failed' SIEMPRE se aplica y guarda los errores crudos", async () => {
    const store = new FakeEntregaStore(['w1']);
    const errores = [{ code: 131047, title: 'fuera de ventana de 24h' }];

    await store.aplicarStatus(status('w1', 'sent'));
    const aplicado = await store.aplicarStatus(status('w1', 'failed', errores));

    expect(aplicado).toBe(true);
    expect(store.estadoDe('w1')).toBe('failed');
    expect(store.erroresDe('w1')).toEqual(errores);
  });

  it("un status de progreso no pisa un 'failed' ya registrado", async () => {
    const store = new FakeEntregaStore(['w1']);

    await store.aplicarStatus(status('w1', 'failed', [{ code: 131047 }]));
    const aplicado = await store.aplicarStatus(status('w1', 'sent'));

    expect(aplicado).toBe(false);
    expect(store.estadoDe('w1')).toBe('failed');
  });

  it('registrarWamid permite marcar un wamid como conocido despues de construido', async () => {
    const store = new FakeEntregaStore();
    store.registrarWamid('w9');

    expect(await store.aplicarStatus(status('w9', 'sent'))).toBe(true);
  });
});
