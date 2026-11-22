import { and, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Executor } from '../../infrastructure/database/postgres/postgres.client.js';
import {
  adaptationProposals,
  comments,
  likedRecipes,
  recipeAdaptations,
  recipeIngredients,
  recipes,
  savedRecipes,
  users,
} from '../../infrastructure/database/postgres/schema.js';

export type RecipeRow = typeof recipes.$inferSelect;
export type RecipeIngredientRow = typeof recipeIngredients.$inferSelect;
export type AdaptationRow = typeof recipeAdaptations.$inferSelect;
export type ProposalRow = typeof adaptationProposals.$inferSelect;

export class RecipesRepository {
  constructor(private readonly db: Db) {}

  async byId(id: string, exec: Executor = this.db): Promise<RecipeRow | null> {
    const [row] = await exec.select().from(recipes).where(eq(recipes.id, id));
    return row ?? null;
  }

  async byIds(ids: string[]): Promise<RecipeRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(recipes).where(inArray(recipes.id, ids));
  }

  async published(): Promise<RecipeRow[]> {
    return this.db.select().from(recipes).where(eq(recipes.status, 'published'));
  }

  async ingredientsFor(recipeIds: string[], exec: Executor = this.db): Promise<Map<string, RecipeIngredientRow[]>> {
    const map = new Map<string, RecipeIngredientRow[]>();
    if (recipeIds.length === 0) return map;
    const rows = await exec.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds)).orderBy(recipeIngredients.position);
    for (const r of rows) {
      const list = map.get(r.recipeId) ?? [];
      list.push(r);
      map.set(r.recipeId, list);
    }
    return map;
  }

  async replaceIngredients(exec: Executor, recipeId: string, rows: Omit<typeof recipeIngredients.$inferInsert, 'recipeId'>[]) {
    await exec.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
    if (rows.length) await exec.insert(recipeIngredients).values(rows.map((r) => ({ ...r, recipeId })));
  }

  async insert(exec: Executor, row: typeof recipes.$inferInsert) {
    const [r] = await exec.insert(recipes).values(row).returning();
    return r!;
  }

  async update(exec: Executor, id: string, patch: Partial<typeof recipes.$inferInsert>) {
    const [r] = await exec.update(recipes).set({ ...patch, updatedAt: new Date() }).where(eq(recipes.id, id)).returning();
    return r ?? null;
  }

  async addRating(exec: Executor, id: string, rating: number) {
    await exec
      .update(recipes)
      .set({ ratingSum: sql`${recipes.ratingSum} + ${rating}`, ratingCount: sql`${recipes.ratingCount} + 1` })
      .where(eq(recipes.id, id));
  }

  // ---------- Adaptaciones ----------
  async activeAdaptation(userId: string, recipeId: string): Promise<AdaptationRow | null> {
    const [row] = await this.db
      .select()
      .from(recipeAdaptations)
      .where(and(eq(recipeAdaptations.userId, userId), eq(recipeAdaptations.recipeId, recipeId), eq(recipeAdaptations.active, true)))
      .orderBy(desc(recipeAdaptations.createdAt))
      .limit(1);
    return row ?? null;
  }

  async adaptationById(id: string): Promise<AdaptationRow | null> {
    const [row] = await this.db.select().from(recipeAdaptations).where(eq(recipeAdaptations.id, id));
    return row ?? null;
  }

  async activateAdaptation(exec: Executor, row: typeof recipeAdaptations.$inferInsert) {
    await exec
      .update(recipeAdaptations)
      .set({ active: false })
      .where(and(eq(recipeAdaptations.userId, row.userId), eq(recipeAdaptations.recipeId, row.recipeId)));
    const [r] = await exec.insert(recipeAdaptations).values({ ...row, active: true }).returning();
    return r!;
  }

  async insertProposal(row: typeof adaptationProposals.$inferInsert) {
    await this.db.insert(adaptationProposals).values(row);
  }

  async proposal(id: string): Promise<ProposalRow | null> {
    const [row] = await this.db.select().from(adaptationProposals).where(eq(adaptationProposals.id, id));
    return row ?? null;
  }

  async markProposalApplied(exec: Executor, id: string) {
    await exec.update(adaptationProposals).set({ appliedAt: new Date() }).where(eq(adaptationProposals.id, id));
  }

  // ---------- Guardar / me gusta ----------
  async save(userId: string, recipeId: string) {
    await this.db.insert(savedRecipes).values({ userId, recipeId }).onConflictDoNothing();
  }

  async unsave(userId: string, recipeId: string) {
    await this.db.delete(savedRecipes).where(and(eq(savedRecipes.userId, userId), eq(savedRecipes.recipeId, recipeId)));
  }

  /** Devuelve true si cambió algo (para no inflar el contador con PUT repetidos). */
  async like(exec: Executor, userId: string, recipeId: string): Promise<boolean> {
    const rows = await exec.insert(likedRecipes).values({ userId, recipeId }).onConflictDoNothing().returning();
    if (rows.length) await exec.update(recipes).set({ likesCount: sql`${recipes.likesCount} + 1` }).where(eq(recipes.id, recipeId));
    return rows.length > 0;
  }

  async unlike(exec: Executor, userId: string, recipeId: string): Promise<boolean> {
    const rows = await exec.delete(likedRecipes).where(and(eq(likedRecipes.userId, userId), eq(likedRecipes.recipeId, recipeId))).returning();
    if (rows.length) await exec.update(recipes).set({ likesCount: sql`greatest(${recipes.likesCount} - 1, 0)` }).where(eq(recipes.id, recipeId));
    return rows.length > 0;
  }

  async viewerFlags(userId: string, recipeIds: string[]) {
    if (recipeIds.length === 0) return { saved: new Set<string>(), liked: new Set<string>() };
    const [s, l] = await Promise.all([
      this.db.select({ id: savedRecipes.recipeId }).from(savedRecipes).where(and(eq(savedRecipes.userId, userId), inArray(savedRecipes.recipeId, recipeIds))),
      this.db.select({ id: likedRecipes.recipeId }).from(likedRecipes).where(and(eq(likedRecipes.userId, userId), inArray(likedRecipes.recipeId, recipeIds))),
    ]);
    return { saved: new Set(s.map((r) => r.id)), liked: new Set(l.map((r) => r.id)) };
  }

  async likesSince(recipeIds: string[], since: Date) {
    if (recipeIds.length === 0) return new Map<string, number>();
    const rows = await this.db
      .select({ id: likedRecipes.recipeId, n: sql<number>`count(*)::int` })
      .from(likedRecipes)
      .where(and(inArray(likedRecipes.recipeId, recipeIds), gt(likedRecipes.createdAt, since)))
      .groupBy(likedRecipes.recipeId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  // ---------- Comunidad ----------
  async communityPublished(): Promise<(RecipeRow & { authorName: string; authorLastName: string | null; authorAvatar: string | null })[]> {
    const rows = await this.db
      .select({ r: recipes, name: users.name, lastName: users.lastName, avatar: users.avatarUrl })
      .from(recipes)
      .innerJoin(users, eq(users.id, recipes.authorId))
      .where(and(eq(recipes.status, 'published'), eq(recipes.authorType, 'user')));
    return rows.map((x) => ({ ...x.r, authorName: x.name, authorLastName: x.lastName, authorAvatar: x.avatar }));
  }

  async comments(recipeId: string, limit: number, cursor: { k: string; id: string } | null) {
    const where: SQL[] = [eq(comments.recipeId, recipeId)];
    if (cursor) {
      const at = new Date(cursor.k);
      where.push(or(lt(comments.createdAt, at), and(eq(comments.createdAt, at), lt(comments.id, cursor.id)))!);
    }
    return this.db
      .select({ c: comments, name: users.name, lastName: users.lastName, avatar: users.avatarUrl })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(and(...where))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(limit + 1);
  }

  async insertComment(exec: Executor, row: typeof comments.$inferInsert) {
    const [c] = await exec.insert(comments).values(row).returning();
    await exec.update(recipes).set({ commentsCount: sql`${recipes.commentsCount} + 1` }).where(eq(recipes.id, row.recipeId));
    return c!;
  }

  async authoredBy(userId: string, status: string | undefined, limit: number, cursor: { k: string; id: string } | null) {
    const where: SQL[] = [eq(recipes.authorId, userId), eq(recipes.authorType, 'user')];
    if (status) where.push(eq(recipes.status, status));
    if (cursor) {
      const at = new Date(cursor.k);
      where.push(or(lt(recipes.updatedAt, at), and(eq(recipes.updatedAt, at), lt(recipes.id, cursor.id)))!);
    }
    return this.db.select().from(recipes).where(and(...where)).orderBy(desc(recipes.updatedAt), desc(recipes.id)).limit(limit + 1);
  }

  async countPublishedBy(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(recipes)
      .where(and(eq(recipes.authorId, userId), eq(recipes.status, 'published')));
    return row?.n ?? 0;
  }
}
