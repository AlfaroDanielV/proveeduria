/**
 * Matriz de modos de `planificarArranque` (funcion pura del composition root).
 */

import { describe, expect, it } from 'vitest';
import type { WorkerConfig } from './config.js';
import { planificarArranque } from './index.js';

function config(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    queueName: 'ingesta',
    visibilidadSegundos: 120,
    maxDequeue: 5,
    esperaVacioMs: 1000,
    outboxMode: 'off',
    outboxPollMs: 2000,
    metaGraphUrl: 'https://graph.facebook.com/v23.0',
    claimLeaseSegundos: 300,
    outboxBatch: 20,
    ...overrides,
  };
}

describe('planificarArranque', () => {
  it('sin DATABASE_URL: stub echo + InMemory, outbox off, sin advertencias', () => {
    const plan = planificarArranque(config());
    expect(plan).toEqual({
      handler: 'echo',
      consumer: 'memoria',
      outbox: 'off',
      advertencias: [],
    });
  });

  it('sin DATABASE_URL pero outbox console: se desactiva con advertencia', () => {
    const plan = planificarArranque(config({ outboxMode: 'console' }));
    expect(plan.handler).toBe('echo');
    expect(plan.consumer).toBe('memoria');
    expect(plan.outbox).toBe('off');
    expect(plan.advertencias).toHaveLength(1);
    expect(plan.advertencias[0]).toContain('DATABASE_URL');
  });

  it('con DATABASE_URL sin cola Azure: dominio + InMemory con advertencia', () => {
    const plan = planificarArranque(config({ databaseUrl: 'postgres://x' }));
    expect(plan.handler).toBe('dominio');
    expect(plan.consumer).toBe('memoria');
    expect(plan.outbox).toBe('off');
    expect(plan.advertencias).toHaveLength(1);
    expect(plan.advertencias[0]).toContain('AZURE_STORAGE_QUEUE_CONNECTION');
  });

  it('con DATABASE_URL y cola Azure: dominio + Azure, outbox off, sin advertencias', () => {
    const plan = planificarArranque(
      config({ databaseUrl: 'postgres://x', azureQueueConnection: 'UseDevelopmentStorage=true' }),
    );
    expect(plan).toEqual({
      handler: 'dominio',
      consumer: 'azure',
      outbox: 'off',
      advertencias: [],
    });
  });

  it('con DATABASE_URL, Azure y outbox console: dominio + Azure + outbox console', () => {
    const plan = planificarArranque(
      config({
        databaseUrl: 'postgres://x',
        azureQueueConnection: 'UseDevelopmentStorage=true',
        outboxMode: 'console',
      }),
    );
    expect(plan).toEqual({
      handler: 'dominio',
      consumer: 'azure',
      outbox: 'console',
      advertencias: [],
    });
  });

  it('con DATABASE_URL sin Azure y outbox console: outbox corre igual, con advertencia de InMemory', () => {
    const plan = planificarArranque(
      config({ databaseUrl: 'postgres://x', outboxMode: 'console' }),
    );
    expect(plan.handler).toBe('dominio');
    expect(plan.consumer).toBe('memoria');
    expect(plan.outbox).toBe('console');
    expect(plan.advertencias).toHaveLength(1);
    expect(plan.advertencias[0]).toContain('AZURE_STORAGE_QUEUE_CONNECTION');
  });

  it('sin DATABASE_URL pero outbox meta: se desactiva con advertencia', () => {
    const plan = planificarArranque(
      config({
        outboxMode: 'meta',
        metaPhoneNumberId: '123',
        metaAccessToken: 'token',
      }),
    );
    expect(plan.handler).toBe('echo');
    expect(plan.consumer).toBe('memoria');
    expect(plan.outbox).toBe('off');
    expect(plan.advertencias).toHaveLength(1);
    expect(plan.advertencias[0]).toContain('DATABASE_URL');
    expect(plan.advertencias[0]).toContain('meta');
  });

  it('con DATABASE_URL y Azure y outbox meta: dominio + Azure + outbox meta, sin advertencias', () => {
    const plan = planificarArranque(
      config({
        databaseUrl: 'postgres://x',
        azureQueueConnection: 'UseDevelopmentStorage=true',
        outboxMode: 'meta',
        metaPhoneNumberId: '123',
        metaAccessToken: 'token',
      }),
    );
    expect(plan).toEqual({
      handler: 'dominio',
      consumer: 'azure',
      outbox: 'meta',
      advertencias: [],
    });
  });

  it('con DATABASE_URL sin Azure y outbox meta: outbox corre igual, con advertencia de InMemory', () => {
    const plan = planificarArranque(
      config({
        databaseUrl: 'postgres://x',
        outboxMode: 'meta',
        metaPhoneNumberId: '123',
        metaAccessToken: 'token',
      }),
    );
    expect(plan.handler).toBe('dominio');
    expect(plan.consumer).toBe('memoria');
    expect(plan.outbox).toBe('meta');
    expect(plan.advertencias).toHaveLength(1);
    expect(plan.advertencias[0]).toContain('AZURE_STORAGE_QUEUE_CONNECTION');
  });
});
