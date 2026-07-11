import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgProveedoresStore } from './proveedores-store.js';
import type { PortalActor } from './types.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = DATABASE_URL?.includes('provee_test') === true;

// Seed fijo (packages/db/seeds/001_base.sql).
const ADMIN_MATERIALES: PortalActor = {
  userId: '20000000-0000-4000-8000-000000000002',
  nombre: 'Jose Pablo (Proveeduria)',
  email: 'proveeduria@atemporal.cr',
  roles: ['admin_materiales'],
  projectIds: [],
};

describe.skipIf(!RUN)('PgProveedoresStore integration', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crea proveedor real -> audit row presente; luego actualiza y audita antes/despues', async () => {
    const store = new PgProveedoresStore(pool);
    const ahora = new Date('2026-07-10T12:00:00.000Z');

    const proveedor = await store.crear(
      ADMIN_MATERIALES,
      { nombre: 'Proveedor Integracion', cedulaJuridica: '3-101-999999', categorias: ['ferreteria'], notas: null },
      ahora,
    );
    expect(proveedor.nombre).toBe('Proveedor Integracion');
    expect(proveedor.activo).toBe(true);

    try {
      const auditCreado = await pool.query(
        "SELECT accion, entidad, entidad_id, origen, actor_user_id FROM audit_events " +
          "WHERE accion = 'proveedor_creado' AND entidad_id = $1",
        [proveedor.id],
      );
      expect(auditCreado.rowCount).toBe(1);
      expect(auditCreado.rows[0]).toMatchObject({
        accion: 'proveedor_creado',
        entidad: 'suppliers',
        entidad_id: proveedor.id,
        origen: 'web',
        actor_user_id: ADMIN_MATERIALES.userId,
      });

      const actualizado = await store.actualizar(ADMIN_MATERIALES, proveedor.id, { activo: false }, ahora);
      expect(actualizado?.activo).toBe(false);

      const auditActualizado = await pool.query(
        "SELECT antes, despues FROM audit_events WHERE accion = 'proveedor_actualizado' AND entidad_id = $1",
        [proveedor.id],
      );
      expect(auditActualizado.rowCount).toBe(1);
      expect(auditActualizado.rows[0]?.antes).toMatchObject({ activo: true });
      expect(auditActualizado.rows[0]?.despues).toMatchObject({ activo: false });
    } finally {
      // `audit_events` es append-only (data-model.md §Invariantes): no se limpia, queda
      // como historico permanente igual que en produccion. Solo se limpia el dominio.
      await pool.query('DELETE FROM suppliers WHERE id = $1', [proveedor.id]);
    }
  });

  it('crea contacto, opt-in y baja; segundo telefono duplicado responde error tipado', async () => {
    const store = new PgProveedoresStore(pool);
    const ahora = new Date('2026-07-10T12:00:00.000Z');

    const proveedor = await store.crear(
      ADMIN_MATERIALES,
      { nombre: 'Proveedor Contactos', cedulaJuridica: null, categorias: [], notas: null },
      ahora,
    );

    try {
      const creado = await store.crearContacto(
        ADMIN_MATERIALES,
        proveedor.id,
        { nombre: 'Contacto Uno', telefonoWhatsapp: '+50688889999', esPrincipal: true },
        ahora,
      );
      expect(creado.ok).toBe(true);
      if (!creado.ok) throw new Error('esperaba ok');
      expect(creado.value.optinAt).toBeNull();

      const duplicado = await store.crearContacto(
        ADMIN_MATERIALES,
        proveedor.id,
        { nombre: 'Otro', telefonoWhatsapp: '+50688889999', esPrincipal: false },
        ahora,
      );
      expect(duplicado.ok).toBe(false);
      if (duplicado.ok) throw new Error('esperaba error');
      expect(duplicado.error).toBe('telefono_duplicado');

      const optin = await store.optinContacto(ADMIN_MATERIALES, creado.value.id, ahora);
      expect(optin?.optinAt).not.toBeNull();

      const baja = await store.bajaContacto(ADMIN_MATERIALES, creado.value.id, ahora);
      expect(baja?.optinAt).toBeNull();

      const auditRows = await pool.query(
        'SELECT accion FROM audit_events WHERE entidad_id = $1',
        [creado.value.id],
      );
      // Las tres mutaciones reciben el MISMO `ahora`, asi que `at` empata y el orden de
      // lectura es arbitrario: el contrato es "las tres acciones quedaron auditadas",
      // no su orden — se asevera como conjunto ordenado alfabeticamente.
      expect(auditRows.rows.map((r: { accion: string }) => r.accion).sort()).toEqual([
        'contacto_baja',
        'contacto_creado',
        'contacto_optin',
      ]);
    } finally {
      // `audit_events` es append-only: no se limpia (mismo motivo que arriba).
      await pool.query('DELETE FROM supplier_contacts WHERE supplier_id = $1', [proveedor.id]);
      await pool.query('DELETE FROM suppliers WHERE id = $1', [proveedor.id]);
    }
  });
});
