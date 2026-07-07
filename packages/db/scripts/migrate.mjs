#!/usr/bin/env node
/**
 * Runner de migraciones versionadas para @proveeduria/db.
 *
 * SQL plano numerado en migrations/*.sql, aplicado en orden lexicografico, cada archivo
 * en su propia transaccion, registrado en `schema_migrations` (aplicar una sola vez).
 * Reemplaza el "SQL manual en el editor de Supabase" (DEPLOYMENT_COOKBOOK.md §2.3).
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs up|status|seed
 *
 * - up:     aplica migraciones pendientes (migrations/*.sql).
 * - status: lista aplicadas y pendientes.
 * - seed:   ejecuta seeds/*.sql (idempotentes; re-ejecutables).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, '..', 'migrations');
const SEEDS_DIR = join(here, '..', 'seeds');

function connectionString() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: falta la variable de entorno DATABASE_URL.');
    process.exit(1);
  }
  return url;
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function sqlFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedIds(client) {
  const { rows } = await client.query('SELECT id FROM schema_migrations ORDER BY id');
  return rows.map((r) => r.id);
}

async function up() {
  await withClient(async (client) => {
    await ensureMigrationsTable(client);
    const done = new Set(await appliedIds(client));
    const pending = sqlFiles(MIGRATIONS_DIR).filter((f) => !done.has(f));
    if (pending.length === 0) {
      console.log('Sin migraciones pendientes.');
      return;
    }
    for (const file of pending) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Aplicando ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('ok');
      } catch (e) {
        await client.query('ROLLBACK');
        console.log('FALLO');
        throw e;
      }
    }
    console.log(`Listo: ${pending.length} migracion(es) aplicada(s).`);
  });
}

async function status() {
  await withClient(async (client) => {
    await ensureMigrationsTable(client);
    const done = new Set(await appliedIds(client));
    const files = sqlFiles(MIGRATIONS_DIR);
    if (files.length === 0) {
      console.log('No hay archivos de migracion.');
      return;
    }
    for (const file of files) {
      console.log(`${done.has(file) ? '[x]' : '[ ]'} ${file}`);
    }
  });
}

async function seed() {
  await withClient(async (client) => {
    const files = sqlFiles(SEEDS_DIR);
    if (files.length === 0) {
      console.log('No hay archivos de seed.');
      return;
    }
    for (const file of files) {
      const sql = readFileSync(join(SEEDS_DIR, file), 'utf8');
      process.stdout.write(`Seed ${file} ... `);
      await client.query(sql);
      console.log('ok');
    }
    console.log(`Listo: ${files.length} seed(s) ejecutado(s).`);
  });
}

const commands = { up, status, seed };
const cmd = process.argv[2] ?? 'up';
const fn = commands[cmd];
if (!fn) {
  console.error(`Comando desconocido: ${cmd}. Use: up | status | seed`);
  process.exit(1);
}
fn().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
