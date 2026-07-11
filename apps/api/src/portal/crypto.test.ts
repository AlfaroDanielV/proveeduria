import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  firmarJwt,
  generarTokenOpaco,
  hashPassword,
  hashTokenOpaco,
  verificarJwt,
  verificarPassword,
} from './crypto.js';

const AHORA = new Date('2026-07-10T12:00:00.000Z');
const SECRETO = 'secreto-de-test';

describe('passwords scrypt', () => {
  it('roundtrip: hash y verificacion correcta; password equivocado falla', async () => {
    const hash = await hashPassword('vos-sos-el-password');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verificarPassword('vos-sos-el-password', hash)).toBe(true);
    expect(await verificarPassword('otro', hash)).toBe(false);
  });

  it('dos hashes del mismo password difieren (salt por usuario)', async () => {
    const a = await hashPassword('x');
    const b = await hashPassword('x');
    expect(a).not.toBe(b);
    expect(await verificarPassword('x', a)).toBe(true);
    expect(await verificarPassword('x', b)).toBe(true);
  });

  it('rechaza formato invalido y parametros adulterados sin lanzar', async () => {
    expect(await verificarPassword('x', 'no-es-un-hash')).toBe(false);
    expect(await verificarPassword('x', 'bcrypt$1$2$3$a$b')).toBe(false);
    const hash = await hashPassword('x');
    const partes = hash.split('$');
    // N gigante (DoS) o no potencia de 2: rechazado por cotas, no ejecutado.
    partes[1] = String(1 << 24);
    expect(await verificarPassword('x', partes.join('$'))).toBe(false);
    partes[1] = '10000';
    expect(await verificarPassword('x', partes.join('$'))).toBe(false);
    // Hash truncado.
    expect(await verificarPassword('x', hash.slice(0, -8))).toBe(false);
  });
});

describe('JWT HS256', () => {
  it('roundtrip: firma y verifica sub/exp', () => {
    const token = firmarJwt({ sub: 'user-1', secreto: SECRETO, ahora: AHORA, vidaSegundos: 900 });
    expect(verificarJwt({ token, secreto: SECRETO, ahora: AHORA })).toEqual({ sub: 'user-1' });
    // Sigue valido justo antes de expirar; invalido despues.
    const casiExpira = new Date(AHORA.getTime() + 899_000);
    const expirado = new Date(AHORA.getTime() + 900_000);
    expect(verificarJwt({ token, secreto: SECRETO, ahora: casiExpira })).not.toBeNull();
    expect(verificarJwt({ token, secreto: SECRETO, ahora: expirado })).toBeNull();
  });

  it('rechaza firma adulterada, secreto distinto y basura', () => {
    const token = firmarJwt({ sub: 'user-1', secreto: SECRETO, ahora: AHORA, vidaSegundos: 900 });
    const [h, p] = token.split('.') as [string, string, string];
    expect(verificarJwt({ token: `${h}.${p}.firma-falsa`, secreto: SECRETO, ahora: AHORA })).toBeNull();
    expect(verificarJwt({ token, secreto: 'otro-secreto', ahora: AHORA })).toBeNull();
    expect(verificarJwt({ token: 'ni.siquiera', secreto: SECRETO, ahora: AHORA })).toBeNull();
    expect(verificarJwt({ token: '', secreto: SECRETO, ahora: AHORA })).toBeNull();
  });

  it('rechaza payload adulterado aunque el formato sea valido', () => {
    const token = firmarJwt({ sub: 'user-1', secreto: SECRETO, ahora: AHORA, vidaSegundos: 900 });
    const [h, , f] = token.split('.') as [string, string, string];
    const payloadFalso = Buffer.from(
      JSON.stringify({ sub: 'superadmin', iat: 0, exp: 9999999999 }),
      'utf8',
    ).toString('base64url');
    expect(verificarJwt({ token: `${h}.${payloadFalso}.${f}`, secreto: SECRETO, ahora: AHORA })).toBeNull();
  });

  it('rechaza confusion de algoritmo (alg none / distinto)', () => {
    // Token "alg: none" con firma vacia PERO recalculada con el secreto: la unica forma de
    // que la firma matchee es conocer el secreto; aun asi el header alg != HS256 se rechaza.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8')
      .toString('base64url');
    const iat = Math.floor(AHORA.getTime() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', iat, exp: iat + 900 }),
      'utf8',
    ).toString('base64url');
    const firma = createHmac('sha256', SECRETO).update(`${header}.${payload}`).digest('base64url');
    expect(verificarJwt({ token: `${header}.${payload}.${firma}`, secreto: SECRETO, ahora: AHORA }))
      .toBeNull();
  });
});

describe('refresh token opaco', () => {
  it('genera token y hash estable; tokens distintos por llamada', () => {
    const a = generarTokenOpaco();
    const b = generarTokenOpaco();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashTokenOpaco(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
