import { describe, expect, it, vi } from 'vitest';

import type { AzureQueueClienteSubyacente } from './index.js';
import { AzureStorageQueue, InMemoryQueue } from './index.js';

/** Fake del cliente subyacente de Azure Storage Queues: sin red, sin credenciales. */
function fakeCliente(): AzureQueueClienteSubyacente & {
  readonly enviados: string[];
  createIfNotExists: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const enviados: string[] = [];
  return {
    enviados,
    createIfNotExists: vi.fn(async () => undefined),
    sendMessage: vi.fn(async (mensajeBase64: string) => {
      enviados.push(mensajeBase64);
      return undefined;
    }),
  };
}

describe('InMemoryQueue', () => {
  it('acumula los jobs encolados en orden', async () => {
    const queue = new InMemoryQueue();

    await queue.enqueue({ wamid: 'w1' });
    await queue.enqueue({ wamid: 'w2' });

    expect(queue.jobs).toEqual([{ wamid: 'w1' }, { wamid: 'w2' }]);
  });
});

describe('AzureStorageQueue', () => {
  it('enqueue manda base64 que decodifica exactamente al wire {v:1, wamid}', async () => {
    const cliente = fakeCliente();
    const queue = new AzureStorageQueue({
      connectionString: 'UseDevelopmentStorage=true',
      queueName: 'ingesta',
      cliente,
    });

    await queue.enqueue({ wamid: 'wamid.ABC123' });

    expect(cliente.sendMessage).toHaveBeenCalledTimes(1);
    const enviado = cliente.enviados[0]!;
    const decodificado = JSON.parse(Buffer.from(enviado, 'base64').toString('utf8'));
    expect(decodificado).toEqual({ v: 1, wamid: 'wamid.ABC123' });
  });

  it('llama createIfNotExists una sola vez aunque haya multiples enqueues', async () => {
    const cliente = fakeCliente();
    const queue = new AzureStorageQueue({
      connectionString: 'UseDevelopmentStorage=true',
      queueName: 'ingesta',
      cliente,
    });

    await queue.enqueue({ wamid: 'w1' });
    await queue.enqueue({ wamid: 'w2' });
    await queue.enqueue({ wamid: 'w3' });

    expect(cliente.createIfNotExists).toHaveBeenCalledTimes(1);
    expect(cliente.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('propaga el error si sendMessage falla (sin reintentos internos)', async () => {
    const cliente = fakeCliente();
    cliente.sendMessage.mockRejectedValueOnce(new Error('fallo de red simulado'));
    const queue = new AzureStorageQueue({
      connectionString: 'UseDevelopmentStorage=true',
      queueName: 'ingesta',
      cliente,
    });

    await expect(queue.enqueue({ wamid: 'w1' })).rejects.toThrow('fallo de red simulado');
  });

  it('propaga el error si createIfNotExists falla', async () => {
    const cliente = fakeCliente();
    cliente.createIfNotExists.mockRejectedValueOnce(new Error('cola inaccesible'));
    const queue = new AzureStorageQueue({
      connectionString: 'UseDevelopmentStorage=true',
      queueName: 'ingesta',
      cliente,
    });

    await expect(queue.enqueue({ wamid: 'w1' })).rejects.toThrow('cola inaccesible');
    expect(cliente.sendMessage).not.toHaveBeenCalled();
  });
});
