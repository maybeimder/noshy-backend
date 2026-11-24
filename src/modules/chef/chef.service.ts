import type { Outbox } from '../../core/events/outbox.js';
import type { ChefRepository } from './chef.repository.js';
import type { RecipesRepository } from '../recipes/recipes.repository.js';
import type { ShoppingRepository } from '../shopping/shopping.repository.js';
import type { UsersRepository } from '../auth/auth.repository.js';
import type { ChefBlock, ChefMessageDoc, ChefThreadDoc } from '../../infrastructure/database/mongo/collections.js';
import type { ChefEngine, ChefInputResolved, ChefTools } from './chef.providers.js';
import type { RecommendationsService } from '../recipes/recommendations.service.js';
import type { RecipesService } from '../recipes/recipes.service.js';
import type { InsightsService } from './insights.service.js';
import type { PreferencesService } from '../onboarding/preferences.service.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import { Errors, field } from '../../core/shared/errors.js';
import { newId } from '../../core/shared/ids.js';
import { WEEKDAYS_ES, localWeekday } from '../../core/shared/time.js';

export type ChefInput =
  | { type: 'text'; text: string; via: 'keyboard' | 'voice' }
  | {
      type: 'action';
      action:
        | { type: 'quickReply'; messageId: string; optionId: string }
        | { type: 'suggestedPrompt'; messageId: string; optionId: string }
        | { type: 'anotherIdea'; messageId: string; blockId: string }
        | { type: 'openChef'; prompt?: string; threadId?: string }
        | { type: 'openRecipe'; recipeId: string }
        | { type: 'openRecommendations'; filters: Record<string, unknown> }
        | { type: 'openScreen'; screen: string };
    };

export type StreamEvent =
  | { event: 'message.created'; data: { message: ReturnType<ChefService['dto']> } }
  | { event: 'block.delta'; data: { messageId: string; blockId: string; type: 'text'; delta: string } }
  | { event: 'block.completed'; data: { messageId: string; block: ChefBlock } }
  | { event: 'message.completed'; data: { messageId: string } }
  | { event: 'error'; data: { code: string; message: string } };

const STREAM_LOCK_MS = 60_000;
/** Mensajes previos que ve el motor. */
const HISTORY = 8;

/** Conversación con el chef: hilos, historial, mensajes con streaming y retroalimentación. */
export class ChefService {
  constructor(
    private readonly repo: ChefRepository,
    private readonly recipesRepo: RecipesRepository,
    private readonly shoppingRepo: ShoppingRepository,
    private readonly users: UsersRepository,
    private readonly recipes: RecipesService,
    private readonly recommendations: RecommendationsService,
    private readonly insights: InsightsService,
    private readonly preferences: PreferencesService,
    private readonly catalog: CatalogService,
    private readonly engine: ChefEngine,
    private readonly outbox: Outbox,
  ) {}

  dto(m: ChefMessageDoc) {
    return {
      id: m._id,
      threadId: m.threadId,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
      ...(m.proactive ? { proactive: true } : {}),
      ...(m.clientMessageId ? { clientMessageId: m.clientMessageId } : {}),
      blocks: m.blocks,
    };
  }

  private async threadDto(t: ChefThreadDoc) {
    return { id: t._id, context: t.context, unreadCount: await this.repo.unreadCount(t), lastMessageAt: t.lastMessageAt?.toISOString() ?? null };
  }

  async openRecipeThread(userId: string, recipeId: string) {
    const recipe = await this.recipesRepo.byId(recipeId);
    if (!recipe || (recipe.status !== 'published' && recipe.authorId !== userId)) throw Errors.notFound('La receta no existe.');
    if (recipe.authorType === 'user' && !recipe.chefConsultable.enabled && recipe.authorId !== userId)
      throw Errors.forbidden('CHEF_NOT_CONSULTABLE', 'Quien publicó esta receta no activó el chef consultable.');
    const { thread, created } = await this.repo.getOrCreateThread(userId, { type: 'recipe', recipeId, title: recipe.title });
    return { created, thread: await this.threadDto(thread) };
  }

  async threadOrThrow(userId: string, threadId: string) {
    const t = await this.repo.thread(userId, threadId);
    if (!t) throw Errors.notFound('Esa conversación no existe.');
    return t;
  }

  async messages(userId: string, threadId: string, limit = 20, cursor?: string) {
    const t = await this.threadOrThrow(userId, threadId);
    let before: { at: Date; id: string } | null = null;
    if (cursor) {
      try {
        const c = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { k: string; id: string };
        before = { at: new Date(c.k), id: c.id };
      } catch {
        throw Errors.validation([field('cursor', 'INVALID_CURSOR', 'El cursor no es válido.')]);
      }
    }
    const rows = await this.repo.messages(t._id, limit, before);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      data: items.map((m) => this.dto(m)),
      meta: { nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ k: last.createdAt.toISOString(), id: last._id })).toString('base64url') : null, limit },
    };
  }

  async unreadMain(userId: string) {
    const t = await this.repo.thread(userId, 'main');
    return t ? this.repo.unreadCount(t) : 0;
  }

  async markRead(userId: string, threadId: string, lastReadMessageId: string) {
    const t = await this.threadOrThrow(userId, threadId);
    const m = await this.repo.message(userId, lastReadMessageId);
    if (!m || m.threadId !== t._id) throw Errors.validation([field('lastReadMessageId', 'INVALID_OPTION', 'Ese mensaje no es de esta conversación.')]);
    await this.repo.markRead(userId, t._id, m.createdAt);
  }

  async feedback(userId: string, messageId: string, blockId: string, rating: 'up' | 'down') {
    const m = await this.repo.message(userId, messageId);
    if (!m) throw Errors.notFound('Ese mensaje no existe.');
    const block = m.blocks.find((b) => b.id === blockId);
    if (!block) throw Errors.validation([field('blockId', 'INVALID_OPTION', 'Ese bloque no existe en el mensaje.')]);
    await this.repo.setFeedback(messageId, blockId, rating);
    const recipeId = block.type === 'recipeCard' ? String((block.recipe as { id?: string }).id ?? '') || null : null;
    await this.outbox.publish('chef.feedback_given', { userId, messageId, blockId, rating, recipeId });
  }

  /** Convierte la entrada (texto o acción) al formato del motor y al texto que se guarda como mensaje del usuario. */
  private async resolveInput(userId: string, input: ChefInput): Promise<{ resolved: ChefInputResolved; userText: string }> {
    if (input.type === 'text') {
      const text = input.text.trim();
      if (!text) throw Errors.validation([field('input.text', 'EMPTY', 'Escribe algo para el chef.')]);
      return { resolved: { kind: 'text', text }, userText: text };
    }
    const a = input.action;
    if (a.type === 'quickReply' || a.type === 'suggestedPrompt') {
      const m = await this.repo.message(userId, a.messageId);
      const block = m?.blocks.find((b) => (b.type === 'quickReplies' || b.type === 'suggestedPrompts') && b.options.some((o) => o.id === a.optionId));
      const option = block && (block.type === 'quickReplies' || block.type === 'suggestedPrompts') ? block.options.find((o) => o.id === a.optionId) : undefined;
      const label = option?.label ?? a.optionId;
      return { resolved: { kind: a.type, optionId: a.optionId, label }, userText: label };
    }
    if (a.type === 'anotherIdea') {
      const m = await this.repo.message(userId, a.messageId);
      const block = m?.blocks.find((b) => b.id === a.blockId);
      const recipeId = block?.type === 'recipeCard' ? String((block.recipe as { id?: string }).id ?? '') : null;
      return { resolved: { kind: 'anotherIdea', recipeId }, userText: 'Otra idea' };
    }
    if (a.type === 'openChef' && a.prompt) return { resolved: { kind: 'text', text: a.prompt }, userText: a.prompt };
    throw Errors.validation([field('input.action.type', 'NOT_SUPPORTED', 'Esa acción no se envía como mensaje.')]);
  }

  private tools(userId: string, prefsEquipment: string[], prefsSummary = ''): ChefTools {
    return {
      candidates: async ({ excludeRecipeIds, limit }) => {
        const ranked = (await this.recommendations.ranked(userId, { excludeRecipeIds })).slice(0, limit);
        const flags = await this.recipesRepo.viewerFlags(userId, ranked.map((r) => r.e.recipe.id));
        return ranked.map((r) => this.recipes.card(r.e, flags.saved.has(r.e.recipe.id)));
      },
      preferencesSummary: () => prefsSummary,
      recommend: async ({ excludeRecipeIds, prefer }) => {
        const ranked = await this.recommendations.ranked(userId, { excludeRecipeIds, maxMinutes: prefer === 'quick' ? 20 : undefined });
        const top = ranked.slice(0, 5);
        if (prefer === 'hearty') top.sort((a, b) => b.e.nutritionPerServing.kcal - a.e.nutritionPerServing.kcal);
        if (prefer === 'protein') top.sort((a, b) => b.e.nutritionPerServing.proteinG - a.e.nutritionPerServing.proteinG);
        const pick = top[0];
        if (!pick) return null;
        const flags = await this.recipesRepo.viewerFlags(userId, [pick.e.recipe.id]);
        return this.recipes.card(pick.e, flags.saved.has(pick.e.recipe.id));
      },
      missingFromShoppingList: async () => [...(await this.shoppingRepo.activeIngredientIds(userId))].map((id) => this.catalog.label(id)),
      topInsight: () => this.insights.top(userId),
      recipe: async (recipeId) => {
        const r = await this.recipesRepo.byId(recipeId);
        if (!r) return null;
        const idx = r.steps.findIndex((s) => s.heatLevel >= 7 && s.ingredients.some((i) => i.ingredientId && this.catalog.ingredient(i.ingredientId)?.categoryId === 'protein'));
        return { id: r.id, title: r.title, hasHighHeatStep: idx >= 0 ? idx : null };
      },
      proposeAdaptation: async (recipeId, kind, summary, changes, stepNotes) => {
        const id = newId('proposal');
        await this.recipesRepo.insertProposal({ id, userId, recipeId, kind, summary, changes, stepNotes, expiresAt: new Date(Date.now() + 24 * 3_600_000) });
        return id;
      },
      hasEquipment: (id) => prefsEquipment.includes(id),
      recipeBrief: (recipeId) => this.recipes.brief(userId, recipeId).catch(() => null),
    };
  }

  /**
   * Envía un mensaje y transmite la respuesta. `emit` recibe cada evento SSE.
   * Idempotente por `clientMessageId`: un reintento devuelve la respuesta ya generada.
   */
  async send(userId: string, threadId: string, body: { clientMessageId: string; input: ChefInput }, emit: (e: StreamEvent) => void | Promise<void>) {
    const thread = await this.threadOrThrow(userId, threadId);
    const replay = await this.repo.byClientMessageId(userId, body.clientMessageId);
    if (replay) {
      await emit({ event: 'message.created', data: { message: this.dto(replay) } });
      const answer = (await this.repo.messages(thread._id, 50, null)).reverse().find((m) => m.role === 'chef' && m.createdAt >= replay.createdAt);
      if (answer) {
        await emit({ event: 'message.created', data: { message: this.dto(answer) } });
        await emit({ event: 'message.completed', data: { messageId: answer._id } });
      }
      return;
    }
    const last = await this.repo.lastChefMessage(thread._id);
    if (last?.status === 'streaming' && Date.now() - last.createdAt.getTime() < STREAM_LOCK_MS)
      throw Errors.conflict('CHEF_BUSY', 'El chef todavía está respondiendo tu mensaje anterior.');

    const { resolved, userText } = await this.resolveInput(userId, body.input);
    const [user, prefs, shown, previous] = await Promise.all([
      this.users.findById(userId),
      this.preferences.getOrThrow(userId),
      this.repo.shownRecipeIds(thread._id),
      this.repo.messages(thread._id, HISTORY, null),
    ]);
    const history = previous
      .slice(0, HISTORY)
      .reverse()
      .map((m) => ({ role: m.role, text: m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : b.type === 'recipeCard' ? [`[Receta: ${String(b.recipe.title ?? '')}]`] : [])).join(' ') }))
      .filter((m) => m.text);

    const userMsg: ChefMessageDoc = {
      _id: newId('message'),
      threadId: thread._id,
      userId,
      role: 'user',
      createdAt: new Date(),
      clientMessageId: body.clientMessageId,
      blocks: [{ id: 'b1', type: 'text', text: userText }],
      status: 'complete',
    };
    await this.repo.insertMessage(userMsg);
    await emit({ event: 'message.created', data: { message: this.dto(userMsg) } });

    const chefMsg: ChefMessageDoc = { _id: newId('message'), threadId: thread._id, userId, role: 'chef', createdAt: new Date(Date.now() + 1), blocks: [], status: 'streaming' };
    await this.repo.insertMessage(chefMsg);
    await emit({ event: 'message.created', data: { message: this.dto(chefMsg) } });

    const blocks: ChefBlock[] = [];
    let textBlock: { id: string; type: 'text'; text: string } | null = null;
    let n = 0;
    const recipeIds: string[] = [];
    const idMap = new Map<string, string>();
    try {
      for await (const chunk of this.engine.reply(
        { userName: user?.name ?? '', thread, input: resolved, shownRecipeIds: shown, lastChefMessage: last, history },
        this.tools(userId, prefs.kitchen.equipmentIds, this.preferences.rows(prefs, user?.grammaticalGender ?? null).map((r) => `${r.label}: ${r.summary}`).join('; ')),
      )) {
        if (chunk.type === 'text') {
          if (!textBlock) {
            textBlock = { id: `b${++n}`, type: 'text', text: '' };
            blocks.push(textBlock);
          }
          textBlock.text += chunk.delta;
          await emit({ event: 'block.delta', data: { messageId: chefMsg._id, blockId: textBlock.id, type: 'text', delta: chunk.delta } });
        } else if (chunk.type === 'recipes') {
          recipeIds.push(...chunk.recipeIds);
        } else {
          if (textBlock) {
            await emit({ event: 'block.completed', data: { messageId: chefMsg._id, block: { ...textBlock } } });
            textBlock = null;
          }
          const id = `b${++n}`;
          const draftId = chunk.block.id;
          const block = { ...chunk.block, id } as ChefBlock;
          // El motor puede referirse a un bloque por un id provisional (ej. feedbackPrompt → b_card).
          if (draftId) idMap.set(draftId, id);
          if (block.type === 'feedbackPrompt') block.targetBlockId = idMap.get(block.targetBlockId) ?? block.targetBlockId;
          blocks.push(block);
          await emit({ event: 'block.completed', data: { messageId: chefMsg._id, block } });
        }
      }
      if (textBlock) await emit({ event: 'block.completed', data: { messageId: chefMsg._id, block: { ...textBlock } } });
      await this.repo.updateMessage(chefMsg._id, { blocks, status: 'complete', ...(recipeIds.length ? { recipeIds } : {}) });
      await emit({ event: 'message.completed', data: { messageId: chefMsg._id } });
      await this.outbox.publish('chef.message_sent', { userId, threadId: thread._id, messageId: userMsg._id, inputType: resolved.kind });
    } catch (err) {
      await this.repo.updateMessage(chefMsg._id, { blocks, status: 'failed' });
      await emit({ event: 'error', data: { code: 'CHEF_UNAVAILABLE', message: 'El chef no pudo responder. Intenta de nuevo.' } });
      throw err;
    }
  }

  /** Mensaje proactivo después de una factura: «Vi que compraste pollo y tomate el martes». */
  async proactiveFromReceipt(userId: string, tz: string, labels: string[], purchasedAt: Date | null) {
    if (labels.length === 0) return;
    const user = await this.users.findById(userId);
    if (!user || user.settings.chef.proactivity === 'none') return;
    const { thread } = await this.repo.getOrCreateThread(userId, { type: 'main' });
    const when = purchasedAt ? ` el ${WEEKDAYS_ES[localWeekday(purchasedAt, tz)]}` : '';
    const items = labels.slice(0, 2).map((l) => l.toLowerCase()).join(' y ');
    const msg: ChefMessageDoc = {
      _id: newId('message'),
      threadId: thread._id,
      userId,
      role: 'chef',
      createdAt: new Date(),
      proactive: true,
      status: 'complete',
      blocks: [
        { id: 'b1', type: 'text', text: `Vi que compraste ${items}${when} 🍅 ¿Te armo algo rápido y cremoso?` },
        { id: 'b2', type: 'quickReplies', options: [{ id: 'qr_yes', label: '¡Sí! Algo que llene' }] },
      ],
    };
    await this.repo.insertMessage(msg);
    return msg;
  }
}

