import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { DomainEngine, DomainEngineInput } from './types.js';
import { crearDomainHandler, PgTransactionRunner } from './handler.js';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = DATABASE_URL?.includes('provee_test') === true;
const describeIntegration = runIntegration ? describe : describe.skip;

class SpyEngine implements DomainEngine {
  readonly inputs: DomainEngineInput[] = [];

  async procesar(input: DomainEngineInput): Promise<void> {
    this.inputs.push(input);
  }
}

describeIntegration('worker domain handler con Postgres real', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('lee inbound_messages, resuelve usuario interno y marca processed_at', async () => {
    const suffix = randomUUID();
    const wamid = `wamid.worker.internal.${suffix}`;
    await pool.query(
      'INSERT INTO inbound_messages (wamid, from_phone, tipo, payload, received_at) ' +
        'VALUES ($1, $2, $3, $4::jsonb, now())',
      [
        wamid,
        '50688880002',
        'texto',
        JSON.stringify({ text: 'structured smoke' }),
      ],
    );
    const engine = new SpyEngine();
    const handler = crearDomainHandler({
      runner: new PgTransactionRunner(pool),
      engine,
      ahora: () => new Date('2026-07-08T12:00:00.000Z'),
      log: { info() {} },
    });

    await handler.manejar({
      id: `job-${suffix}`,
      wamid,
      intento: 1,
      pedidoId: 'pedido-smoke',
    });

    expect(engine.inputs).toHaveLength(1);
    expect(engine.inputs[0]?.contexto.tipo).toBe('interno');
    expect(engine.inputs[0]?.ctx?.actor.userId).toBe('20000000-0000-4000-8000-000000000002');

    const check = await pool.query<{ processedAt: Date | null }>(
      'SELECT processed_at AS "processedAt" FROM inbound_messages WHERE wamid = $1',
      [wamid],
    );
    expect(check.rows[0]?.processedAt).toBeInstanceOf(Date);
  });

  it('aplica E11 para remitente desconocido con audit y outbox', async () => {
    const suffix = randomUUID();
    const wamid = `wamid.worker.unknown.${suffix}`;
    await pool.query(
      'INSERT INTO inbound_messages (wamid, from_phone, tipo, payload, received_at) ' +
        'VALUES ($1, $2, $3, $4::jsonb, now())',
      [
        wamid,
        '+50689999999',
        'texto',
        JSON.stringify({ text: 'hola' }),
      ],
    );
    const engine = new SpyEngine();
    const handler = crearDomainHandler({
      runner: new PgTransactionRunner(pool),
      engine,
      ahora: () => new Date('2026-07-08T12:00:00.000Z'),
      log: { info() {} },
    });

    await handler.manejar({
      id: `job-${suffix}`,
      wamid,
      intento: 1,
    });

    expect(engine.inputs).toHaveLength(0);
    const check = await pool.query<{
      processedAt: Date | null;
      outboxCount: string;
      auditCount: string;
    }>(
      'SELECT im.processed_at AS "processedAt", ' +
        '(SELECT count(*) FROM outbox_messages om ' +
        "WHERE om.payload->>'wamid' = im.wamid AND om.payload->>'codigo' = 'E11') AS \"outboxCount\", " +
        '(SELECT count(*) FROM audit_events ae ' +
        "WHERE ae.accion = 'remitente_desconocido' AND ae.despues->>'wamid' = im.wamid) AS \"auditCount\" " +
        'FROM inbound_messages im WHERE im.wamid = $1',
      [wamid],
    );

    expect(check.rows[0]?.processedAt).toBeInstanceOf(Date);
    expect(Number(check.rows[0]?.outboxCount)).toBe(1);
    expect(Number(check.rows[0]?.auditCount)).toBe(1);
  });
});
