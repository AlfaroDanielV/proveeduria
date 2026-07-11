/**
 * Integracion (Postgres real, gated): flujo completo del proveedor (A6).
 *
 * Pedido `cotizando` con RFQ `enviada` -> inbound de proveedor con texto de cotizacion ->
 * handler de dominio con extractor FAKE inyectado (sin red) -> `registrar_cotizacion` REAL como
 * actor sistema -> `quote_response` persistido, estados correctos y outbox de confirmacion.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { crearClaudeDomainEngine } from './claude-engine.js';
import { crearDomainHandler, PgTransactionRunner } from './handler.js';
import type { DecisionModelo, ExtractorCotizacion, ModeloConversacional } from '@proveeduria/agent';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = DATABASE_URL?.includes('provee_test') === true;
const describeIntegration = runIntegration ? describe : describe.skip;

// Seed (packages/db/seeds/001_base.sql).
const PROYECTO_LOPEZ = '30000000-0000-4000-8000-000000000001';
const INGENIERO = '20000000-0000-4000-8000-000000000004';
const RODEX = '40000000-0000-4000-8000-000000000001';
const CONTACTO_RODEX_TEL = '+50688881001';

class ModeloNunca implements ModeloConversacional {
  async decidir(): Promise<DecisionModelo> {
    throw new Error('el modelo conversacional no debe llamarse en el flujo del proveedor');
  }
}

/** Extractor fake: cotizacion completa mapeando cada item del pedido. */
const extractorFake: ExtractorCotizacion = {
  async extraer(entrada) {
    return {
      tipo: 'ok',
      input: {
        quoteRequestId: entrada.quoteRequestId,
        fuente: 'texto',
        confianzaExtraccion: 0.95,
        condiciones: 'Credito 30 dias',
        plazoEntrega: '2 dias',
        items: entrada.itemsPedido.map((item, i) => ({
          pedidoItemId: item.pedidoItemId,
          precioUnitario: 1000 * (i + 1),
          cantidad: item.cantidad,
          disponible: true,
        })),
      },
    };
  },
};

describeIntegration('camino del proveedor con Postgres real (A6)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('inbound de proveedor -> quote_response completa + en_revision + confirmacion', async () => {
    const suf = randomUUID().slice(0, 8);
    const pedidoId = randomUUID();
    const item1 = randomUUID();
    const item2 = randomUUID();
    const quoteRequestId = randomUUID();
    const inboundId = randomUUID();
    const numero = `PED-TEST-${suf}`;
    const wamid = `wamid.prov.${suf}`;
    const ahora = new Date();
    const plazo = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO pedidos (id, numero, project_id, solicitante_user_id, estado, plazo_cotizacion_at) ' +
        "VALUES ($1, $2, $3, $4, 'cotizando', $5)",
      [pedidoId, numero, PROYECTO_LOPEZ, INGENIERO, plazo],
    );
    await pool.query(
      'INSERT INTO pedido_items (id, pedido_id, descripcion, cantidad, unidad) VALUES ' +
        '($1, $3, $4, $5, $6), ($2, $3, $7, $8, $9)',
      [item1, item2, pedidoId, 'Cemento gris', 10, 'saco', 'Varilla #4', 25, 'unidad'],
    );
    await pool.query(
      'INSERT INTO quote_requests (id, pedido_id, supplier_id, plazo_at, estado) ' +
        "VALUES ($1, $2, $3, $4, 'enviada')",
      [quoteRequestId, pedidoId, RODEX, plazo],
    );
    await pool.query(
      'INSERT INTO inbound_messages (id, wamid, from_phone, tipo, payload, received_at) ' +
        "VALUES ($1, $2, $3, 'texto', $4::jsonb, $5)",
      [inboundId, wamid, CONTACTO_RODEX_TEL, JSON.stringify({ text: { body: 'Les mando la cotizacion' } }), ahora],
    );

    const engine = crearClaudeDomainEngine({ modelo: new ModeloNunca(), extractor: extractorFake });
    const handler = crearDomainHandler({ runner: new PgTransactionRunner(pool), engine });

    await handler.manejar({ id: `job.${suf}`, wamid, intento: 1 });

    // quote_response persistida (completa) + quote_items.
    const qr = await pool.query(
      "SELECT estado, confianza_extraccion FROM quote_responses WHERE quote_request_id = $1",
      [quoteRequestId],
    );
    expect(qr.rows).toHaveLength(1);
    expect(qr.rows[0].estado).toBe('completa');

    const qreq = await pool.query('SELECT estado FROM quote_requests WHERE id = $1', [quoteRequestId]);
    expect(qreq.rows[0].estado).toBe('respondida');

    const ped = await pool.query('SELECT estado FROM pedidos WHERE id = $1', [pedidoId]);
    expect(ped.rows[0].estado).toBe('en_revision');

    // Confirmacion al proveedor por outbox (texto de sesion libre).
    const outbox = await pool.query(
      'SELECT texto FROM outbox_messages WHERE destino = $1 AND texto LIKE $2',
      [CONTACTO_RODEX_TEL, `%${numero}%`],
    );
    expect(outbox.rows.some((r: { texto: string | null }) => r.texto?.includes('Recibimos su cotización'))).toBe(true);

    // Auditoria del turno del proveedor (actor sistema).
    const audit = await pool.query(
      "SELECT accion, actor_sistema FROM audit_events WHERE accion = 'agente_proveedor_cotizacion' AND entidad_id = $1",
      [quoteRequestId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_sistema).toBe(true);

    // Inbound marcado procesado (idempotencia).
    const inbound = await pool.query('SELECT processed_at FROM inbound_messages WHERE id = $1', [inboundId]);
    expect(inbound.rows[0].processed_at).not.toBeNull();
  });
});
