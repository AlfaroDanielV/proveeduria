import { describe, expect, it } from 'vitest';

import { FakeAuthStore } from './auth-store.js';

const USER_ID = '20000000-0000-4000-8000-000000000002';

describe('FakeAuthStore', () => {
  it('resuelve credencial por email o telefono, ignorando mayusculas en el email', async () => {
    const store = new FakeAuthStore();
    store.agregarUsuario({ userId: USER_ID, email: 'Proveeduria@Atemporal.cr', telefonoWhatsapp: '+50688880002' });
    store.fijarCredencial(USER_ID, { passwordHash: 'hash-1' });

    await expect(store.credencialPorIdentificador('proveeduria@atemporal.cr')).resolves.toMatchObject({
      userId: USER_ID,
      passwordHash: 'hash-1',
    });
    await expect(store.credencialPorIdentificador('+50688880002')).resolves.toMatchObject({ userId: USER_ID });
  });

  it('no resuelve credencial de usuario inactivo ni credencial inactiva', async () => {
    const store = new FakeAuthStore();
    store.agregarUsuario({ userId: USER_ID, email: 'a@b.com', activo: false });
    store.fijarCredencial(USER_ID, { passwordHash: 'hash-1' });
    await expect(store.credencialPorIdentificador('a@b.com')).resolves.toBeNull();

    const store2 = new FakeAuthStore();
    store2.agregarUsuario({ userId: USER_ID, email: 'a@b.com' });
    store2.fijarCredencial(USER_ID, { passwordHash: 'hash-1', activo: false });
    await expect(store2.credencialPorIdentificador('a@b.com')).resolves.toBeNull();
  });

  it('identificador desconocido devuelve null', async () => {
    const store = new FakeAuthStore();
    await expect(store.credencialPorIdentificador('nadie@nada.com')).resolves.toBeNull();
  });

  it('crearOResetearCredencial fija must_change_password en true', async () => {
    const store = new FakeAuthStore();
    store.agregarUsuario({ userId: USER_ID, email: 'a@b.com' });
    await store.crearOResetearCredencial(USER_ID, 'hash-nuevo');
    const credencial = await store.credencialPorIdentificador('a@b.com');
    expect(credencial).toMatchObject({ passwordHash: 'hash-nuevo', mustChangePassword: true });
  });

  it('actualizarPassword limpia must_change_password', async () => {
    const store = new FakeAuthStore();
    store.agregarUsuario({ userId: USER_ID, email: 'a@b.com' });
    store.fijarCredencial(USER_ID, { passwordHash: 'viejo', mustChangePassword: true });
    await store.actualizarPassword(USER_ID, 'nuevo');
    const credencial = await store.credencialPorIdentificador('a@b.com');
    expect(credencial).toMatchObject({ passwordHash: 'nuevo', mustChangePassword: false });
  });

  it('sesionPorHash ignora sesiones revocadas o expiradas', async () => {
    const store = new FakeAuthStore();
    const ahora = new Date('2026-07-10T12:00:00.000Z');
    const sesion = await store.crearSesion({
      userId: USER_ID,
      refreshTokenHash: 'hash-refresh',
      expiresAt: new Date(ahora.getTime() + 1000),
      userAgent: null,
    });

    await expect(store.sesionPorHash('hash-refresh', ahora)).resolves.toMatchObject({ id: sesion.id });
    await expect(
      store.sesionPorHash('hash-refresh', new Date(ahora.getTime() + 2000)),
    ).resolves.toBeNull();

    await store.revocarSesion(sesion.id, ahora);
    await expect(store.sesionPorHash('hash-refresh', ahora)).resolves.toBeNull();
  });

  it('revocarSesionesDeUsuario respeta exceptoId', async () => {
    const store = new FakeAuthStore();
    const ahora = new Date('2026-07-10T12:00:00.000Z');
    const futuro = new Date(ahora.getTime() + 60_000);
    const s1 = await store.crearSesion({ userId: USER_ID, refreshTokenHash: 'h1', expiresAt: futuro, userAgent: null });
    const s2 = await store.crearSesion({ userId: USER_ID, refreshTokenHash: 'h2', expiresAt: futuro, userAgent: null });

    await store.revocarSesionesDeUsuario(USER_ID, ahora, s1.id);

    await expect(store.sesionPorHash('h1', ahora)).resolves.toMatchObject({ id: s1.id });
    await expect(store.sesionPorHash('h2', ahora)).resolves.toBeNull();
  });
});
