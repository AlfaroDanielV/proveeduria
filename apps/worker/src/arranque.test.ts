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
    cronPollMs: 60000,
    agentModel: 'claude-sonnet-5',
    agentExtractModel: 'claude-haiku-4-5-20251001',
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
      engine: 'estructurado',
      cron: false,
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
      engine: 'estructurado',
      cron: true,
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
      engine: 'estructurado',
      cron: true,
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
      engine: 'estructurado',
      cron: true,
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

  it('sin DATABASE_URL: cron E1 apagado (necesita Postgres)', () => {
    expect(planificarArranque(config()).cron).toBe(false);
    // Tampoco lo enciende pedir outbox console/meta sin DB.
    expect(planificarArranque(config({ outboxMode: 'console' })).cron).toBe(false);
  });

  it('con DATABASE_URL: cron E1 encendido (con o sin Azure)', () => {
    expect(planificarArranque(config({ databaseUrl: 'postgres://x' })).cron).toBe(true);
    expect(
      planificarArranque(
        config({ databaseUrl: 'postgres://x', azureQueueConnection: 'UseDevelopmentStorage=true' }),
      ).cron,
    ).toBe(true);
  });

  it('sin ANTHROPIC_API_KEY: engine estructurado (gating §A5)', () => {
    expect(planificarArranque(config()).engine).toBe('estructurado');
    expect(planificarArranque(config({ databaseUrl: 'postgres://x' })).engine).toBe('estructurado');
  });

  it('con ANTHROPIC_API_KEY: engine claude (seam tool_call-en-texto apagado)', () => {
    expect(planificarArranque(config({ anthropicApiKey: 'sk-ant-xyz' })).engine).toBe('claude');
    const plan = planificarArranque(
      config({ databaseUrl: 'postgres://x', anthropicApiKey: 'sk-ant-xyz' }),
    );
    expect(plan).toEqual({
      handler: 'dominio',
      consumer: 'memoria',
      outbox: 'off',
      engine: 'claude',
      cron: true,
      advertencias: [
        'DATABASE_URL presente sin AZURE_STORAGE_QUEUE_CONNECTION: se usa InMemoryConsumer (solo dev/test, no durable).',
      ],
    });
  });
});
