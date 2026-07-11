import { describe, expect, it } from 'vitest';

import { crearFakeCtx, crearFakeRepos, FakeToolStore } from './fakes.js';
import type { Actor } from './types.js';

const ACTOR_INTERNO: Actor = {
  userId: 'user-1',
  nombre: 'Jose Pablo',
  roles: ['admin_materiales'],
};

describe('ConversacionRepo (fake) — agente-conversacional.md §A4', () => {
  it('upsertPorTelefono crea la conversacion la primera vez y actualiza la ventana despues', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const primero = new Date('2026-07-10T10:00:00.000Z');
    const segundo = new Date('2026-07-10T15:00:00.000Z');

    const creada = await repos.conversaciones.upsertPorTelefono({
      phone: '+50688880002',
      userId: 'user-1',
      recibidoAt: primero,
    });
    expect(store.conversaciones).toHaveLength(1);
    expect(store.conversaciones[0]).toMatchObject({
      id: creada.id,
      phone: '+50688880002',
      userId: 'user-1',
      supplierContactId: null,
    });

    const actualizada = await repos.conversaciones.upsertPorTelefono({
      phone: '+50688880002',
      recibidoAt: segundo,
    });

    // Mismo telefono -> misma fila (id estable), nunca duplicada.
    expect(actualizada.id).toBe(creada.id);
    expect(store.conversaciones).toHaveLength(1);
    expect(store.conversaciones[0]?.lastMessageAt).toEqual(segundo);
    expect(store.conversaciones[0]?.ventana24hExpiraAt).toEqual(
      new Date(segundo.getTime() + 24 * 60 * 60 * 1000),
    );
    // El segundo upsert no trajo userId: el vinculo previo se preserva (COALESCE), no se borra.
    expect(store.conversaciones[0]?.userId).toBe('user-1');
  });

  it('upsertPorTelefono fija el vinculo de proveedor cuando la conversacion nace sin vinculo', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const ahora = new Date('2026-07-10T10:00:00.000Z');

    // Un desconocido primero (agente-conversacional.md §A4: anonima, sin user/supplier).
    await repos.conversaciones.upsertPorTelefono({ phone: '+50688881001', recibidoAt: ahora });
    expect(store.conversaciones[0]?.supplierContactId).toBeNull();

    // Luego se resuelve como contacto de proveedor: el vinculo se fija sin duplicar fila.
    const luego = new Date('2026-07-10T11:00:00.000Z');
    await repos.conversaciones.upsertPorTelefono({
      phone: '+50688881001',
      supplierContactId: 'contacto-1',
      recibidoAt: luego,
    });
    expect(store.conversaciones).toHaveLength(1);
    expect(store.conversaciones[0]?.supplierContactId).toBe('contacto-1');
  });

  it('ventanaVigente distingue vigente/vencida y matchea telefono con/sin "+"', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const recibido = new Date('2026-07-10T10:00:00.000Z');
    await repos.conversaciones.upsertPorTelefono({ phone: '+50688880002', recibidoAt: recibido });

    expect(
      await repos.conversaciones.ventanaVigente('+50688880002', new Date('2026-07-10T20:00:00.000Z')),
    ).toBe(true);
    // Formato sin '+' (como llega mensaje.fromPhone crudo de Meta) tambien matchea.
    expect(
      await repos.conversaciones.ventanaVigente('50688880002', new Date('2026-07-10T20:00:00.000Z')),
    ).toBe(true);
    // Vencida (> 24h despues de recibido).
    expect(
      await repos.conversaciones.ventanaVigente('+50688880002', new Date('2026-07-11T10:00:01.000Z')),
    ).toBe(false);
    // Telefono sin conversacion.
    expect(
      await repos.conversaciones.ventanaVigente('+50699999999', recibido),
    ).toBe(false);
  });

  it('historialPorTelefono intercala entrantes/salientes por fecha ascendente y respeta el limite', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    const phone = '+50688880002';

    store.agregarMensajeEntrante({
      phone,
      texto: 'hola, necesito cemento',
      at: new Date('2026-07-10T10:00:00.000Z'),
    });

    const ctxT1 = crearFakeCtx(store, ACTOR_INTERNO, new Date('2026-07-10T10:05:00.000Z'));
    await ctxT1.outbox({ destino: phone, texto: 'Con gusto, ¿cuanto necesitas?' });

    store.agregarMensajeEntrante({
      phone,
      texto: '10 sacos',
      at: new Date('2026-07-10T10:10:00.000Z'),
    });

    const ctxT2 = crearFakeCtx(store, ACTOR_INTERNO, new Date('2026-07-10T10:15:00.000Z'));
    await ctxT2.outbox({ destino: phone, template: 'notificacion_interna', payload: {} });

    const historial = await repos.conversaciones.historialPorTelefono(phone);

    expect(historial).toEqual([
      { direccion: 'entrante', texto: 'hola, necesito cemento', at: new Date('2026-07-10T10:00:00.000Z') },
      { direccion: 'saliente', texto: 'Con gusto, ¿cuanto necesitas?', at: new Date('2026-07-10T10:05:00.000Z') },
      { direccion: 'entrante', texto: '10 sacos', at: new Date('2026-07-10T10:10:00.000Z') },
      { direccion: 'saliente', texto: '[plantilla notificacion_interna]', at: new Date('2026-07-10T10:15:00.000Z') },
    ]);

    const ultimos2 = await repos.conversaciones.historialPorTelefono(phone, 2);
    expect(ultimos2).toEqual([
      { direccion: 'entrante', texto: '10 sacos', at: new Date('2026-07-10T10:10:00.000Z') },
      { direccion: 'saliente', texto: '[plantilla notificacion_interna]', at: new Date('2026-07-10T10:15:00.000Z') },
    ]);
  });

  it('historialPorTelefono no mezcla mensajes de otro telefono', async () => {
    const store = new FakeToolStore();
    const repos = crearFakeRepos(store);
    store.agregarMensajeEntrante({
      phone: '+50688880002',
      texto: 'mio',
      at: new Date('2026-07-10T10:00:00.000Z'),
    });
    store.agregarMensajeEntrante({
      phone: '+50688881001',
      texto: 'ajeno',
      at: new Date('2026-07-10T10:01:00.000Z'),
    });

    const historial = await repos.conversaciones.historialPorTelefono('+50688880002');
    expect(historial).toHaveLength(1);
    expect(historial[0]?.texto).toBe('mio');
  });
});
