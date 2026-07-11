/**
 * Unit tests de `AzureQueueConsumer` con un cliente fake (sin red), cubriendo el
 * contrato de docs/specs/broker-colas.md §Consumidor.
 */

import { describe, expect, it } from 'vitest';
import type { AzureQueueClientLike, AzureQueueMessage } from './azure.js';
import { AzureQueueConsumer, backoffSegundos } from './azure.js';

function wire(v: unknown, wamid: unknown, pedidoId?: unknown): string {
  const obj: Record<string, unknown> = { v, wamid };
  if (pedidoId !== undefined) obj.pedidoId = pedidoId;
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function mensaje(overrides: Partial<AzureQueueMessage> = {}): AzureQueueMessage {
  return {
    messageId: 'msg-1',
    popReceipt: 'pop-1',
    messageText: wire(1, 'wamid.ABC'),
    dequeueCount: 1,
    ...overrides,
  };
}

class FakeAzureQueueClient implements AzureQueueClientLike {
  createIfNotExistsCalls = 0;
  readonly mensajes: AzureQueueMessage[] = [];
  readonly enviados: string[] = [];
  readonly eliminados: { messageId: string; popReceipt: string }[] = [];
  readonly actualizados: {
    messageId: string;
    popReceipt: string;
    message: string | undefined;
    visibilityTimeout: number | undefined;
  }[] = [];
  fallarUpdate = false;

  async createIfNotExists(): Promise<unknown> {
    this.createIfNotExistsCalls += 1;
    return {};
  }

  async receiveMessages(): Promise<{ receivedMessageItems: readonly AzureQueueMessage[] }> {
    const item = this.mensajes.shift();
    return { receivedMessageItems: item === undefined ? [] : [item] };
  }

  async sendMessage(messageText: string): Promise<unknown> {
    this.enviados.push(messageText);
    return {};
  }

  async deleteMessage(messageId: string, popReceipt: string): Promise<unknown> {
    this.eliminados.push({ messageId, popReceipt });
    return {};
  }

  async updateMessage(
    messageId: string,
    popReceipt: string,
    message?: string,
    visibilityTimeout?: number,
  ): Promise<unknown> {
    if (this.fallarUpdate) throw new Error('updateMessage fallo (red)');
    this.actualizados.push({ messageId, popReceipt, message, visibilityTimeout });
    return {};
  }
}

function crearConsumer(opts: {
  principal?: FakeAzureQueueClient;
  poison?: FakeAzureQueueClient;
  maxDequeue?: number;
} = {}): { consumer: AzureQueueConsumer; principal: FakeAzureQueueClient; poison: FakeAzureQueueClient } {
  const principal = opts.principal ?? new FakeAzureQueueClient();
  const poison = opts.poison ?? new FakeAzureQueueClient();
  const consumer = new AzureQueueConsumer({
    connectionString: 'UseDevelopmentStorage=true',
    queueName: 'ingesta',
    visibilidadSegundos: 120,
    maxDequeue: opts.maxDequeue ?? 5,
    principalClient: principal,
    poisonClient: poison,
  });
  return { consumer, principal, poison };
}

describe('AzureQueueConsumer.poll', () => {
  it('decodifica un mensaje valido y arma el Job', async () => {
    const { consumer, principal } = crearConsumer();
    principal.mensajes.push(
      mensaje({ messageId: 'm1', popReceipt: 'p1', messageText: wire(1, 'wamid.OK'), dequeueCount: 3 }),
    );

    const job = await consumer.poll();

    expect(job).toEqual({ id: 'm1', wamid: 'wamid.OK', intento: 3 });
    expect(principal.eliminados).toEqual([]);
  });

  it('propaga pedidoId cuando viene en el wire', async () => {
    const { consumer, principal } = crearConsumer();
    principal.mensajes.push(mensaje({ messageText: wire(1, 'wamid.OK', 'pedido-1') }));

    const job = await consumer.poll();

    expect(job).toMatchObject({ wamid: 'wamid.OK', pedidoId: 'pedido-1' });
  });

  it('cola vacia devuelve null', async () => {
    const { consumer } = crearConsumer();
    const job = await consumer.poll();
    expect(job).toBeNull();
  });

  it('crea las colas (principal y veneno) una sola vez sin importar cuantos polls', async () => {
    const { consumer, principal, poison } = crearConsumer();
    await consumer.poll();
    await consumer.poll();

    expect(principal.createIfNotExistsCalls).toBe(1);
    expect(poison.createIfNotExistsCalls).toBe(1);
  });

  it.each([
    ['base64 invalido', 'no-es-base64-valido-%%%'],
    ['json invalido', Buffer.from('{no-json', 'utf8').toString('base64')],
    ['version desconocida', wire(2, 'wamid.X')],
    ['wamid vacio', wire(1, '')],
    ['wamid ausente', Buffer.from(JSON.stringify({ v: 1 }), 'utf8').toString('base64')],
  ])('mensaje malformado (%s) va a veneno, se borra y poll continua', async (_caso, messageText) => {
    const { consumer, principal, poison } = crearConsumer();
    principal.mensajes.push(
      mensaje({ messageId: 'malo', popReceipt: 'pop-malo', messageText }),
      mensaje({ messageId: 'bueno', popReceipt: 'pop-bueno', messageText: wire(1, 'wamid.OK') }),
    );

    const job = await consumer.poll();

    expect(poison.enviados).toEqual([messageText]);
    expect(principal.eliminados).toEqual([{ messageId: 'malo', popReceipt: 'pop-malo' }]);
    expect(job).toEqual({ id: 'bueno', wamid: 'wamid.OK', intento: 1 });
  });

  it('mensaje malformado seguido de cola vacia devuelve null', async () => {
    const { consumer, principal, poison } = crearConsumer();
    principal.mensajes.push(mensaje({ messageText: 'no-es-base64-valido-%%%' }));

    const job = await consumer.poll();

    expect(job).toBeNull();
    expect(poison.enviados).toHaveLength(1);
    expect(principal.eliminados).toHaveLength(1);
  });

  it('dequeueCount agotado (> maxDequeue) va a veneno, se borra y poll continua', async () => {
    const { consumer, principal, poison } = crearConsumer({ maxDequeue: 5 });
    principal.mensajes.push(
      mensaje({ messageId: 'agotado', popReceipt: 'pop-agotado', dequeueCount: 6 }),
      mensaje({ messageId: 'bueno', popReceipt: 'pop-bueno', messageText: wire(1, 'wamid.OK') }),
    );

    const job = await consumer.poll();

    expect(poison.enviados).toEqual([wire(1, 'wamid.ABC')]);
    expect(principal.eliminados).toEqual([{ messageId: 'agotado', popReceipt: 'pop-agotado' }]);
    expect(job).toEqual({ id: 'bueno', wamid: 'wamid.OK', intento: 1 });
  });

  it('dequeueCount exactamente en el umbral (maxDequeue) NO se considera agotado', async () => {
    const { consumer, principal } = crearConsumer({ maxDequeue: 5 });
    principal.mensajes.push(mensaje({ dequeueCount: 5, messageText: wire(1, 'wamid.OK') }));

    const job = await consumer.poll();

    expect(job).toEqual({ id: 'msg-1', wamid: 'wamid.OK', intento: 5 });
  });
});

describe('AzureQueueConsumer.ack', () => {
  it('borra el mensaje con el popReceipt guardado en poll', async () => {
    const { consumer, principal } = crearConsumer();
    principal.mensajes.push(mensaje({ messageId: 'm1', popReceipt: 'pop-correcto' }));
    const job = await consumer.poll();

    await consumer.ack(job!);

    expect(principal.eliminados).toEqual([{ messageId: 'm1', popReceipt: 'pop-correcto' }]);
  });

  it('ack de un job desconocido (sin popReceipt registrado) no explota ni borra nada', async () => {
    const { consumer, principal } = crearConsumer();
    await consumer.ack({ id: 'fantasma', wamid: 'wamid.X', intento: 1 });
    expect(principal.eliminados).toEqual([]);
  });
});

describe('AzureQueueConsumer.nack', () => {
  it.each([
    [1, 5],
    [2, 10],
    [3, 20],
    [10, 300],
  ])('aplica backoff de intento %i -> %i segundos via updateMessage', async (intento, esperado) => {
    const { consumer, principal } = crearConsumer({ maxDequeue: 20 });
    principal.mensajes.push(mensaje({ messageId: 'm1', popReceipt: 'pop-1', dequeueCount: intento }));
    const job = await consumer.poll();

    await consumer.nack(job!);

    expect(principal.actualizados).toEqual([
      { messageId: 'm1', popReceipt: 'pop-1', message: undefined, visibilityTimeout: esperado },
    ]);
  });

  it('si updateMessage falla, se traga el error (la visibilidad expira sola)', async () => {
    const { consumer, principal } = crearConsumer();
    principal.fallarUpdate = true;
    principal.mensajes.push(mensaje());
    const job = await consumer.poll();

    await expect(consumer.nack(job!)).resolves.toBeUndefined();
  });

  it('limpia el popReceipt interno tras nack (una segunda llamada no reintenta updateMessage)', async () => {
    const { consumer, principal } = crearConsumer();
    principal.mensajes.push(mensaje());
    const job = await consumer.poll();

    await consumer.nack(job!);
    await consumer.nack(job!);

    expect(principal.actualizados).toHaveLength(1);
  });
});

describe('backoffSegundos', () => {
  it('crece exponencialmente y satura en 300', () => {
    expect(backoffSegundos(1)).toBe(5);
    expect(backoffSegundos(2)).toBe(10);
    expect(backoffSegundos(3)).toBe(20);
    expect(backoffSegundos(4)).toBe(40);
    expect(backoffSegundos(7)).toBe(300);
    expect(backoffSegundos(20)).toBe(300);
  });
});
