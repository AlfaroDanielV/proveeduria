/**
 * Parseo de `cargarConfig`, con foco en los campos del dispatcher de outbox.
 */

import { describe, expect, it } from 'vitest';
import { cargarConfig } from './config.js';

describe('cargarConfig', () => {
  it('usa defaults de outbox cuando el entorno esta vacio', () => {
    const config = cargarConfig({});
    expect(config.outboxMode).toBe('off');
    expect(config.outboxPollMs).toBe(2000);
    expect(config.databaseUrl).toBeUndefined();
    expect(config.azureQueueConnection).toBeUndefined();
    expect(config.metaPhoneNumberId).toBeUndefined();
    expect(config.metaAccessToken).toBeUndefined();
    expect(config.metaGraphUrl).toBe('https://graph.facebook.com/v23.0');
    expect(config.claimLeaseSegundos).toBe(300);
    expect(config.outboxBatch).toBe(20);
    expect(config.cronPollMs).toBe(60000);
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.agentModel).toBe('claude-sonnet-5');
  });

  it('lee ANTHROPIC_API_KEY y AGENT_MODEL cuando estan presentes', () => {
    const config = cargarConfig({ ANTHROPIC_API_KEY: 'sk-ant-xyz', AGENT_MODEL: 'claude-opus-4-8' });
    expect(config.anthropicApiKey).toBe('sk-ant-xyz');
    expect(config.agentModel).toBe('claude-opus-4-8');
  });

  it('AGENT_MODEL vacio cae al default y ANTHROPIC_API_KEY vacio queda undefined', () => {
    const config = cargarConfig({ ANTHROPIC_API_KEY: '   ', AGENT_MODEL: '  ' });
    expect(config.anthropicApiKey).toBeUndefined();
    expect(config.agentModel).toBe('claude-sonnet-5');
  });

  it('respeta WORKER_CRON_POLL_MS y cae al default si es invalido', () => {
    expect(cargarConfig({ WORKER_CRON_POLL_MS: '15000' }).cronPollMs).toBe(15000);
    expect(cargarConfig({ WORKER_CRON_POLL_MS: 'abc' }).cronPollMs).toBe(60000);
  });

  it('activa outbox console y respeta el intervalo configurado', () => {
    const config = cargarConfig({
      WORKER_OUTBOX_MODE: 'console',
      WORKER_OUTBOX_POLL_MS: '500',
    });
    expect(config.outboxMode).toBe('console');
    expect(config.outboxPollMs).toBe(500);
  });

  it('cualquier valor distinto de "console"/"meta" cae a off', () => {
    expect(cargarConfig({ WORKER_OUTBOX_MODE: 'otro' }).outboxMode).toBe('off');
    expect(cargarConfig({ WORKER_OUTBOX_MODE: '' }).outboxMode).toBe('off');
    expect(cargarConfig({ WORKER_OUTBOX_MODE: '  console  ' }).outboxMode).toBe('console');
  });

  it('un WORKER_OUTBOX_POLL_MS invalido cae al default', () => {
    expect(cargarConfig({ WORKER_OUTBOX_POLL_MS: 'abc' }).outboxPollMs).toBe(2000);
  });

  it('activa outbox meta con credenciales y respeta overrides de graph/lease/batch', () => {
    const config = cargarConfig({
      WORKER_OUTBOX_MODE: 'meta',
      META_PHONE_NUMBER_ID: '1234567890',
      META_ACCESS_TOKEN: 'token-secreto',
      META_GRAPH_URL: 'https://graph.facebook.com/v99.0',
      PUBLIC_API_URL: 'https://api.example.com',
      ATTACHMENTS_LINK_SECRET: 'secreto-compartido',
      OUTBOX_CLAIM_LEASE_S: '600',
      OUTBOX_BATCH: '5',
    });
    expect(config.outboxMode).toBe('meta');
    expect(config.metaPhoneNumberId).toBe('1234567890');
    expect(config.metaAccessToken).toBe('token-secreto');
    expect(config.metaGraphUrl).toBe('https://graph.facebook.com/v99.0');
    expect(config.publicApiUrl).toBe('https://api.example.com');
    expect(config.attachmentsLinkSecret).toBe('secreto-compartido');
    expect(config.claimLeaseSegundos).toBe(600);
    expect(config.outboxBatch).toBe(5);
  });

  it('falla-cerrado: modo meta sin META_PHONE_NUMBER_ID ni META_ACCESS_TOKEN lanza', () => {
    expect(() => cargarConfig({ WORKER_OUTBOX_MODE: 'meta' })).toThrow(/META_PHONE_NUMBER_ID/);
    expect(() =>
      cargarConfig({ WORKER_OUTBOX_MODE: 'meta', META_PHONE_NUMBER_ID: '123' }),
    ).toThrow(/META_ACCESS_TOKEN/);
    expect(() =>
      cargarConfig({ WORKER_OUTBOX_MODE: 'meta', META_ACCESS_TOKEN: 'token' }),
    ).toThrow(/META_PHONE_NUMBER_ID/);
  });

  it('falla-cerrado: modo meta con credenciales Meta pero sin PUBLIC_API_URL/ATTACHMENTS_LINK_SECRET lanza', () => {
    expect(() =>
      cargarConfig({
        WORKER_OUTBOX_MODE: 'meta',
        META_PHONE_NUMBER_ID: '123',
        META_ACCESS_TOKEN: 'token',
      }),
    ).toThrow(/PUBLIC_API_URL/);
    expect(() =>
      cargarConfig({
        WORKER_OUTBOX_MODE: 'meta',
        META_PHONE_NUMBER_ID: '123',
        META_ACCESS_TOKEN: 'token',
        PUBLIC_API_URL: 'https://api.example.com',
      }),
    ).toThrow(/ATTACHMENTS_LINK_SECRET/);
  });

  it('modo console u off no exige PUBLIC_API_URL/ATTACHMENTS_LINK_SECRET', () => {
    expect(cargarConfig({ WORKER_OUTBOX_MODE: 'console' }).publicApiUrl).toBeUndefined();
    expect(cargarConfig({}).attachmentsLinkSecret).toBeUndefined();
  });
});
