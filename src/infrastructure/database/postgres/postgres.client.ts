import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** Lo que reciben los repositorios: la base o una transacción abierta. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export type Postgres = { db: Db; pool: pg.Pool; close: () => Promise<void> };

// numeric → number y date → string ISO sin desplazamiento de zona
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

export function createPostgres(url: string): Postgres {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}
