import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verificarFirma, verificarChallenge } from './verify.js';

const SECRET = 'app-secret-de-prueba';

function firmar(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('verificarFirma', () => {
  const body = Buffer.from(JSON.stringify({ hola: 'mundo', n: 42 }), 'utf8');

  it('acepta una firma valida del cuerpo crudo', () => {
    expect(verificarFirma(body, firmar(body, SECRET), SECRET)).toBe(true);
  });

  it('rechaza una firma calculada con otro secreto', () => {
    expect(verificarFirma(body, firmar(body, 'otro-secreto'), SECRET)).toBe(false);
  });

  it('rechaza cuando el cuerpo fue alterado tras firmar', () => {
    const firma = firmar(body, SECRET);
    const alterado = Buffer.from(JSON.stringify({ hola: 'mundo', n: 43 }), 'utf8');
    expect(verificarFirma(alterado, firma, SECRET)).toBe(false);
  });

  it('rechaza firma ausente (header vacio)', () => {
    expect(verificarFirma(body, '', SECRET)).toBe(false);
  });

  it('rechaza un esquema distinto de sha256', () => {
    const hex = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verificarFirma(body, `sha1=${hex}`, SECRET)).toBe(false);
  });

  it('rechaza un header sin el prefijo sha256=', () => {
    const hex = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verificarFirma(body, hex, SECRET)).toBe(false);
  });

  it('rechaza hex mal formado / longitud incorrecta', () => {
    expect(verificarFirma(body, 'sha256=zzzz', SECRET)).toBe(false);
    expect(verificarFirma(body, 'sha256=', SECRET)).toBe(false);
  });

  it('falla-cerrado si el app secret esta vacio', () => {
    expect(verificarFirma(body, firmar(body, ''), '')).toBe(false);
  });
});

describe('verificarChallenge', () => {
  const TOKEN = 'verify-token-secreto';

  it('devuelve el challenge con mode=subscribe y token correcto', () => {
    expect(
      verificarChallenge({ mode: 'subscribe', token: TOKEN, challenge: '12345' }, TOKEN),
    ).toBe('12345');
  });

  it('rechaza token incorrecto', () => {
    expect(
      verificarChallenge({ mode: 'subscribe', token: 'malo', challenge: '12345' }, TOKEN),
    ).toBeNull();
  });

  it('rechaza mode distinto de subscribe', () => {
    expect(
      verificarChallenge({ mode: 'unsubscribe', token: TOKEN, challenge: '12345' }, TOKEN),
    ).toBeNull();
  });

  it('rechaza challenge ausente', () => {
    expect(verificarChallenge({ mode: 'subscribe', token: TOKEN }, TOKEN)).toBeNull();
  });

  it('rechaza parametros indefinidos', () => {
    expect(verificarChallenge({}, TOKEN)).toBeNull();
  });

  it('falla-cerrado si el verify token esta vacio', () => {
    expect(
      verificarChallenge({ mode: 'subscribe', token: '', challenge: '12345' }, ''),
    ).toBeNull();
  });
});
