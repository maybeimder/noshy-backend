import { Pool, type PoolClient } from 'pg';

export type DbClient = PoolClient;

// schema: útil en tests para aislar cada corrida en su propio schema.
export function createPool(connectionString: string, options: { schema?: string; max?: number } = {}): Pool {
  return new Pool({
    connectionString,
    max: options.max ?? 10,
    ...(options.schema ? { options: `-c search_path=${options.schema}` } : {})
  });
}

// Ejecuta `work` dentro de BEGIN/COMMIT; ante cualquier error hace ROLLBACK y relanza.
// Los casos de uso que escriban estado + eventos deben usar el mismo `client` para ambos.
export async function withTransaction<T>(pool: Pool, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
