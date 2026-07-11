// schema.test.mjs
// Smoke tests de esquema (node:test + pg) contra process.env.DATABASE_URL.
// Verifican invariantes NO negociables de packages/db/CLAUDE.md y data-model.md:
// tablas clave, auditoria append-only, guardia de transiciones, idempotencia
// wamid, y numeracion correlativa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.DATABASE_URL;
let client;

before(async () => {
  assert.ok(url, 'DATABASE_URL requerido para tests de esquema.');
  client = new pg.Client({ connectionString: url });
  await client.connect();
});

after(async () => {
  if (client) await client.end();
});

// Ejecuta fn y devuelve el error lanzado (o null si no lanzo).
async function capturarError(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

test('tablas clave existen', async () => {
  const claves = [
    'roles', 'users', 'user_roles', 'projects', 'suppliers', 'supplier_contacts',
    'dashboard_links', 'config', 'numeracion_secuencias', 'attachments',
    'pedidos', 'pedido_items', 'quote_requests', 'quote_responses', 'quote_items',
    'purchase_orders', 'po_items', 'invoices', 'invoice_items', 'invoice_po_links',
    'receipt_confirmations', 'credit_notes', 'credit_note_items',
    'equipment_rentals', 'equipment_movements',
    'conversations', 'inbound_messages', 'outbox_messages', 'review_queue',
    'approval_events', 'audit_events', 'feedback',
    'user_credentials', 'portal_sessions', 'agent_control', 'attachment_blobs',
  ];
  const { rows } = await client.query(
    `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`
  );
  const presentes = new Set(rows.map((r) => r.table_name));
  for (const t of claves) {
    assert.ok(presentes.has(t), `falta la tabla ${t}`);
  }
});

test('vistas de reporte existen', async () => {
  const { rows } = await client.query(
    `select table_name from information_schema.views where table_schema = 'public'`
  );
  const vistas = new Set(rows.map((r) => r.table_name));
  for (const v of ['v_pedido_costo_real', 'v_compras_por_proveedor', 'v_ejecucion_presupuesto', 'v_inventario_equipos']) {
    assert.ok(vistas.has(v), `falta la vista ${v}`);
  }
});

test('audit_events es append-only: UPDATE y DELETE son rechazados', async () => {
  const { rows } = await client.query(
    `insert into audit_events (accion, entidad, origen)
       values ('test_append_only', 'test', 'system') returning id`
  );
  const id = rows[0].id;

  const errUpdate = await capturarError(() =>
    client.query('update audit_events set accion = $1 where id = $2', ['mutado', id])
  );
  assert.ok(errUpdate, 'UPDATE sobre audit_events deberia fallar');

  const errDelete = await capturarError(() =>
    client.query('delete from audit_events where id = $1', [id])
  );
  assert.ok(errDelete, 'DELETE sobre audit_events deberia fallar');

  // La fila sigue existiendo (append-only).
  const { rows: check } = await client.query(
    'select accion from audit_events where id = $1', [id]
  );
  assert.equal(check.length, 1);
  assert.equal(check[0].accion, 'test_append_only');
});

test('guardia de transiciones: transicion invalida rechazada, valida aceptada', async () => {
  // Datos propios para independencia del seed.
  const { rows: pr } = await client.query(
    `insert into projects (nombre, codigo) values ('Test Proj', $1) returning id`,
    [`T-${Date.now()}`]
  );
  const projectId = pr[0].id;
  const numero = `PED-TEST-${Date.now()}`;
  const { rows: pe } = await client.query(
    `insert into pedidos (numero, project_id, estado) values ($1, $2, 'borrador') returning id`,
    [numero, projectId]
  );
  const pedidoId = pe[0].id;

  // Invalida: borrador -> recepcion_total no esta en la tabla de transiciones.
  const errInvalida = await capturarError(() =>
    client.query(`update pedidos set estado = 'recepcion_total' where id = $1`, [pedidoId])
  );
  assert.ok(errInvalida, 'transicion borrador->recepcion_total deberia fallar');

  // Valida: borrador -> cotizando.
  await client.query(`update pedidos set estado = 'cotizando' where id = $1`, [pedidoId]);
  const { rows: st } = await client.query('select estado from pedidos where id = $1', [pedidoId]);
  assert.equal(st[0].estado, 'cotizando');

  // Cerrado inmutable: llevar a estado terminal y verificar bloqueo.
  const numero2 = `PED-TEST2-${Date.now()}`;
  const { rows: pe2 } = await client.query(
    `insert into pedidos (numero, project_id, estado) values ($1, $2, 'recepcion_total') returning id`,
    [numero2, projectId]
  );
  const pedido2 = pe2[0].id;
  await client.query(`update pedidos set estado = 'cerrado' where id = $1`, [pedido2]);
  const errInmutable = await capturarError(() =>
    client.query(`update pedidos set urgencia = 'alta' where id = $1`, [pedido2])
  );
  assert.ok(errInmutable, 'un pedido cerrado deberia ser inmutable');
});

test('inbound_messages.wamid duplicado viola unique (idempotencia)', async () => {
  const wamid = `wamid.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await client.query('insert into inbound_messages (wamid, from_phone) values ($1, $2)', [wamid, '+50600000000']);
  const err = await capturarError(() =>
    client.query('insert into inbound_messages (wamid, from_phone) values ($1, $2)', [wamid, '+50600000000'])
  );
  assert.ok(err, 'wamid duplicado deberia violar unique');
  assert.match(String(err.code ?? ''), /23505/, 'deberia ser unique_violation (23505)');
});

test('siguiente_numero entrega correlativos crecientes con formato PED-YYYY-NNN', async () => {
  // Anio alto para no chocar con datos reales/seed.
  const anio = 2999;
  const n1 = (await client.query('select siguiente_numero($1, $2) as n', ['PED', anio])).rows[0].n;
  const n2 = (await client.query('select siguiente_numero($1, $2) as n', ['PED', anio])).rows[0].n;
  const n3 = (await client.query('select siguiente_numero($1, $2) as n', ['PED', anio])).rows[0].n;

  assert.equal(n1, 'PED-2999-001');
  assert.equal(n2, 'PED-2999-002');
  assert.equal(n3, 'PED-2999-003');

  // Prefijo OC lleva su propia secuencia por anio.
  const oc = (await client.query('select siguiente_numero($1, $2) as n', ['OC', anio])).rows[0].n;
  assert.equal(oc, 'OC-2999-001');

  // Prefijo invalido es rechazado.
  const err = await capturarError(() => client.query('select siguiente_numero($1, $2)', ['XX', anio]));
  assert.ok(err, 'prefijo invalido deberia fallar');
});
