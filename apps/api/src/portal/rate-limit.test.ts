import { describe, expect, it } from 'vitest';
import { crearLimitadorLogin, LimitadorIntentos } from './rate-limit.js';

const T0 = new Date('2026-07-10T12:00:00.000Z');
const mas = (ms: number): Date => new Date(T0.getTime() + ms);

describe('LimitadorIntentos', () => {
  it('bloquea al agotar los intentos dentro de la ventana', () => {
    const lim = new LimitadorIntentos({ maxIntentos: 3, ventanaMs: 60_000 });
    expect(lim.bloqueado('id:x', T0)).toBe(false);
    lim.registrarFallo('id:x', T0);
    lim.registrarFallo('id:x', mas(1_000));
    expect(lim.bloqueado('id:x', mas(2_000))).toBe(false);
    lim.registrarFallo('id:x', mas(2_000));
    expect(lim.bloqueado('id:x', mas(3_000))).toBe(true);
    // Otra clave no se ve afectada.
    expect(lim.bloqueado('id:otro', mas(3_000))).toBe(false);
  });

  it('la ventana vencida desbloquea y reinicia el contador', () => {
    const lim = new LimitadorIntentos({ maxIntentos: 2, ventanaMs: 60_000 });
    lim.registrarFallo('id:x', T0);
    lim.registrarFallo('id:x', mas(1_000));
    expect(lim.bloqueado('id:x', mas(2_000))).toBe(true);
    expect(lim.bloqueado('id:x', mas(61_000))).toBe(false);
    lim.registrarFallo('id:x', mas(61_000));
    expect(lim.bloqueado('id:x', mas(62_000))).toBe(false);
  });

  it('el exito limpia la clave', () => {
    const lim = new LimitadorIntentos({ maxIntentos: 2, ventanaMs: 60_000 });
    lim.registrarFallo('id:x', T0);
    lim.registrarFallo('id:x', T0);
    expect(lim.bloqueado('id:x', mas(1_000))).toBe(true);
    lim.registrarExito('id:x');
    expect(lim.bloqueado('id:x', mas(1_000))).toBe(false);
  });
});

describe('crearLimitadorLogin', () => {
  it('usa los defaults de la spec (5/identificador, 20/IP, 15 min)', () => {
    const lim = crearLimitadorLogin();
    for (let i = 0; i < 5; i += 1) lim.porIdentificador.registrarFallo('id:x', T0);
    expect(lim.porIdentificador.bloqueado('id:x', mas(1_000))).toBe(true);
    expect(lim.porIdentificador.bloqueado('id:x', mas(15 * 60_000 + 1))).toBe(false);
    for (let i = 0; i < 20; i += 1) lim.porIp.registrarFallo('ip:1.2.3.4', T0);
    expect(lim.porIp.bloqueado('ip:1.2.3.4', mas(1_000))).toBe(true);
  });
});
