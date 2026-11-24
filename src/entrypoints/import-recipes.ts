import { parseArgs } from 'node:util';
import pino from 'pino';
import { loadEnv } from '../infrastructure/config/env.js';
import { createContainer } from '../container.js';

/**
 * Precarga recetas de la biblioteca con macros estimados (gasta cuota de OpenRouter). Normalmente no hace falta:
 * el chef las genera cuando alguien las pide.
 *   pnpm recipes:import --target 10
 */
const { values } = parseArgs({ options: { target: { type: 'string' } } });
const env = loadEnv({ ...process.env, EVENT_TRANSPORT: 'in-process' });
const log = pino({ level: 'info' });
const c = await createContainer(env, log);
try {
  const target = Number(values.target);
  if (!Number.isInteger(target) || target < 1) throw new Error('Indica cuántas: --target 10');
  if (!c.services.recipeLibrary.enabled) throw new Error('Falta OPENROUTER_API_KEY: sin modelo no se pueden estimar macros');
  let total = 0;
  for (let failures = 0; failures < 3; ) {
    const added = await c.services.recipeLibrary.importBatch(target).catch((err: unknown) => (log.warn({ err }, 'tanda fallida'), 0));
    total += added;
    if (added === 0 && (await c.repos.recipes.countLibrary()) >= target) break;
    failures = added ? 0 : failures + 1;
  }
  log.info({ added: total, library: await c.repos.recipes.countLibrary(), target }, 'importación terminada');
} finally {
  await c.close();
}
