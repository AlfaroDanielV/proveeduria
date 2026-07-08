import type { Pool, PoolClient } from 'pg';
import type { Tx } from './types.js';

class PgTx implements Tx {
  constructor(private readonly client: PoolClient) {}

  async query<T = unknown>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const result = await this.client.query(sql, [...params]);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  }
}

export async function withTx<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(new PgTx(client));
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
