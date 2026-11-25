import type { Db } from '../../infrastructure/database/postgres/postgres.client.js';
import type { Outbox } from '../../core/events/outbox.js';
import type { RecipesRepository } from '../recipes/recipes.repository.js';
import type { UsersRepository } from '../auth/auth.repository.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { Moderation } from './community.providers.js';
import { contentReports } from './community.model.js';
import { ALLERGIES, DIFFICULTIES, labelOf } from '../../core/domain/catalog.js';
import { matchesText } from '../../core/shared/text-search.js';
import { decodeCursor, encodeCursor } from '../../core/shared/cursor.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';

const HIGH_PROTEIN_G = 30;
const NEW_CONTENT_DAYS = 3;

const displayName = (name: string, lastName: string | null) => `${name}${lastName ? ` ${lastName.charAt(0)}.` : ''}`;

/** Comunidad: feed con filtros personalizados, creadores, comentarios y seguir. */
export class CommunityService {
  constructor(
    private readonly db: Db,
    private readonly recipesRepo: RecipesRepository,
    private readonly users: UsersRepository,
    private readonly recipes: RecipesService,
    private readonly catalog: CatalogService,
    private readonly moderation: Moderation,
    private readonly outbox: Outbox,
  ) {}

  async feed(userId: string, q: { filter?: string; q?: string; authorId?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(q.limit ?? 10, 50);
    const ctx = await this.recipes.context(userId);
    const following = new Set(await this.users.followeeIds(userId));
    const filters = [
      { id: 'trending', label: 'Tendencia', icon: 'flame' },
      ...(following.size ? [{ id: 'following', label: 'Los que sigo' }] : []),
      ...ctx.prefs.restrictions.allergyIds.map((a) => ({ id: `${a}Free`, label: ALLERGIES.find((x) => x.id === a)?.label ?? a })),
      { id: 'highProtein', label: 'Alta proteína' },
    ];
    const filter = q.filter ?? 'trending';
    if (!filters.some((f) => f.id === filter) && filter !== 'following' && !ALLERGIES.some((a) => `${a.id}Free` === filter))
      throw Errors.validation([field('filter', 'INVALID_OPTION', 'Filtro desconocido.')]);

    const published = await this.recipesRepo.communityPublished();
    const all = published.filter((r) => (!q.authorId || r.authorId === q.authorId) && matchesText(q.q, r.title, r.cuisineLabel, r.authorName, ...r.tags));
    const evaluated = await this.recipes.evaluateMany(all, ctx);
    const recentLikes = await this.recipesRepo.likesSince(all.map((r) => r.id), new Date(Date.now() - 7 * 86_400_000));
    let rows = evaluated.map((e, i) => ({ e, r: all[i]! }));
    if (filter.endsWith('Free')) {
      const allergen = filter.slice(0, -4);
      rows = rows.filter(({ e }) => !e.ingredients.some((ing) => this.catalog.ingredient(ing.originalIngredientId)?.allergens.includes(allergen)));
    } else if (filter === 'following') {
      rows = rows.filter(({ r }) => r.authorId !== null && following.has(r.authorId));
    } else if (filter === 'highProtein') {
      rows = rows.filter(({ e }) => e.nutritionPerServing.proteinG >= HIGH_PROTEIN_G);
    }
    const score = (r: (typeof rows)[number]) => {
      const ageDays = (Date.now() - (r.r.publishedAt?.getTime() ?? 0)) / 86_400_000;
      return (recentLikes.get(r.r.id) ?? 0) * 3 + r.r.likesCount * 0.2 - ageDays * 2;
    };
    rows.sort((a, b) => score(b) - score(a) || a.r.id.localeCompare(b.r.id));
    const offset = Number(decodeCursor(q.cursor)?.k ?? 0);
    const page = rows.slice(offset, offset + limit);
    const flags = await this.recipesRepo.viewerFlags(userId, page.map((p) => p.r.id));
    return {
      data: page.map(({ e, r }) => ({
        recipe: {
          id: r.id,
          title: r.title,
          cuisine: r.cuisineId ? { id: r.cuisineId, label: r.cuisineLabel ?? r.cuisineId } : null,
          imageUrl: r.imageUrl,
          totalTimeMinutes: { min: r.timeMin ?? 0, max: r.timeMax ?? r.timeMin ?? 0 },
          difficulty: r.difficulty ? { id: r.difficulty, label: labelOf(DIFFICULTIES, r.difficulty) } : null,
          nutritionPerServing: e.nutritionPerServing,
        },
        author: { id: r.authorId!, displayName: displayName(r.authorName, r.authorLastName), initial: r.authorName.charAt(0).toUpperCase(), avatarUrl: r.authorAvatar },
        chefConsultable: r.chefConsultable.enabled,
        stats: { likes: r.likesCount, comments: r.commentsCount },
        viewer: { liked: flags.liked.has(r.id), saved: flags.saved.has(r.id) },
        compatibility: e.evaluation.compatibility,
      })),
      meta: { nextCursor: offset + limit < rows.length ? encodeCursor({ k: offset + limit, id: 'offset' }) : null, limit, filters },
    };
  }

  async creator(userId: string, creatorId: string) {
    const user = await this.users.findById(creatorId);
    if (!user) throw Errors.notFound('Ese usuario no existe.');
    const [recipes, followers, following] = await Promise.all([this.recipesRepo.countPublishedBy(creatorId), this.users.followerCount(creatorId), this.users.followeeIds(userId)]);
    return {
      id: user.id,
      displayName: displayName(user.name, user.lastName),
      initial: user.name.charAt(0).toUpperCase(),
      avatarUrl: user.avatarUrl,
      memberSince: user.createdAt.toISOString(),
      stats: { recipes, followers },
      following: following.includes(creatorId),
      isMe: creatorId === userId,
    };
  }

  /** El autor del comentario o el de la receta. */
  async deleteComment(userId: string, commentId: string) {
    const c = await this.recipesRepo.comment(commentId);
    if (!c) throw Errors.notFound('Ese comentario no existe.');
    if (c.userId !== userId && (await this.recipesRepo.byId(c.recipeId))?.authorId !== userId) throw Errors.forbidden('NOT_YOUR_COMMENT', 'Solo puedes borrar tus comentarios o los de tus recetas.');
    await this.db.transaction((tx) => this.recipesRepo.deleteComment(tx, c));
  }

  /** Una denuncia por persona y contenido: repetirla no suma. */
  async report(userId: string, input: { targetType: 'recipe' | 'comment'; targetId: string; reason: string }) {
    const exists = input.targetType === 'recipe' ? await this.recipesRepo.byId(input.targetId) : await this.recipesRepo.comment(input.targetId);
    if (!exists) throw Errors.notFound('Eso ya no está publicado.');
    await this.db
      .insert(contentReports)
      .values({ id: newId('report'), reporterId: userId, ...input })
      .onConflictDoNothing();
  }

  async creators(userId: string, limit = 10) {
    const all = await this.recipesRepo.communityPublished();
    const following = new Set(await this.users.followeeIds(userId));
    const byAuthor = new Map<string, { name: string; avatar: string | null; latest: number }>();
    for (const r of all) {
      if (!r.authorId || r.authorId === userId) continue;
      const prev = byAuthor.get(r.authorId);
      const t = r.publishedAt?.getTime() ?? 0;
      if (!prev || t > prev.latest) byAuthor.set(r.authorId, { name: r.authorName, avatar: r.authorAvatar, latest: t });
    }
    const users = await this.users.findManyByIds([...following].filter((id) => !byAuthor.has(id)));
    for (const u of users) byAuthor.set(u.id, { name: u.name, avatar: u.avatarUrl, latest: 0 });
    return [...byAuthor]
      .sort((a, b) => Number(following.has(b[0])) - Number(following.has(a[0])) || b[1].latest - a[1].latest)
      .slice(0, limit)
      .map(([id, a]) => ({ id, firstName: a.name, avatarUrl: a.avatar, hasNewContent: Date.now() - a.latest < NEW_CONTENT_DAYS * 86_400_000, following: following.has(id) }));
  }

  async comments(userId: string, recipeId: string, q: { cursor?: string; limit?: number }) {
    await this.recipes.getVisible(userId, recipeId);
    const limit = Math.min(q.limit ?? 20, 50);
    const c = decodeCursor(q.cursor);
    const rows = await this.recipesRepo.comments(recipeId, limit, c ? { k: String(c.k), id: c.id } : null);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      data: items.map((x) => this.commentDto(x.c, x.name, x.lastName, x.avatar)),
      meta: { nextCursor: rows.length > limit && last ? encodeCursor({ k: last.c.createdAt.toISOString(), id: last.c.id }) : null, limit },
    };
  }

  private commentDto(c: { id: string; userId: string; text: string; createdAt: Date; likes: number }, name: string, lastName: string | null, avatar: string | null) {
    return {
      id: c.id,
      author: { id: c.userId, displayName: displayName(name, lastName), initial: name.charAt(0).toUpperCase(), avatarUrl: avatar },
      text: c.text,
      createdAt: c.createdAt.toISOString(),
      likes: c.likes,
      viewerLiked: false,
    };
  }

  async addComment(userId: string, recipeId: string, text: string) {
    const recipe = await this.recipes.getVisible(userId, recipeId);
    const user = await this.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    const review = await this.moderation.review({ text, imageKeys: [] });
    if (!review.approved) throw Errors.unprocessable('CONTENT_REJECTED', review.reason ?? 'El comentario no pasó la moderación.');
    const c = await this.db.transaction(async (tx) => {
      const row = await this.recipesRepo.insertComment(tx, { id: newId('comment'), recipeId, userId, text: text.trim() });
      await this.outbox.record(tx, 'comment.created', { userId, recipeId, commentId: row.id, recipeAuthorId: recipe.authorId });
      return row;
    });
    this.outbox.kick();
    return this.commentDto(c, user.name, user.lastName, user.avatarUrl);
  }

  async setFollowing(userId: string, followeeId: string, following: boolean) {
    if (userId === followeeId) throw Errors.validation([field('userId', 'SELF_FOLLOW', 'No puedes seguirte a ti mismo.')]);
    if (!(await this.users.findById(followeeId))) throw Errors.notFound('Ese usuario no existe.');
    if (following) await this.users.follow(userId, followeeId);
    else await this.users.unfollow(userId, followeeId);
    await this.outbox.publish('user.followed', { userId, followeeId, following });
    return { following };
  }
}
