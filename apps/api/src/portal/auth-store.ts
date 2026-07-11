/**
 * Store de credenciales/sesiones del Centro de Control (docs/specs/control-center.md
 * §Autenticacion; migracion 006 `user_credentials`/`portal_sessions`).
 *
 * Separado de `PortalStore` (repo.ts, que resuelve el actor autenticado y su alcance):
 * este store solo conoce las dos tablas de auth, nunca roles ni alcance por proyecto.
 */

import type { Tx } from '@proveeduria/agent';

export interface CredencialAuthStore {
  readonly userId: string;
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
}

export interface CrearSesionInput {
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
}

export interface SesionAuthStore {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface AuthStore {
  /** JOIN `users`/`user_credentials` por email o telefono; ambos activos, credencial activa. */
  credencialPorIdentificador(identificador: string): Promise<CredencialAuthStore | null>;
  /** Credencial activa del usuario por id (cambiar-password necesita el hash actual). */
  credencialPorUserId(userId: string): Promise<CredencialAuthStore | null>;
  /** Alta/reset (superadmin): upsert con `must_change_password = true`. */
  crearOResetearCredencial(userId: string, passwordHash: string): Promise<void>;
  /** Cambio de password por el propio usuario: limpia `must_change_password`. */
  actualizarPassword(userId: string, passwordHash: string): Promise<void>;
  crearSesion(input: CrearSesionInput): Promise<SesionAuthStore>;
  /** Sesion vigente (no revocada, no expirada respecto de `ahora`) por hash del refresh. */
  sesionPorHash(refreshTokenHash: string, ahora: Date): Promise<SesionAuthStore | null>;
  revocarSesion(id: string, ahora: Date): Promise<void>;
  /** Revoca todas las sesiones vigentes del usuario, salvo `exceptoId` si se indica. */
  revocarSesionesDeUsuario(userId: string, ahora: Date, exceptoId?: string): Promise<void>;
}

interface CredencialRow {
  readonly userId: string;
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
}

interface SesionRow {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: Tx) {}

  async credencialPorIdentificador(identificador: string): Promise<CredencialAuthStore | null> {
    const result = await this.db.query<CredencialRow>(
      'SELECT uc.user_id AS "userId", uc.password_hash AS "passwordHash", ' +
        'uc.must_change_password AS "mustChangePassword" ' +
        'FROM user_credentials uc JOIN users u ON u.id = uc.user_id ' +
        'WHERE u.activo IS TRUE AND uc.activo IS TRUE ' +
        'AND (lower(u.email) = lower($1) OR u.telefono_whatsapp = $1) ' +
        'LIMIT 1',
      [identificador],
    );
    return result.rows[0] ?? null;
  }

  async credencialPorUserId(userId: string): Promise<CredencialAuthStore | null> {
    const result = await this.db.query<CredencialRow>(
      'SELECT uc.user_id AS "userId", uc.password_hash AS "passwordHash", ' +
        'uc.must_change_password AS "mustChangePassword" ' +
        'FROM user_credentials uc JOIN users u ON u.id = uc.user_id ' +
        'WHERE uc.user_id = $1 AND u.activo IS TRUE AND uc.activo IS TRUE',
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async crearOResetearCredencial(userId: string, passwordHash: string): Promise<void> {
    await this.db.query(
      'INSERT INTO user_credentials (user_id, password_hash, must_change_password, activo) ' +
        'VALUES ($1, $2, true, true) ' +
        'ON CONFLICT (user_id) DO UPDATE SET ' +
        'password_hash = EXCLUDED.password_hash, must_change_password = true, updated_at = now()',
      [userId, passwordHash],
    );
  }

  async actualizarPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.query(
      'UPDATE user_credentials SET password_hash = $2, must_change_password = false, ' +
        'updated_at = now() WHERE user_id = $1',
      [userId, passwordHash],
    );
  }

  async crearSesion(input: CrearSesionInput): Promise<SesionAuthStore> {
    const result = await this.db.query<SesionRow>(
      'INSERT INTO portal_sessions (user_id, refresh_token_hash, expires_at, user_agent) ' +
        'VALUES ($1, $2, $3, $4) ' +
        'RETURNING id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"',
      [input.userId, input.refreshTokenHash, input.expiresAt, input.userAgent],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No se pudo crear la sesion del portal.');
    return row;
  }

  async sesionPorHash(refreshTokenHash: string, ahora: Date): Promise<SesionAuthStore | null> {
    const result = await this.db.query<SesionRow>(
      'SELECT id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt" ' +
        'FROM portal_sessions WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > $2',
      [refreshTokenHash, ahora],
    );
    return result.rows[0] ?? null;
  }

  async revocarSesion(id: string, ahora: Date): Promise<void> {
    await this.db.query(
      'UPDATE portal_sessions SET revoked_at = $2, updated_at = now() ' +
        'WHERE id = $1 AND revoked_at IS NULL',
      [id, ahora],
    );
  }

  async revocarSesionesDeUsuario(userId: string, ahora: Date, exceptoId?: string): Promise<void> {
    if (exceptoId === undefined) {
      await this.db.query(
        'UPDATE portal_sessions SET revoked_at = $2, updated_at = now() ' +
          'WHERE user_id = $1 AND revoked_at IS NULL',
        [userId, ahora],
      );
      return;
    }
    await this.db.query(
      'UPDATE portal_sessions SET revoked_at = $3, updated_at = now() ' +
        'WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [userId, exceptoId, ahora],
    );
  }
}

interface FakeUsuarioDirectorio {
  readonly userId: string;
  readonly email: string | null;
  readonly telefonoWhatsapp: string | null;
  readonly activo: boolean;
}

interface FakeCredencial {
  passwordHash: string;
  mustChangePassword: boolean;
  activo: boolean;
}

interface FakeSesion {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  revokedAt: Date | null;
}

/** Fake en memoria para tests sin Postgres (patron `FakeToolStore`/`FakeTx` de @proveeduria/agent). */
export class FakeAuthStore implements AuthStore {
  private readonly usuarios = new Map<string, FakeUsuarioDirectorio>();
  private readonly credenciales = new Map<string, FakeCredencial>();
  private readonly sesiones = new Map<string, FakeSesion>();
  private idSeq = 1;

  /** Registra el directorio minimo (email/telefono/activo) que credencialPorIdentificador consulta. */
  agregarUsuario(input: {
    readonly userId: string;
    readonly email?: string | null;
    readonly telefonoWhatsapp?: string | null;
    readonly activo?: boolean;
  }): void {
    this.usuarios.set(input.userId, {
      userId: input.userId,
      email: input.email ?? null,
      telefonoWhatsapp: input.telefonoWhatsapp ?? null,
      activo: input.activo ?? true,
    });
  }

  /** Setup directo de credencial (evita depender de crearOResetearCredencial en arranques de test). */
  fijarCredencial(userId: string, input: {
    readonly passwordHash: string;
    readonly mustChangePassword?: boolean;
    readonly activo?: boolean;
  }): void {
    this.credenciales.set(userId, {
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword ?? true,
      activo: input.activo ?? true,
    });
  }

  async credencialPorIdentificador(identificador: string): Promise<CredencialAuthStore | null> {
    const buscado = identificador.trim();
    const buscadoLower = buscado.toLowerCase();
    const usuario = [...this.usuarios.values()].find((u) => (
      u.activo && (
        (u.email !== null && u.email.toLowerCase() === buscadoLower) ||
        (u.telefonoWhatsapp !== null && u.telefonoWhatsapp === buscado)
      )
    ));
    if (usuario === undefined) return null;
    return this.credencialActivaDe(usuario.userId);
  }

  async credencialPorUserId(userId: string): Promise<CredencialAuthStore | null> {
    const usuario = this.usuarios.get(userId);
    if (usuario === undefined || !usuario.activo) return null;
    return this.credencialActivaDe(userId);
  }

  private credencialActivaDe(userId: string): CredencialAuthStore | null {
    const credencial = this.credenciales.get(userId);
    if (credencial === undefined || !credencial.activo) return null;
    return {
      userId,
      passwordHash: credencial.passwordHash,
      mustChangePassword: credencial.mustChangePassword,
    };
  }

  async crearOResetearCredencial(userId: string, passwordHash: string): Promise<void> {
    this.credenciales.set(userId, { passwordHash, mustChangePassword: true, activo: true });
  }

  async actualizarPassword(userId: string, passwordHash: string): Promise<void> {
    const actual = this.credenciales.get(userId);
    this.credenciales.set(userId, {
      passwordHash,
      mustChangePassword: false,
      activo: actual?.activo ?? true,
    });
  }

  async crearSesion(input: CrearSesionInput): Promise<SesionAuthStore> {
    const id = `session-${this.idSeq}`;
    this.idSeq += 1;
    const sesion: FakeSesion = {
      id,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.sesiones.set(id, sesion);
    return { id: sesion.id, userId: sesion.userId, expiresAt: sesion.expiresAt, revokedAt: sesion.revokedAt };
  }

  async sesionPorHash(refreshTokenHash: string, ahora: Date): Promise<SesionAuthStore | null> {
    const sesion = [...this.sesiones.values()].find((s) => s.refreshTokenHash === refreshTokenHash);
    if (sesion === undefined) return null;
    if (sesion.revokedAt !== null) return null;
    if (sesion.expiresAt.getTime() <= ahora.getTime()) return null;
    return { id: sesion.id, userId: sesion.userId, expiresAt: sesion.expiresAt, revokedAt: sesion.revokedAt };
  }

  async revocarSesion(id: string, ahora: Date): Promise<void> {
    const sesion = this.sesiones.get(id);
    if (sesion !== undefined && sesion.revokedAt === null) sesion.revokedAt = ahora;
  }

  async revocarSesionesDeUsuario(userId: string, ahora: Date, exceptoId?: string): Promise<void> {
    for (const sesion of this.sesiones.values()) {
      if (sesion.userId === userId && sesion.id !== exceptoId && sesion.revokedAt === null) {
        sesion.revokedAt = ahora;
      }
    }
  }
}
