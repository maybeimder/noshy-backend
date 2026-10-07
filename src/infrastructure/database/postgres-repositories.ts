import type { Pool, PoolClient } from 'pg';
import type { Tx, UnitOfWork } from '../../core/persistence/unit-of-work';
import type { AuthUser } from '../../modules/auth/auth.model';
import type { UserRepository } from '../../modules/auth/auth.repository';
import type { ChefSession, ChefSessionMessage, PreferencesDocument } from '../../modules/chef-sessions/chef-session.model';
import type { ChefSessionRepository } from '../../modules/chef-sessions/chef-session.repository';
import { DEFAULT_PREFERENCES, type PreferencesRepository } from '../../modules/chef-sessions/preferences.repository';
import type { FeedbackEntry } from '../../modules/feedback/feedback.model';
import type { FeedbackRepository } from '../../modules/feedback/feedback.repository';
import type { InventoryItem } from '../../modules/inventory/inventory.model';
import type { InventoryRepository } from '../../modules/inventory/inventory.repository';
import type { NutritionPlan } from '../../modules/plans/plan.model';
import type { PlanRepository } from '../../modules/plans/plan.repository';
import type { Recipe } from '../../modules/recipes/recipe.model';
import type { RecipeRepository } from '../../modules/recipes/recipe.repository';
import { withTransaction } from './db.connection';

type Row = Record<string, any>;
const iso = (value: Date) => value.toISOString();

// Con tx usa la conexión de la transacción; sin tx, el pool (lecturas sueltas).
abstract class PostgresRepository {
  constructor(protected readonly pool: Pool) {}

  protected async query(tx: Tx | undefined, sql: string, params: unknown[] = []): Promise<Row[]> {
    const executor = (tx as PoolClient | undefined) ?? this.pool;
    return (await executor.query(sql, params)).rows;
  }

  // Dentro de una transacción, bloquea la fila leída hasta el COMMIT (evita perder actualizaciones).
  protected lock(tx: Tx | undefined) {
    return tx ? ' FOR UPDATE' : '';
  }
}

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (client) => work(client));
  }
}

const toUser = (row: Row): AuthUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  password: row.password_hash,
  createdAt: iso(row.created_at)
});

export class PostgresUserRepository extends PostgresRepository implements UserRepository {
  async findByEmail(email: string, tx?: Tx) {
    const [row] = await this.query(tx, 'SELECT * FROM users WHERE email = $1', [email]);
    return row ? toUser(row) : null;
  }

  async findById(id: string, tx?: Tx) {
    const [row] = await this.query(tx, 'SELECT * FROM users WHERE id = $1', [id]);
    return row ? toUser(row) : null;
  }

  async insert(user: AuthUser, tx?: Tx) {
    await this.query(tx, 'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [
      user.id,
      user.name,
      user.email,
      user.password,
      user.createdAt
    ]);
  }
}

const toPlan = (row: Row): NutritionPlan => ({
  id: row.id,
  userId: row.user_id,
  objective: row.objective,
  targets: row.targets,
  restrictions: row.restrictions,
  ...(row.meals_per_day !== null ? { mealsPerDay: row.meals_per_day } : {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
});

export class PostgresPlanRepository extends PostgresRepository implements PlanRepository {
  async listByUser(userId: string, tx?: Tx) {
    return (await this.query(tx, `SELECT * FROM nutrition_plans WHERE user_id = $1 ORDER BY seq${this.lock(tx)}`, [userId])).map(toPlan);
  }

  async insert(plan: NutritionPlan, tx?: Tx) {
    await this.query(
      tx,
      `INSERT INTO nutrition_plans (id, user_id, objective, targets, restrictions, meals_per_day, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [plan.id, plan.userId, plan.objective, JSON.stringify(plan.targets), JSON.stringify(plan.restrictions), plan.mealsPerDay ?? null, plan.createdAt, plan.updatedAt]
    );
  }

  async update(plan: NutritionPlan, tx?: Tx) {
    await this.query(
      tx,
      `UPDATE nutrition_plans SET objective = $2, targets = $3, restrictions = $4, meals_per_day = $5, updated_at = $6 WHERE id = $1`,
      [plan.id, plan.objective, JSON.stringify(plan.targets), JSON.stringify(plan.restrictions), plan.mealsPerDay ?? null, plan.updatedAt]
    );
  }
}

const toItem = (row: Row): InventoryItem => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  quantity: row.quantity,
  unit: row.unit,
  createdAt: iso(row.created_at)
});

export class PostgresInventoryRepository extends PostgresRepository implements InventoryRepository {
  async listByUser(userId: string, tx?: Tx) {
    return (await this.query(tx, 'SELECT * FROM inventory_items WHERE user_id = $1 ORDER BY seq', [userId])).map(toItem);
  }

  async findById(userId: string, itemId: string, tx?: Tx) {
    const [row] = await this.query(tx, `SELECT * FROM inventory_items WHERE user_id = $1 AND id = $2${this.lock(tx)}`, [userId, itemId]);
    return row ? toItem(row) : null;
  }

  async insert(item: InventoryItem, tx?: Tx) {
    await this.query(tx, 'INSERT INTO inventory_items (id, user_id, name, quantity, unit, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      item.id,
      item.userId,
      item.name,
      item.quantity,
      item.unit,
      item.createdAt
    ]);
  }

  async update(item: InventoryItem, tx?: Tx) {
    await this.query(tx, 'UPDATE inventory_items SET name = $2, quantity = $3, unit = $4 WHERE id = $1', [item.id, item.name, item.quantity, item.unit]);
  }

  async delete(userId: string, itemId: string, tx?: Tx) {
    return (await this.query(tx, 'DELETE FROM inventory_items WHERE user_id = $1 AND id = $2 RETURNING id', [userId, itemId])).length > 0;
  }
}

const toRecipe = (row: Row): Recipe => ({
  id: row.id,
  userId: row.user_id,
  ...(row.author_name !== null ? { authorName: row.author_name } : {}),
  title: row.title,
  ingredients: row.ingredients,
  instructions: row.instructions,
  isPublic: row.is_public,
  ...(row.published_at !== null ? { publishedAt: iso(row.published_at) } : {}),
  createdAt: iso(row.created_at)
});

export class PostgresRecipeRepository extends PostgresRepository implements RecipeRepository {
  async listByUser(userId: string, tx?: Tx) {
    return (await this.query(tx, 'SELECT * FROM recipes WHERE user_id = $1 ORDER BY seq', [userId])).map(toRecipe);
  }

  async findById(userId: string, recipeId: string, tx?: Tx) {
    const [row] = await this.query(tx, `SELECT * FROM recipes WHERE user_id = $1 AND id = $2${this.lock(tx)}`, [userId, recipeId]);
    return row ? toRecipe(row) : null;
  }

  async findPublicById(recipeId: string, tx?: Tx) {
    const [row] = await this.query(tx, 'SELECT * FROM recipes WHERE id = $1 AND is_public', [recipeId]);
    return row ? toRecipe(row) : null;
  }

  async listPublic(tx?: Tx) {
    return (await this.query(tx, 'SELECT * FROM recipes WHERE is_public ORDER BY seq')).map(toRecipe);
  }

  async insert(recipe: Recipe, tx?: Tx) {
    await this.query(
      tx,
      `INSERT INTO recipes (id, user_id, title, ingredients, instructions, is_public, author_name, published_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        recipe.id,
        recipe.userId,
        recipe.title,
        JSON.stringify(recipe.ingredients),
        JSON.stringify(recipe.instructions),
        recipe.isPublic,
        recipe.authorName ?? null,
        recipe.publishedAt ?? null,
        recipe.createdAt
      ]
    );
  }

  async update(recipe: Recipe, tx?: Tx) {
    await this.query(
      tx,
      `UPDATE recipes SET title = $2, ingredients = $3, instructions = $4, is_public = $5, author_name = $6, published_at = $7 WHERE id = $1`,
      [recipe.id, recipe.title, JSON.stringify(recipe.ingredients), JSON.stringify(recipe.instructions), recipe.isPublic, recipe.authorName ?? null, recipe.publishedAt ?? null]
    );
  }

  async delete(userId: string, recipeId: string, tx?: Tx) {
    return (await this.query(tx, 'DELETE FROM recipes WHERE user_id = $1 AND id = $2 RETURNING id', [userId, recipeId])).length > 0;
  }
}

const toPreferences = (row: Row): PreferencesDocument => ({
  userId: row.user_id,
  content: row.content,
  version: row.version,
  updatedAt: iso(row.updated_at)
});

export class PostgresPreferencesRepository extends PostgresRepository implements PreferencesRepository {
  async getByUserId(userId: string, tx?: Tx) {
    const [row] = await this.query(tx, 'SELECT * FROM preferences_documents WHERE user_id = $1', [userId]);
    return row ? toPreferences(row) : { userId, content: DEFAULT_PREFERENCES, version: 1, updatedAt: new Date().toISOString() };
  }

  async saveIfVersionMatches(userId: string, content: string, expectedVersion: number, tx?: Tx) {
    // El UPDATE solo afecta la fila si la versión sigue siendo la esperada (concurrencia optimista).
    const [updated] = await this.query(
      tx,
      `UPDATE preferences_documents SET content = $2, version = version + 1, updated_at = now()
        WHERE user_id = $1 AND version = $3 RETURNING *`,
      [userId, content, expectedVersion]
    );
    if (updated) return toPreferences(updated);

    // Aún no hay documento: la versión implícita es 1. Si otro proceso lo creó antes, no inserta nada.
    if (expectedVersion !== 1) return null;
    const [inserted] = await this.query(
      tx,
      `INSERT INTO preferences_documents (user_id, content, version, updated_at) VALUES ($1, $2, 2, now())
       ON CONFLICT (user_id) DO NOTHING RETURNING *`,
      [userId, content]
    );
    return inserted ? toPreferences(inserted) : null;
  }
}

const toSession = (row: Row): ChefSession => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  basePreferencesVersion: row.base_preferences_version,
  preferencesVersion: row.preferences_version,
  preferencesMarkdown: row.preferences_markdown,
  startedAt: iso(row.started_at),
  ...(row.closed_at !== null ? { closedAt: iso(row.closed_at) } : {}),
  ...(row.close_reason !== null ? { closeReason: row.close_reason } : {})
});

const toMessage = (row: Row): ChefSessionMessage => ({
  id: row.id,
  sessionId: row.session_id,
  userId: row.user_id,
  role: row.role,
  content: row.content,
  createdAt: iso(row.created_at)
});

export class PostgresChefSessionRepository extends PostgresRepository implements ChefSessionRepository {
  async findById(sessionId: string, tx?: Tx) {
    const [row] = await this.query(tx, `SELECT * FROM chef_sessions WHERE id = $1${this.lock(tx)}`, [sessionId]);
    return row ? toSession(row) : null;
  }

  async insert(session: ChefSession, tx?: Tx) {
    await this.query(
      tx,
      `INSERT INTO chef_sessions (id, user_id, status, base_preferences_version, preferences_version, preferences_markdown, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [session.id, session.userId, session.status, session.basePreferencesVersion, session.preferencesVersion, session.preferencesMarkdown, session.startedAt]
    );
  }

  async update(session: ChefSession, tx?: Tx) {
    await this.query(
      tx,
      `UPDATE chef_sessions SET status = $2, preferences_version = $3, preferences_markdown = $4, closed_at = $5, close_reason = $6 WHERE id = $1`,
      [session.id, session.status, session.preferencesVersion, session.preferencesMarkdown, session.closedAt ?? null, session.closeReason ?? null]
    );
  }

  async listMessages(sessionId: string, tx?: Tx) {
    return (await this.query(tx, 'SELECT * FROM chef_messages WHERE session_id = $1 ORDER BY seq', [sessionId])).map(toMessage);
  }

  async insertMessage(message: ChefSessionMessage, tx?: Tx) {
    await this.query(tx, 'INSERT INTO chef_messages (id, session_id, user_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      message.id,
      message.sessionId,
      message.userId,
      message.role,
      message.content,
      message.createdAt
    ]);
  }
}

const toFeedback = (row: Row): FeedbackEntry => ({
  id: row.id,
  userId: row.user_id,
  sessionId: row.session_id,
  targetType: row.target_type,
  targetId: row.target_id,
  targetName: row.target_name,
  eventType: row.event_type,
  ...(row.note !== null ? { note: row.note } : {}),
  ...(row.idempotency_key !== null ? { idempotencyKey: row.idempotency_key } : {}),
  createdAt: iso(row.created_at)
});

export class PostgresFeedbackRepository extends PostgresRepository implements FeedbackRepository {
  async listByUser(userId: string, tx?: Tx) {
    return (await this.query(tx, 'SELECT * FROM feedback_entries WHERE user_id = $1 ORDER BY seq', [userId])).map(toFeedback);
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string, tx?: Tx) {
    const [row] = await this.query(tx, 'SELECT * FROM feedback_entries WHERE user_id = $1 AND idempotency_key = $2', [userId, idempotencyKey]);
    return row ? toFeedback(row) : null;
  }

  async insert(entry: FeedbackEntry, tx?: Tx) {
    await this.query(
      tx,
      `INSERT INTO feedback_entries (id, user_id, session_id, target_type, target_id, target_name, event_type, note, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.id,
        entry.userId,
        entry.sessionId,
        entry.targetType,
        entry.targetId,
        entry.targetName,
        entry.eventType,
        entry.note ?? null,
        entry.idempotencyKey ?? null,
        entry.createdAt
      ]
    );
  }
}
