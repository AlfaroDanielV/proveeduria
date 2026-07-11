/**
 * Test de Fase 1: un job pasa por el consumer -> handler -> ack con InMemoryConsumer.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryConsumer } from './queue/index.js';
import type { Job, QueueConsumer } from './queue/index.js';
import type { JobHandler, LogSink } from './handlers/echo.js';
import { crearEchoHandler } from './handlers/echo.js';
import { procesarUno, correrLoop } from './consumer.js';
import { arrancar } from './index.js';

function jobDePrueba(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    wamid: 'wamid.ABC',
    intento: 1,
    ...overrides,
  };
}

function logSpy(): { sink: LogSink; eventos: string[] } {
  const eventos: string[] = [];
  const sink: LogSink = {
    info(evento) {
      eventos.push(evento);
    },
  };
  return { sink, eventos };
}

describe('procesarUno', () => {
  it('cierra el lazo job -> handler -> ack', async () => {
    const job = jobDePrueba();
    const consumer = new InMemoryConsumer([job]);
    const { sink, eventos } = logSpy();

    const ciclo = await procesarUno({ consumer, handler: crearEchoHandler(sink), log: sink });

    expect(ciclo.estado).toBe('procesado');
    expect(consumer.reconocidos).toEqual([job]);
    expect(consumer.devueltos).toEqual([]);
    expect(consumer.profundidad).toBe(0);
    expect(eventos).toContain('job.echo');
  });

  it('devuelve vacio cuando la cola no tiene jobs', async () => {
    const consumer = new InMemoryConsumer();
    const ciclo = await procesarUno({ consumer, handler: crearEchoHandler(logSpy().sink) });
    expect(ciclo.estado).toBe('vacio');
  });

  it('hace nack y reencola con intento+1 cuando el handler falla', async () => {
    const job = jobDePrueba();
    const consumer = new InMemoryConsumer([job]);
    const handler: JobHandler = {
      manejar() {
        return Promise.reject(new Error('fallo transitorio'));
      },
    };

    const ciclo = await procesarUno({ consumer, handler, log: logSpy().sink });

    expect(ciclo.estado).toBe('reintentar');
    expect(consumer.reconocidos).toEqual([]);
    expect(consumer.devueltos).toEqual([job]);
    // Reencolado para reintento con el contador incrementado.
    expect(consumer.profundidad).toBe(1);
  });

  it('reporta error_broker sin propagar cuando poll() lanza', async () => {
    const consumer: QueueConsumer = {
      poll: () => Promise.reject(new Error('azure caido')),
      ack: () => Promise.resolve(),
      nack: () => Promise.resolve(),
    };
    const { sink, eventos } = logSpy();

    const ciclo = await procesarUno({ consumer, handler: crearEchoHandler(sink), log: sink });

    expect(ciclo.estado).toBe('error_broker');
    expect(eventos).toContain('broker.error_poll');
  });

  it('no propaga cuando el nack tambien falla tras un fallo del handler', async () => {
    const job = jobDePrueba();
    const consumer: QueueConsumer = {
      poll: () => Promise.resolve(job),
      ack: () => Promise.resolve(),
      nack: () => Promise.reject(new Error('nack roto')),
    };
    const handler: JobHandler = {
      manejar: () => Promise.reject(new Error('fallo del handler')),
    };
    const { sink, eventos } = logSpy();

    const ciclo = await procesarUno({ consumer, handler, log: sink });

    expect(ciclo.estado).toBe('reintentar');
    expect(eventos).toContain('broker.error_nack');
  });
});

describe('correrLoop', () => {
  it('procesa todos los jobs y se detiene al vaciar la cola', async () => {
    const consumer = new InMemoryConsumer([
      jobDePrueba({ id: 'j1' }),
      jobDePrueba({ id: 'j2' }),
      jobDePrueba({ id: 'j3', pedidoId: 'PED-2026-001' }),
    ]);

    const procesados = await correrLoop({
      consumer,
      handler: crearEchoHandler(logSpy().sink),
      log: logSpy().sink,
    });

    expect(procesados).toBe(3);
    expect(consumer.reconocidos.map((j) => j.id)).toEqual(['j1', 'j2', 'j3']);
    expect(consumer.profundidad).toBe(0);
  });

  it('sobrevive un blip del broker en modo long-poll y sigue procesando', async () => {
    // poll: lanza 1 vez, luego entrega un job, luego cola vacia (abortamos ahi).
    const job = jobDePrueba();
    const abort = new AbortController();
    let llamada = 0;
    const consumer: QueueConsumer = {
      poll: () => {
        llamada += 1;
        if (llamada === 1) return Promise.reject(new Error('blip azure'));
        if (llamada === 2) return Promise.resolve(job);
        abort.abort();
        return Promise.resolve(null);
      },
      ack: () => Promise.resolve(),
      nack: () => Promise.resolve(),
    };
    const { sink, eventos } = logSpy();

    const procesados = await correrLoop({
      consumer,
      handler: crearEchoHandler(sink),
      log: sink,
      detenerAlVaciar: false,
      esperaVacioMs: 1, // la espera post-error usa max(esperaVacioMs, 1000); abortamos antes
      signal: abort.signal,
    });

    expect(procesados).toBe(1);
    expect(eventos).toContain('broker.error_poll');
  }, 10000);
});

describe('arrancar', () => {
  it('arma el worker con la cola inyectada y cierra el lazo', async () => {
    const job = jobDePrueba();
    const consumer = new InMemoryConsumer([job]);

    const procesados = await arrancar({ consumer, log: logSpy().sink });

    expect(procesados).toBe(1);
    expect(consumer.reconocidos).toEqual([job]);
  });
});
