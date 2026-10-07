// pnpm db:migrate  -> aplica las migraciones pendientes en DATABASE_URL.
import { getEnv } from '../infrastructure/config/env';
import { createPool } from '../infrastructure/database/db.connection';
import { runMigrations } from '../infrastructure/database/migrations';

async function main() {
  const { databaseUrl } = getEnv();
  if (!databaseUrl) {
    console.error('Define DATABASE_URL para migrar (ver .env.example).');
    process.exit(1);
  }

  const pool = createPool(databaseUrl);
  try {
    const applied = await runMigrations(pool);
    console.log(applied.length > 0 ? `Migraciones aplicadas: ${applied.join(', ')}` : 'La base ya está al día.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falló la migración', error);
  process.exit(1);
});
