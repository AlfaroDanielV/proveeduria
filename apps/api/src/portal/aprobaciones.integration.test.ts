/**
 * Test de integracion GATED (solo corre con `DATABASE_URL` apuntando a `provee_test`, igual
 * que el resto de `*.integration.test.ts` del repo): flujo REAL end-to-end de C2
 * (docs/specs/portal-api.md §Aprobaciones y acciones de pedido) via HTTP puro
 * (`resolverPortalRequest`, sin abrir sockets) contra Postgres real, con las 4 rutas nuevas
 * ejecutando las tools REALES de `@proveeduria/agent`.
 *
 * Siembra hasta `borrador` con `crearPedido`/`confirmarPedido` llamados DIRECTO (igual que
 * `packages/agent/src/tools/adjudicacion.integration.test.ts`: esas dos tools no son parte
 * de C2). A partir de ahi, cada mutacion de C2 pasa por la ruta HTTP real:
 *
 *   POST rfqs -> cotizando + approval_events(lista_proveedores)
 *   registrarCotizacion x2 DIRECTO (no es parte de C2) -> en_revision
 *   POST adjudicacion -> aprobado + approval_events(ganador) con snapshot
 *   POST ocs -> ordenado + purchase_orders + outbox oc_emitida con attachment
 *   GET aprobaciones -> los 3 tipos de arriba, canal 'web'
 */

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  confirmarPedido,
  crearCtx,
  crearPedido,
  registrarCotizacion,
  withTx,
} from '@proveeduria/agent';
import type { Actor } from '@proveeduria/agent';

import { crearEjecutorToolPedido } from './acciones-pedido.js';
import { PgAprobacionesStore } from './aprobaciones-store.js';
import { PgAuthStore } from './auth-store.js';
import { firmarJwt } from './crypto.js';
import { PgProveedoresStore } from './proveedores-store.js';
import { PgPortalStore } from './repo.js';
import { PgRevisionesStore } from './revisiones-store.js';
import { COOKIE_TOKEN } from './auth-routes.js';
import { resolverPortalRequest } from './routes.js';
import type { PortalDeps, PortalRequest, PortalResponse } from './routes.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

// Seed fijo (packages/db/seeds/001_base.sql): mismos IDs que packages/agent/src/tools/*.integration.test.ts.
const PROJECT_ID = '30000000-0000-4000-8000-000000000001';
const RODEX_ID = '40000000-0000-4000-8000-000000000001';
const LAGAR_ID = '40000000-0000-4000-8000-000000000002';
const INGENIERO_ID = '20000000-0000-4000-8000-000000000004';
const ADMIN_MATERIALES_ID = '20000000-0000-4000-8000-000000000002';

const actorIngeniero: Actor = { userId: INGENIERO_ID, nombre: 'Ingeniero de Obra', roles: ['ingeniero'] };
const actorAdminMateriales: Actor = { userId: ADMIN_MATERIALES_ID, nombre: 'Jose Pablo', roles: ['admin_materiales'] };

function baseReq(over: Partial<PortalRequest> & { readonly pathname: string }): PortalRequest {
  return {
    method: 'GET',
    searchParams: new URLSearchParams(),
    headers: {},
    cookies: {},
    body: undefined,
    ...over,
  };
}

describe.skipIf(!RUN)('Aprobaciones y acciones de pedido (integracion Postgres, C2)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rfqs -> 2 cotizaciones -> adjudicacion -> ocs -> historial con los 3 tipos', async () => {
    const ahora = new Date('2026-07-10T12:00:00.000Z');

    // 1. Siembra hasta borrador confirmado (fuera de C2, mismo patron que
    // adjudicacion.integration.test.ts): 2 items para poder dividir la adjudicacion despues.
    let pedidoId = '';
    let itemCementoId = '';
    let itemVarillaId = '';
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const result = await crearPedido({
        projectId: PROJECT_ID,
        items: [
          { descripcion: 'Cemento', cantidad: 10, unidad: 'saco' },
          { descripcion: 'Varilla #4', cantidad: 25, unidad: 'unidad' },
        ],
      }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      pedidoId = result.value.pedidoId;
      itemCementoId = result.value.items[0]?.id ?? '';
      itemVarillaId = result.value.items[1]?.id ?? '';
      expect(itemCementoId).not.toBe('');
      expect(itemVarillaId).not.toBe('');
    });
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorIngeniero, ahora });
      const result = await confirmarPedido({ pedidoId }, ctx);
      expect(result.ok).toBe(true);
    });

    // Deps reales del portal: mismos stores/PG que arma index.ts (`crearPortalDeps`), con
    // `ejecutarToolPedido` real (pool + advisory lock + Ctx origen 'web').
    const portalJwtSecret = 'secreto-de-integracion-aprobaciones';
    const deps: PortalDeps = {
      store: new PgPortalStore(pool),
      authStore: new PgAuthStore(pool),
      portalStore: new PgPortalStore(pool),
      proveedoresStore: new PgProveedoresStore(pool),
      revisionesStore: new PgRevisionesStore(pool),
      aprobacionesStore: new PgAprobacionesStore(pool),
      ejecutarToolPedido: crearEjecutorToolPedido(pool),
      portalJwtSecret,
      esProduccion: false,
      ahora: () => ahora,
      emitirCredenciales: async () => {},
    };

    // Cookie de prueba: JWT firmado directo con el mismo secreto (equivalente a un login
    // real ya completado), mismo atajo que auth-routes.integration.test.ts.
    const cookieAdminMateriales = {
      [COOKIE_TOKEN]: firmarJwt({ sub: ADMIN_MATERIALES_ID, secreto: portalJwtSecret, ahora, vidaSegundos: 900 }),
    };

    // 2. POST rfqs -> borrador -> cotizando + approval_events(lista_proveedores).
    const rfqRes = await resolverPortalRequest(
      baseReq({
        method: 'POST',
        pathname: `/api/portal/pedidos/${pedidoId}/rfqs`,
        headers: { 'x-portal-csrf': '1' },
        cookies: cookieAdminMateriales,
        body: { supplierIds: [RODEX_ID, LAGAR_ID] },
      }),
      deps,
    );
    expect(rfqRes?.status).toBe(200);
    expect(rfqRes?.body).toMatchObject({ pedidoId, estado: 'cotizando', rfqs: 2 });

    const pedidoTrasRfq = await pool.query<{ estado: string }>('SELECT estado FROM pedidos WHERE id = $1', [pedidoId]);
    expect(pedidoTrasRfq.rows[0]?.estado).toBe('cotizando');

    const listaProveedoresRow = await pool.query<{ tipo: string; canal: string }>(
      "SELECT tipo, canal FROM approval_events WHERE pedido_id = $1 AND tipo = 'lista_proveedores'",
      [pedidoId],
    );
    expect(listaProveedoresRow.rows).toHaveLength(1);
    expect(listaProveedoresRow.rows[0]?.canal).toBe('web');

    // 3. Registra 2 cotizaciones completas DIRECTO con la tool (no HTTP: no es parte de C2)
    // para llegar a en_revision, division limpia Rodex=cemento / El Lagar=varilla.
    const quoteRequestRows = await pool.query<{ id: string; supplier_id: string }>(
      'SELECT id, supplier_id FROM quote_requests WHERE pedido_id = $1',
      [pedidoId],
    );
    const qrRodexId = quoteRequestRows.rows.find((r) => r.supplier_id === RODEX_ID)?.id ?? '';
    const qrLagarId = quoteRequestRows.rows.find((r) => r.supplier_id === LAGAR_ID)?.id ?? '';
    expect(qrRodexId).not.toBe('');
    expect(qrLagarId).not.toBe('');

    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await registrarCotizacion({
        quoteRequestId: qrRodexId,
        fuente: 'texto',
        condiciones: 'Contado',
        plazoEntrega: '2 dias',
        confianzaExtraccion: 0.95,
        items: [{ pedidoItemId: itemCementoId, precioUnitario: 4500, cantidad: 10, disponible: true }],
      }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.transicionoAEnRevision).toBe(false);
    });
    await withTx(pool, async (tx) => {
      const ctx = crearCtx({ tx, actor: actorAdminMateriales, ahora });
      const result = await registrarCotizacion({
        quoteRequestId: qrLagarId,
        fuente: 'texto',
        condiciones: 'Credito 30 dias',
        plazoEntrega: '3 dias',
        confianzaExtraccion: 0.9,
        items: [{ pedidoItemId: itemVarillaId, precioUnitario: 1250, cantidad: 25, disponible: true }],
      }, ctx);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.mensaje);
      expect(result.value.transicionoAEnRevision).toBe(true);
      expect(result.value.pedidoEstado).toBe('en_revision');
    });

    // 4. POST adjudicacion -> en_revision -> aprobado + approval_events(ganador) con snapshot.
    const adjRes = await resolverPortalRequest(
      baseReq({
        method: 'POST',
        pathname: `/api/portal/pedidos/${pedidoId}/adjudicacion`,
        headers: { 'x-portal-csrf': '1' },
        cookies: cookieAdminMateriales,
        body: {
          asignaciones: [
            { supplierId: RODEX_ID, pedidoItemIds: [itemCementoId] },
            { supplierId: LAGAR_ID, pedidoItemIds: [itemVarillaId] },
          ],
        },
      }),
      deps,
    );
    expect(adjRes?.status).toBe(200);
    expect(adjRes?.body).toMatchObject({ pedidoId, estado: 'aprobado' });

    const pedidoTrasAdj = await pool.query<{ estado: string }>('SELECT estado FROM pedidos WHERE id = $1', [pedidoId]);
    expect(pedidoTrasAdj.rows[0]?.estado).toBe('aprobado');

    const ganadorRow = await pool.query<{ tipo: string; canal: string; detalle: { asignaciones: unknown[] } }>(
      "SELECT tipo, canal, detalle FROM approval_events WHERE pedido_id = $1 AND tipo = 'ganador'",
      [pedidoId],
    );
    expect(ganadorRow.rows).toHaveLength(1);
    expect(ganadorRow.rows[0]?.canal).toBe('web');
    expect(ganadorRow.rows[0]?.detalle.asignaciones).toHaveLength(2);

    // 5. POST ocs -> aprobado -> ordenado + purchase_orders + outbox oc_emitida con attachment.
    const ocRes = await resolverPortalRequest(
      baseReq({
        method: 'POST',
        pathname: `/api/portal/pedidos/${pedidoId}/ocs`,
        headers: { 'x-portal-csrf': '1' },
        cookies: cookieAdminMateriales,
        body: {},
      }),
      deps,
    );
    expect(ocRes?.status).toBe(200);
    const ocBody = ocRes?.body as {
      pedidoId: string;
      estado: string;
      ocs: readonly { ocId: string; numero: string; supplierId: string; montoTotal: number }[];
    };
    expect(ocBody.pedidoId).toBe(pedidoId);
    expect(ocBody.estado).toBe('ordenado');
    expect(ocBody.ocs).toHaveLength(2);
    // Contrato exacto de portal-api.md: solo estos 4 campos por OC.
    for (const oc of ocBody.ocs) {
      expect(Object.keys(oc).sort()).toEqual(['montoTotal', 'numero', 'ocId', 'supplierId']);
    }

    const pedidoTrasOcs = await pool.query<{ estado: string }>('SELECT estado FROM pedidos WHERE id = $1', [pedidoId]);
    expect(pedidoTrasOcs.rows[0]?.estado).toBe('ordenado');

    const ocsRow = await pool.query<{ id: string; supplier_id: string; estado: string; pdf_attachment_id: string | null }>(
      'SELECT id, supplier_id, estado, pdf_attachment_id FROM purchase_orders WHERE pedido_id = $1 ORDER BY numero',
      [pedidoId],
    );
    expect(ocsRow.rows).toHaveLength(2);
    for (const row of ocsRow.rows) {
      expect(row.estado).toBe('emitida');
      expect(row.pdf_attachment_id).not.toBeNull();
    }

    const outboxRow = await pool.query<{ attachment_id: string | null }>(
      "SELECT attachment_id FROM outbox_messages WHERE template = 'oc_emitida' AND payload ->> 'pedido_id' = $1",
      [pedidoId],
    );
    expect(outboxRow.rows).toHaveLength(2);
    for (const row of outboxRow.rows) expect(row.attachment_id).not.toBeNull();

    const emisionOcRow = await pool.query<{ tipo: string; canal: string }>(
      "SELECT tipo, canal FROM approval_events WHERE pedido_id = $1 AND tipo = 'emision_oc'",
      [pedidoId],
    );
    expect(emisionOcRow.rows).toHaveLength(1);
    expect(emisionOcRow.rows[0]?.canal).toBe('web');

    // 6. GET aprobaciones -> los 3 tipos presentes, mas reciente primero, canal 'web'.
    const histRes = await resolverPortalRequest(
      baseReq({
        pathname: `/api/portal/pedidos/${pedidoId}/aprobaciones`,
        cookies: cookieAdminMateriales,
      }),
      deps,
    );
    expect(histRes?.status).toBe(200);
    const histBody = (histRes as PortalResponse).body as {
      items: readonly { tipo: string; canal: string; aprobadoPor: { userId: string; nombre: string } }[];
    };
    expect(histBody.items).toHaveLength(3);
    expect(new Set(histBody.items.map((i) => i.tipo))).toEqual(
      new Set(['lista_proveedores', 'ganador', 'emision_oc']),
    );
    for (const item of histBody.items) {
      expect(item.canal).toBe('web');
      expect(item.aprobadoPor).toEqual({ userId: ADMIN_MATERIALES_ID, nombre: 'Jose Pablo (Proveeduria)' });
    }
    // mas reciente primero: emision_oc (ultima escrita) antes que lista_proveedores (primera).
    expect(histBody.items[0]?.tipo).toBe('emision_oc');
    expect(histBody.items[histBody.items.length - 1]?.tipo).toBe('lista_proveedores');
  });
});
