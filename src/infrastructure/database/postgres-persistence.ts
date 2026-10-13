import type { Pool } from 'pg';
import type { ProcessedMessageStore } from '../../core/commands/command-bus';
import type { Persistence } from '../persistence/persistence';
import type { DbClient } from './db.connection';
import { PostgresEventStore } from './postgres-event-store';
import {
  PostgresChefSessionRepository,
  PostgresFeedbackRepository,
  PostgresInventoryRepository,
  PostgresPlanRepository,
  PostgresPreferencesRepository,
  PostgresRecipeRepository,
  PostgresUnitOfWork,
  PostgresUserRepository
} from './postgres-repositories';

// Persistence completa sobre Postgres: los repositorios y el Event Store comparten el `tx` del caso de uso,
// así el cambio de estado, el evento y su fila de outbox se confirman (o se descartan) juntos.
export function createPostgresPersistence(pool: Pool, eventStore = new PostgresEventStore(pool)): Persistence {
  return {
    uow: new PostgresUnitOfWork(pool),
    events: {
      append: async (events, tx) => void (await eventStore.append(events, tx as DbClient | undefined)),
      readStream: (streamId) => eventStore.readStream(streamId)
    },
    users: new PostgresUserRepository(pool),
    plans: new PostgresPlanRepository(pool),
    inventory: new PostgresInventoryRepository(pool),
    recipes: new PostgresRecipeRepository(pool),
    chefSessions: new PostgresChefSessionRepository(pool),
    preferences: new PostgresPreferencesRepository(pool),
    feedback: new PostgresFeedbackRepository(pool)
  };
}

export class PostgresProcessedMessageStore implements ProcessedMessageStore {
  constructor(private readonly pool: Pool) {}

  async has(messageId: string) {
    const { rows } = await this.pool.query('SELECT 1 FROM processed_messages WHERE message_id = $1', [messageId]);
    return rows.length > 0;
  }

  async add(messageId: string, handler: string) {
    await this.pool.query('INSERT INTO processed_messages (message_id, handler) VALUES ($1, $2) ON CONFLICT DO NOTHING', [messageId, handler]);
  }
}
