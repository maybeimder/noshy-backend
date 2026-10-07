import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryEventStore } from '../../core/events/in-memory-event-store';
import { replayEvents } from '../../core/events/replay';
import { loginUser, registerUser } from '../../modules/auth/auth.service';
import { closeChefSession, openChefSession } from '../../modules/chef-sessions/chef-session.service';
import { PreferenceEngine } from '../../modules/chef-sessions/events/chef-sessions.observers';
import { createFeedback } from '../../modules/feedback/feedback.service';
import { addInventoryItem, deleteInventoryItem, updateInventoryItem } from '../../modules/inventory/inventory.service';
import { createNutritionPlan, updateActiveNutritionPlan } from '../../modules/plans/plan.service';
import { RecommendationEngine } from '../../modules/recommendations/events/recommendations.observers';
import { CommunityNotificationEngine } from '../../modules/recipes/events/recipes.observers';
import { createRecipe, deleteRecipe, publishRecipe, unpublishRecipe, updateRecipe } from '../../modules/recipes/recipe.service';
import { createShoppingList } from '../../modules/shopping-list/shopping-list.service';
import { setEventStore } from './event-bus';
import {
  communityNotificationEngine,
  createOutboxRelay,
  eventFactory,
  observers,
  preferenceEngine,
  recommendationEngine
} from './register-observers';

const store = new InMemoryEventStore();
setEventStore(store);
const relay = createOutboxRelay(store);

const eventNames = (userId?: string) =>
  (userId ? store.readStream(userId) : store.readAll()).map((record) => record.type);

test('every module records its domain events in the event store after successful mutations', () => {
  const registered = registerUser({ name: 'Ana', email: 'ana-events@noshy.com', password: 'StrongPass1!' });
  assert.ok(registered.ok);
  const userId = registered.data.user.id;
  loginUser({ email: 'ana-events@noshy.com', password: 'StrongPass1!' });

  createNutritionPlan(userId, { objective: 'maintain', targets: { calories: 2000 } });
  updateActiveNutritionPlan(userId, { objective: 'gain_muscle', targets: { calories: 2500 } });

  const item = addInventoryItem(userId, { name: 'Arroz', quantity: 2, unit: 'kg' });
  updateInventoryItem(userId, item.id, { quantity: 3 });
  deleteInventoryItem(userId, item.id);

  const recipe = createRecipe(userId, {
    title: 'Arroz con pollo',
    ingredients: [{ name: 'Arroz', quantity: 1, unit: 'kg' }],
    instructions: ['Cocinar']
  });
  updateRecipe(userId, recipe.id, { title: 'Arroz con pollo 2' });
  publishRecipe(userId, recipe.id, 'Ana');
  unpublishRecipe(userId, recipe.id);
  createShoppingList(userId, { recipes: [{ recipeId: recipe.id, servings: 2 }] });
  deleteRecipe(userId, recipe.id);

  const session = openChefSession(userId);
  createFeedback(userId, {
    sessionId: session.id,
    targetType: 'recipe',
    targetId: 'r-1',
    targetName: 'Ensalada',
    eventType: 'prepared'
  });
  closeChefSession(userId, session.id, { reason: 'manual', preferencesMarkdown: '# Preferencias\n' });

  assert.deepEqual(eventNames(userId), [
    'auth.user_registered',
    'auth.user_logged_in',
    'plans.nutrition_plan_created',
    'plans.nutrition_plan_updated',
    'inventory.item_added',
    'inventory.item_updated',
    'inventory.item_removed',
    'recipes.recipe_created',
    'recipes.recipe_updated',
    'recipes.recipe_published',
    'recipes.recipe_unpublished',
    'shopping.list_generated',
    'recipes.recipe_deleted',
    'chef.session_opened',
    'feedback.feedback_recorded',
    'chef.session_closed'
  ]);
  assert.deepEqual(store.readStream(userId).map((record) => record.version), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.ok(store.outboxMessages().length >= 16);
});

test('failed operations and idempotent duplicates record nothing', () => {
  const before = store.readAll().length;
  const userId = 'ghost-user';

  updateInventoryItem(userId, 'nope', { quantity: 1 });
  deleteRecipe(userId, 'nope');
  createFeedback(userId, { sessionId: 'x', targetType: 'recipe', targetId: 'a', targetName: 'A', eventType: 'selected' });
  loginUser({ email: 'nadie@noshy.com', password: 'x' });

  assert.equal(store.readAll().length, before);
});

test('events never leak credentials', () => {
  registerUser({ name: 'Leak', email: 'leak@noshy.com', password: 'SuperSecret123!' });

  const dump = JSON.stringify(store.readAll());
  assert.ok(!dump.includes('SuperSecret123!'));
  assert.ok(!dump.includes('noshy_'));
});

test('the relay feeds the observers; duplicates and retries do not double count', async () => {
  const registered = registerUser({ name: 'Bea', email: 'bea-events@noshy.com', password: 'StrongPass1!' });
  assert.ok(registered.ok);
  const userId = registered.data.user.id;
  const session = openChefSession(userId);
  const prepared = { sessionId: session.id, targetType: 'recipe', targetId: 'r-9', targetName: 'Lentejas', eventType: 'prepared' } as const;

  createFeedback(userId, prepared, 'key-1');
  createFeedback(userId, prepared, 'key-1'); // duplicado idempotente: no registra evento
  createFeedback(userId, { ...prepared, targetId: 'r-10', targetName: 'Brócoli', eventType: 'discarded' });

  assert.equal(recommendationEngine.topFor(userId).length, 0, 'antes del relay las proyecciones están vacías (consistencia eventual)');

  await relay.drainAll();

  const [top] = recommendationEngine.topFor(userId);
  assert.equal(top.targetName, 'Lentejas');
  assert.equal(top.score, 2);
  assert.deepEqual(preferenceEngine.preferencesOf(userId), { likes: ['Lentejas'], dislikes: ['Brócoli'], notes: [] });
  assert.ok(store.outboxMessages().every((message) => message.status === 'dispatched'));
});

test('community feed follows publish / unpublish through the relay', async () => {
  const registered = registerUser({ name: 'Cris', email: 'cris-events@noshy.com', password: 'StrongPass1!' });
  assert.ok(registered.ok);
  const userId = registered.data.user.id;
  const recipe = createRecipe(userId, { title: 'Pozole', ingredients: [{ name: 'Maíz', quantity: 1, unit: 'kg' }], instructions: ['Hervir'] });

  publishRecipe(userId, recipe.id, 'Cris');
  await relay.drainAll();
  assert.ok(communityNotificationEngine.feed().some((entry) => entry.recipeId === recipe.id && entry.title === 'Pozole'));

  unpublishRecipe(userId, recipe.id);
  await relay.drainAll();
  assert.ok(!communityNotificationEngine.feed().some((entry) => entry.recipeId === recipe.id));
});

test('event sourcing: fresh observers rebuilt from the store match the live projections', async () => {
  await relay.drainAll();

  const recommendations = new RecommendationEngine();
  const preferences = new PreferenceEngine();
  const community = new CommunityNotificationEngine();
  await replayEvents(store, eventFactory, [recommendations, preferences, community]);

  const userIds = new Set(store.readAll().map((record) => record.streamId));
  for (const userId of userIds) {
    assert.deepEqual(recommendations.topFor(userId), recommendationEngine.topFor(userId));
    assert.deepEqual(preferences.preferencesOf(userId), preferenceEngine.preferencesOf(userId));
  }
  assert.deepEqual(community.feed(), communityNotificationEngine.feed());
  assert.equal(observers.length, 3);
});
