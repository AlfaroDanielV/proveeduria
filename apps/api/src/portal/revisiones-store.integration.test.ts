import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgRevisionesStore } from './revisiones-store.js';
import type { PortalActor } from './types.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

// Seed fijo (packages/db/seeds/001_base.sql).
const SUPERADMIN: PortalActor = {
  userId: '20000000-0000-4000-8000-000000000001',
  nombre: 'Gerencia Atemporal',
  email: 'gerencia@atemporal.cr',
  roles: ['superadmin'],
  projectIds: [],
};

describe.skipIf(!RUN)('PgRevisionesStore integration', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lista pendientes, resuelve con audit y la segunda resolucion responde 409 (ya_resuelta)', async () => {
    const store = new PgRevisionesStore(pool);
    const ahora = new Date('2026-07-10T12:00:00.000Z');
    // IDs frescos por corrida: `audit_events` es append-only (nunca se limpia en el
    // finally), asi que reusar un id fijo entre corridas acumularia auditoria historica y
    // rompería el `rowCount === 1` de abajo.
    const revisionId = randomUUID();
    const entidadId = randomUUID();

    await pool.query(
      'INSERT INTO review_queue (id, tipo, entidad, entidad_id, detalle, estado) ' +
        "VALUES ($1, 'cotizacion_incompleta', 'quote_responses', $2, '{\"nota\":\"test\"}'::jsonb, 'pendiente')",
      [revisionId, entidadId],
    );

    try {
      const lista = await store.listar({ estado: 'pendiente', tipo: 'cotizacion_incompleta', limit: 25, offset: 0 });
      expect(lista.items.some((r) => r.id === revisionId)).toBe(true);

      const primera = await store.resolver(SUPERADMIN, revisionId, 'Se reviso manualmente.', ahora);
      expect(primera.ok).toBe(true);
      if (!primera.ok) throw new Error('esperaba ok');
      expect(primera.value.estado).toBe('resuelta');
      expect(primera.value.resolucion).toBe('Se reviso manualmente.');
      expect(primera.value.resueltaPor).toMatchObject({ userId: SUPERADMIN.userId });

      const auditRows = await pool.query(
        "SELECT accion, entidad, entidad_id, origen, actor_user_id FROM audit_events " +
          "WHERE accion = 'revision_resuelta' AND entidad_id = $1",
        [revisionId],
      );
      expect(auditRows.rowCount).toBe(1);
      expect(auditRows.rows[0]).toMatchObject({
        accion: 'revision_resuelta',
        entidad: 'review_queue',
        entidad_id: revisionId,
        origen: 'web',
        actor_user_id: SUPERADMIN.userId,
      });

      const segunda = await store.resolver(SUPERADMIN, revisionId, 'otra vez', ahora);
      expect(segunda.ok).toBe(false);
      if (segunda.ok) throw new Error('esperaba error');
      expect(segunda.error).toBe('ya_resuelta');

      const noExiste = await store.resolver(SUPERADMIN, randomUUID(), 'x', ahora);
      expect(noExiste.ok).toBe(false);
      if (noExiste.ok) throw new Error('esperaba error');
      expect(noExiste.error).toBe('no_encontrada');
    } finally {
      // `audit_events` es append-only (data-model.md §Invariantes): no se limpia.
      await pool.query('DELETE FROM review_queue WHERE id = $1', [revisionId]);
    }
  });
});
