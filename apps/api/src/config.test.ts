import { describe, expect, it } from 'vitest';

import { cargarConfig } from './config.js';

const BASE_ENV: NodeJS.ProcessEnv = {
  META_APP_SECRET: 'app-secret',
  META_VERIFY_TOKEN: 'verify-token',
  DATABASE_URL: 'postgres://localhost/test',
};

describe('cargarConfig', () => {
  it('lanza si faltan variables requeridas', () => {
    expect(() => cargarConfig({})).toThrowError(/faltan variables/);
  });

  it('carga valores por defecto en dev sin PORTAL_JWT_SECRET ni PORTAL_ORIGIN', () => {
    const config = cargarConfig({ ...BASE_ENV });
    expect(config.port).toBe(8080);
    expect(config.nodeEnv).toBe('development');
    expect(config.portalOrigin).toBeUndefined();
    expect(typeof config.portalJwtSecret).toBe('string');
    expect(config.portalJwtSecret.length).toBeGreaterThan(0);
  });

  it('genera un PORTAL_JWT_SECRET efimero distinto en cada llamada si falta en dev', () => {
    const a = cargarConfig({ ...BASE_ENV });
    const b = cargarConfig({ ...BASE_ENV });
    expect(a.portalJwtSecret).not.toBe(b.portalJwtSecret);
  });

  it('usa PORTAL_JWT_SECRET del entorno si esta definido', () => {
    const config = cargarConfig({ ...BASE_ENV, PORTAL_JWT_SECRET: 'secreto-fijo-de-prueba' });
    expect(config.portalJwtSecret).toBe('secreto-fijo-de-prueba');
  });

  it('falla-cerrado en produccion sin PORTAL_JWT_SECRET', () => {
    expect(() =>
      cargarConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        AZURE_STORAGE_QUEUE_CONNECTION: 'conn',
      }),
    ).toThrowError(/PORTAL_JWT_SECRET/);
  });

  it('arranca en produccion con PORTAL_JWT_SECRET definido', () => {
    const config = cargarConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      AZURE_STORAGE_QUEUE_CONNECTION: 'conn',
      PORTAL_JWT_SECRET: 'secreto-produccion',
      // Requerido en produccion desde que existe ATTACHMENTS_LINK_SECRET (ver tests dedicados
      // mas abajo); este test solo verifica portalJwtSecret/nodeEnv.
      ATTACHMENTS_LINK_SECRET: 'secreto-adjuntos-produccion',
    });
    expect(config.portalJwtSecret).toBe('secreto-produccion');
    expect(config.nodeEnv).toBe('production');
  });

  it('portalOrigin queda definido cuando PORTAL_ORIGIN esta presente', () => {
    const config = cargarConfig({ ...BASE_ENV, PORTAL_ORIGIN: 'https://portal.example.com' });
    expect(config.portalOrigin).toBe('https://portal.example.com');
  });

  it('portalOrigin queda undefined si PORTAL_ORIGIN esta vacio', () => {
    const config = cargarConfig({ ...BASE_ENV, PORTAL_ORIGIN: '   ' });
    expect(config.portalOrigin).toBeUndefined();
  });

  it('rechaza PORT invalido', () => {
    expect(() => cargarConfig({ ...BASE_ENV, PORT: '8080abc' })).toThrowError(/PORT/);
  });

  it('falla-cerrado en produccion sin cola real', () => {
    expect(() =>
      cargarConfig({ ...BASE_ENV, NODE_ENV: 'production', PORTAL_JWT_SECRET: 'x' }),
    ).toThrowError(/AZURE_STORAGE_QUEUE_CONNECTION/);
  });

  it('carga un ATTACHMENTS_LINK_SECRET efimero distinto en cada llamada si falta en dev', () => {
    const a = cargarConfig({ ...BASE_ENV });
    const b = cargarConfig({ ...BASE_ENV });
    expect(typeof a.attachmentsLinkSecret).toBe('string');
    expect(a.attachmentsLinkSecret.length).toBeGreaterThan(0);
    expect(a.attachmentsLinkSecret).not.toBe(b.attachmentsLinkSecret);
  });

  it('usa ATTACHMENTS_LINK_SECRET del entorno si esta definido', () => {
    const config = cargarConfig({ ...BASE_ENV, ATTACHMENTS_LINK_SECRET: 'secreto-adjuntos-fijo' });
    expect(config.attachmentsLinkSecret).toBe('secreto-adjuntos-fijo');
  });

  it('falla-cerrado en produccion sin ATTACHMENTS_LINK_SECRET', () => {
    expect(() =>
      cargarConfig({
        ...BASE_ENV,
        NODE_ENV: 'production',
        AZURE_STORAGE_QUEUE_CONNECTION: 'conn',
        PORTAL_JWT_SECRET: 'secreto-produccion',
      }),
    ).toThrowError(/ATTACHMENTS_LINK_SECRET/);
  });

  it('arranca en produccion con ATTACHMENTS_LINK_SECRET definido', () => {
    const config = cargarConfig({
      ...BASE_ENV,
      NODE_ENV: 'production',
      AZURE_STORAGE_QUEUE_CONNECTION: 'conn',
      PORTAL_JWT_SECRET: 'secreto-produccion',
      ATTACHMENTS_LINK_SECRET: 'secreto-adjuntos-produccion',
    });
    expect(config.attachmentsLinkSecret).toBe('secreto-adjuntos-produccion');
  });
});
