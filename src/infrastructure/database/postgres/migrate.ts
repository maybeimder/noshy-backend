import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createPostgres } from './postgres.client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, '../../../../drizzle');

export async function runMigrations(url: string): Promise<void> {
  const pg = createPostgres(url);
  try {
    await migrate(pg.db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pg.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definido');
  await runMigrations(url);
  console.log('Migraciones aplicadas');
}
