import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { client, drain, ONBOARDING_PAYLOAD, resetDatabases, testApp } from './helpers.js';

/**
 * Recorrido completo de Diana: cuenta → onboarding → despensa → Inicio → chef → receta →
 * lista de compras → modo cocina → factura → comunidad → crear receta → perfil.
 * Cada paso verifica el contrato y los efectos que llegan por eventos.
 */
describe('recorrido completo', () => {
  let app: FastifyInstance;
  let api: ReturnType<typeof client>;
  const s: Record<string, any> = {};

  beforeAll(async () => {
    await resetDatabases();
    app = await testApp();
    api = client(app);
  });
  afterAll(async () => app?.close());

  describe('01 · cuenta y onboarding', () => {
    it('rechaza rutas privadas sin token con el formato de error del contrato', async () => {
      const r = await api.get('/me/onboarding');
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    });

    it('registra con email y devuelve sesión', async () => {
      const r = await api.post('/auth/register', { name: 'Diana', email: 'Diana@Correo.co', password: 'supersecreta', acceptedTermsVersion: '2026-09' });
      expect(r.status).toBe(201);
      expect(r.body.data.user).toMatchObject({ name: 'Diana', email: 'diana@correo.co', onboardingStatus: 'pending', emailVerified: false });
      expect(r.body.data.user.id).toMatch(/^usr_/);
      expect(r.body.data.tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
      s.tokens = r.body.data.tokens;
      api.setToken(s.tokens.accessToken);
    });

    it('no permite repetir email', async () => {
      const r = await api.post('/auth/register', { name: 'Otra', email: 'diana@correo.co', password: 'supersecreta', acceptedTermsVersion: '2026-09' }, { auth: false });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('valida campos con 422 y details por campo', async () => {
      const r = await api.post('/auth/register', { name: '', email: 'no-es-email', password: '123', acceptedTermsVersion: '2026-09' }, { auth: false });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(r.body.error.details.map((d: any) => d.field)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    });

    it('inicia sesión y rota el refresh token (reusar uno viejo revoca la familia)', async () => {
      const login = await api.post('/auth/login', { email: 'diana@correo.co', password: 'supersecreta' }, { auth: false });
      expect(login.status).toBe(200);
      const bad = await api.post('/auth/login', { email: 'diana@correo.co', password: 'mala' }, { auth: false });
      expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
      const r1 = await api.post('/auth/refresh', { refreshToken: login.body.data.tokens.refreshToken }, { auth: false });
      expect(r1.status).toBe(200);
      const reuse = await api.post('/auth/refresh', { refreshToken: login.body.data.tokens.refreshToken }, { auth: false });
      expect(reuse.body.error.code).toBe('REFRESH_TOKEN_INVALID');
      const afterRevoke = await api.post('/auth/refresh', { refreshToken: r1.body.data.tokens.refreshToken }, { auth: false });
      expect(afterRevoke.status).toBe(401);
    });

    it('exige onboarding completo para la experiencia diaria', async () => {
      const r = await api.get('/me/home');
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('ONBOARDING_INCOMPLETE');
    });

    it('entrega catálogos con ETag y 304', async () => {
      const r = await api.get('/onboarding/options');
      expect(r.status).toBe(200);
      expect(r.body.data.goals).toHaveLength(6);
      expect(r.body.data.stores.map((x: any) => x.id)).toContain('d1');
      expect(r.body.data.limits.maxGoals).toBe(2);
      const again = await api.get('/onboarding/options', { headers: { 'if-none-match': r.headers.etag as string } });
      expect(again.status).toBe(304);
    });

    it('calcula el punto de partida sin guardar nada', async () => {
      const r = await api.post('/nutrition/targets/preview', { goalIds: ['eatHealthier', 'saveTime'], activityLevel: 'active', biometrics: null });
      expect(r.body.data).toMatchObject({ kcal: 2200, range: { min: 1400, max: 4000, step: 50 }, basis: 'populationDefault' });
    });

    it('guarda borrador y pasa a inProgress', async () => {
      const r = await api.patch('/me/onboarding', { currentStep: 'tastes', draft: { activityLevel: 'active' }, skippedSteps: [] });
      expect(r.body.data).toMatchObject({ status: 'inProgress', currentStep: 'tastes', draft: { activityLevel: 'active' } });
    });

    it('valida reglas de negocio del paquete', async () => {
      const r = await api.post('/me/onboarding/complete', { ...ONBOARDING_PAYLOAD, goals: { ids: ['eatHealthier', 'saveTime', 'maintain'], customNote: null }, nutrition: { kcalTarget: 2225, adjustedByUser: true } });
      expect(r.status).toBe(422);
      expect(r.body.error.details.map((d: any) => d.field)).toEqual(['goals.ids', 'nutrition.kcalTarget']);
    });

    it('completa el onboarding en un solo paquete, idempotente por Idempotency-Key', async () => {
      const key = 'b7c8a1e0-1111-4c55-9b4a-1d2e3f4a5b6c';
      const r = await api.post('/me/onboarding/complete', ONBOARDING_PAYLOAD, { headers: { 'idempotency-key': key } });
      expect(r.status).toBe(200);
      expect(r.body.data.onboardingStatus).toBe('completed');
      expect(r.body.data.firstMenu).toMatchObject({ status: 'generating' });
      expect(r.body.data.summary.never).toEqual(
        expect.arrayContaining([
          { id: 'lactose', label: 'Lactosa', kind: 'allergy' },
          expect.objectContaining({ label: 'Cilantro', kind: 'custom', matchedIngredientId: 'ing_cilantro' }),
        ]),
      );
      // «Queso» no se ofrece como gusto porque choca con «sin lactosa»
      expect(r.body.data.summary.loves.map((l: any) => l.id)).not.toContain('cheese');
      s.menuId = r.body.data.firstMenu.menuId;
      const replay = await api.post('/me/onboarding/complete', ONBOARDING_PAYLOAD, { headers: { 'idempotency-key': key } });
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.data.firstMenu.menuId).toBe(s.menuId);
      const other = await api.post('/me/onboarding/complete', ONBOARDING_PAYLOAD);
      expect(other.body.error.code).toBe('ONBOARDING_ALREADY_COMPLETED');
    });

    it('por eventos: genera el primer menú y arma la lista de compras', async () => {
      await drain(app);
      const menu = await api.get(`/me/menus/${s.menuId}`);
      expect(menu.body.data.status).toBe('ready');
      expect(menu.body.data.entries.length).toBeGreaterThanOrEqual(3);
      // todas las recetas del menú se pueden cocinar con sus restricciones (tal cual o adaptadas)
      for (const e of menu.body.data.entries) {
        expect((await api.get(`/recipes/${e.recipe.id}`)).body.data.compatibility.ok).toBe(true);
      }
      const list = await api.get('/me/shopping-lists/current');
      expect(list.status).toBe(200);
      expect(list.body.data.recipes.length).toBe(menu.body.data.entries.length);
      expect(list.body.data.progress.total).toBeGreaterThan(5);
    });

    it('Tu despensa: sugiere ingredientes de tus platos sin lo que choca', async () => {
      const r = await api.get('/me/pantry/suggestions');
      expect(r.status).toBe(200);
      const ids = r.body.data.groups.flatMap((g: any) => g.items.map((i: any) => i.ingredientId));
      expect(ids).toContain('ing_oatdrink');
      expect(ids).not.toContain('ing_cream');
      expect(r.body.data.hiddenByRestrictions).toBeGreaterThan(0);
      expect(r.body.data.basedOn.map((b: any) => b.dishId)).toContain('arepa');
    });

    it('Tu despensa: «Lo tengo» va a la despensa y «Me falta» a la lista', async () => {
      const before = (await api.get('/me/shopping-lists/current')).body.data.progress.total;
      const r = await api.post('/me/pantry/bulk', {
        answers: [
          { ingredientId: 'ing_rigatoni', status: 'have' },
          { ingredientId: 'ing_chickenbreast', status: 'have' },
          { ingredientId: 'ing_tomato', status: 'have' },
          { ingredientId: 'ing_oatdrink', status: 'have' },
          { ingredientId: 'ing_spinach', status: 'have' },
          { ingredientId: 'ing_gochujang', status: 'missing' },
        ],
        skipped: false,
      });
      expect(r.status).toBe(200);
      expect(r.body.data.pantry).toMatchObject({ added: 5, removed: 0, total: 5 });
      expect(r.body.data.shoppingList.total).toBeGreaterThanOrEqual(before);
      const dup = await api.post('/me/pantry/bulk', { answers: [{ ingredientId: 'ing_tomato', status: 'have' }, { ingredientId: 'ing_tomato', status: 'missing' }], skipped: false });
      expect(dup.body.error.details[0].code).toBe('DUPLICATE_INGREDIENT');
    });
  });

  describe('02 · experiencia diaria', () => {
    it('Inicio: día, ideas de la franja, badge del chef', async () => {
      await drain(app);
      const r = await api.get('/me/home?date=2026-10-16');
      expect(r.status).toBe(200);
      const d = r.body.data;
      expect(d.greeting.name).toBe('Diana');
      expect(d.day.nutrition.target.kcal).toBe(2200);
      expect(d.day.meals.map((m: any) => m.label)).toEqual(['Desayuno', 'Snack 1', 'Almuerzo', 'Cena']);
      expect(d.ideas.items.length).toBeGreaterThan(0);
      expect(d.ideas.items[0]).toMatchObject({ id: expect.stringMatching(/^rcp_/), reason: { kind: expect.any(String), label: expect.any(String) } });
      expect(d.chef.unreadCount).toBe(0);
    });

    it('registra una comida y el día suma; borrarla resta', async () => {
      const add = await api.post('/me/days/2026-10-16/meals', { slot: 'breakfast', freeText: 'Arepa con queso', nutrition: { kcal: 420, proteinG: 18, carbsG: 50, fatG: 15 } });
      expect(add.status).toBe(201);
      expect(add.body.data.day.nutrition.consumed.kcal).toBe(420);
      expect(add.body.data.day.meals[0]).toMatchObject({ slot: 'breakfast', status: 'logged', kcal: 420 });
      const snack = await api.post('/me/days/2026-10-16/meals', { slot: 'snack1', freeText: 'Manzana', nutrition: { kcal: 80, proteinG: 0, carbsG: 20, fatG: 0 } });
      const del = await api.del(`/me/days/2026-10-16/meals/${snack.body.data.meal.id}`);
      expect(del.body.data.day.nutrition.consumed.kcal).toBe(420);
    });

    it('recomendaciones con prioridad a la despensa y paginación', async () => {
      const r = await api.get('/me/recommendations?source=pantry&limit=2');
      expect(r.body.data).toHaveLength(2);
      expect(r.body.data[0].reason.kind).toBe('pantry');
      expect(r.body.meta.nextCursor).toBeTruthy();
      const next = await api.get(`/me/recommendations?source=pantry&limit=2&cursor=${r.body.meta.nextCursor}`);
      expect(next.body.data[0].id).not.toBe(r.body.data[0].id);
    });

    it('detalle de receta adaptado: crema → bebida de avena, rigatoni → pasta de garbanzo', async () => {
      const r = await api.get('/recipes/rcp_01JPASTAROSA');
      expect(r.status).toBe(200);
      const d = r.body.data;
      expect(d.adaptation.id).toMatch(/^adp_/);
      expect(d.adaptation.substitutions.map((x: any) => `${x.from.label} → ${x.to.label}`)).toEqual([
        'Rigatoni → Pasta de garbanzo',
        'Crema de leche → Bebida de avena',
        'Pecorino Romano → Queso vegetal',
      ]);
      expect(d.adaptation.reasons.map((x: any) => x.label)).toEqual(expect.arrayContaining(['Sin lactosa', 'más proteína']));
      expect(d.rating).toEqual({ avg: 4.8, count: 126 });
      expect(d.compatibility.ok).toBe(true);
      expect(d.ingredients.find((i: any) => i.ingredientId === 'ing_oatdrink').inPantry).toBe(true);
      expect(d.ingredients.find((i: any) => i.ingredientId === 'ing_basil').inPantry).toBe(false);
      s.adaptationId = d.adaptation.id;
      const original = await api.get('/recipes/rcp_01JPASTAROSA?adapted=false');
      expect(original.body.data.adaptation).toBeNull();
      // la adaptación es estable entre lecturas
      expect((await api.get('/recipes/rcp_01JPASTAROSA')).body.data.adaptation.id).toBe(s.adaptationId);
    });

    it('chef: respuesta rápida → tarjeta de receta (JSON sin streaming)', async () => {
      const r = await api.post('/me/chef/threads/main/messages', { clientMessageId: 'cmid-0001-aaaa', input: { type: 'text', text: '¡Sí! Algo que llene', via: 'keyboard' } });
      expect(r.status).toBe(200);
      const chef = r.body.data.chefMessage;
      expect(chef.role).toBe('chef');
      const card = chef.blocks.find((b: any) => b.type === 'recipeCard');
      expect(card.recipe.id).toMatch(/^rcp_/);
      const fb = chef.blocks.find((b: any) => b.type === 'feedbackPrompt');
      expect(fb.targetBlockId).toBe(card.id);
      s.chefMsg = chef;
      s.firstIdea = card.recipe.id;
    });

    it('chef: «Otra idea» por SSE no repite receta', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/chef/threads/main/messages',
        headers: { authorization: `Bearer ${s.tokens.accessToken}`, accept: 'text/event-stream' },
        payload: { clientMessageId: 'cmid-0002-bbbb', input: { type: 'action', action: { type: 'anotherIdea', messageId: s.chefMsg.id, blockId: s.chefMsg.blocks.find((b: any) => b.type === 'recipeCard').id } } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      const events = res.body
        .trim()
        .split('\n\n')
        .map((chunk) => ({ event: chunk.match(/^event: (.+)$/m)![1], data: JSON.parse(chunk.match(/^data: (.+)$/m)![1]!) }));
      expect(events[0]!.event).toBe('message.created');
      expect(events.some((e) => e.event === 'block.delta')).toBe(true);
      expect(events.at(-1)!.event).toBe('message.completed');
      const card = events.find((e) => e.event === 'block.completed' && e.data.block.type === 'recipeCard')!;
      expect(card.data.block.recipe.id).not.toBe(s.firstIdea);
      // reintento con el mismo clientMessageId: repite la respuesta, no genera otra
      const retry = await api.post('/me/chef/threads/main/messages', { clientMessageId: 'cmid-0002-bbbb', input: { type: 'text', text: 'x', via: 'keyboard' } });
      expect(retry.body.data.chefMessage.id).toBe(events.find((e) => e.event === 'message.created' && e.data.message.role === 'chef')!.data.message.id);
    });

    it('chef: feedback, historial paginado y leído', async () => {
      const fb = await api.post(`/me/chef/messages/${s.chefMsg.id}/feedback`, { blockId: s.chefMsg.blocks[1].id, rating: 'up' });
      expect(fb.status).toBe(204);
      const hist = await api.get('/me/chef/threads/main/messages?limit=2');
      expect(hist.body.data).toHaveLength(2);
      expect(hist.body.meta.nextCursor).toBeTruthy();
      const read = await api.post('/me/chef/threads/main/read', { lastReadMessageId: hist.body.data[0].id });
      expect(read.status).toBe(204);
    });

    it('hilo de receta: «¿airfryer?» → propuesta → aplicar cambia la adaptación', async () => {
      const t = await api.post('/me/chef/threads', { context: { type: 'recipe', recipeId: 'rcp_01JPASTAROSA' } });
      expect(t.status).toBe(201);
      const again = await api.post('/me/chef/threads', { context: { type: 'recipe', recipeId: 'rcp_01JPASTAROSA' } });
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(t.body.data.id);
      const m = await api.post(`/me/chef/threads/${t.body.data.id}/messages`, { clientMessageId: 'cmid-0003-cccc', input: { type: 'text', text: '¿Puedo hacerla en airfryer?', via: 'voice' } });
      const proposal = m.body.data.chefMessage.blocks.find((b: any) => b.type === 'adaptationProposal');
      expect(proposal.proposalId).toMatch(/^prp_/);
      const applied = await api.post('/recipes/rcp_01JPASTAROSA/adaptations', { proposalId: proposal.proposalId });
      expect(applied.status).toBe(201);
      expect(applied.body.data.adaptation.reasons.map((r: any) => r.id)).toContain('airfryer');
      expect(applied.body.data.chefThreadId).toBe(t.body.data.id);
      s.adaptationId = applied.body.data.adaptation.id;
    });

    it('lista de compras: marcar, cambiar a sugerido, totales recalculados', async () => {
      const list = (await api.get('/me/shopping-lists/current')).body.data;
      s.listId = list.id;
      expect(list.totals.estimated.amount).toBeGreaterThan(0);
      expect(list.filters[0]).toMatchObject({ id: 'all', label: 'Todo' });
      const items = list.groups.flatMap((g: any) => g.items);
      const first = items[0];
      const p = await api.patch(`/me/shopping-lists/${list.id}/items/${first.id}`, { checked: true, actualPrice: { amount: 5000, currency: 'COP' } });
      expect(p.status).toBe(200);
      expect(p.body.data.item.checked).toBe(true);
      expect(p.body.data.totals.spent.amount).toBe(5000);
      expect(p.body.data.progress.inCart).toBe(1);
      const withSug = items.find((i: any) => i.suggestion && !i.checked);
      if (withSug) {
        const sw = await api.post(`/me/shopping-lists/${list.id}/items/${withSug.id}/swap`, { suggestionId: withSug.suggestion.id });
        expect(sw.status).toBe(200);
        expect(sw.body.data.item.product.id).toBe(withSug.suggestion.product.id);
        const stale = await api.post(`/me/shopping-lists/${list.id}/items/${withSug.id}/swap`, { suggestionId: withSug.suggestion.id });
        expect(stale.status).toBe(410);
      }
      const store = await api.get('/me/shopping-lists/current?sort=storeLayout&storeId=d1');
      expect(store.body.data.groups[0].label).toMatch(/^Pasillo 1/);
    });

    it('lista: agregar ingrediente suelto, receta (sin duplicar) y compartir', async () => {
      const add = await api.post('/me/shopping-lists/current/items', { items: [{ ingredientId: 'ing_basil', sourceRecipeId: 'rcp_01JPASTAROSA' }] });
      expect(add.body.data.added + add.body.data.merged).toBe(1);
      const inList = (await api.get('/me/shopping-lists/current')).body.data.recipes.map((r: any) => r.recipeId);
      const pick = ['rcp_01KATSU', 'rcp_01AJIACO', 'rcp_01BACALAO', 'rcp_01ESPARRAGOS'].find((id) => !inList.includes(id))!;
      const rec = await api.post('/me/shopping-lists/current/recipes', { recipeId: pick, servings: 2 });
      expect(rec.status).toBe(200);
      expect(rec.body.data.added + rec.body.data.merged + rec.body.data.skippedInPantry).toBeGreaterThan(0);
      const dup = await api.post('/me/shopping-lists/current/recipes', { recipeId: pick });
      expect(dup.body.error.code).toBe('RECIPE_ALREADY_IN_LIST');
      const share = await api.post(`/me/shopping-lists/${s.listId}/share`);
      expect(share.body.data.url).toMatch(/^https:\/\/noshy\.app\/l\//);
      expect(share.body.data.text).toContain('Lista de compras · semana del');
    });

    it('terminar compra: lo marcado entra a la despensa y lo demás pasa a una lista nueva', async () => {
      const before = (await api.get('/me/pantry/overview')).body.data.totalItems;
      const r = await api.post(`/me/shopping-lists/${s.listId}/checkout`, { storeId: 'd1', carryOverUnchecked: true });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ listStatus: 'completed', pantryAdded: 1, budget: { weekly: { amount: 180000 } } });
      expect(r.body.data.carriedOver).toBeGreaterThan(0);
      const after = (await api.get('/me/pantry/overview')).body.data.totalItems;
      expect(after).toBeGreaterThanOrEqual(before);
      const closed = await api.patch(`/me/shopping-lists/${s.listId}/items/whatever`, { checked: true });
      expect(closed.body.error.code).toBe('LIST_CLOSED');
      const next = await api.get('/me/shopping-lists/current');
      expect(next.body.data.id).not.toBe(s.listId);
    });

    it('despensa: agregar a mano, listar por lugar, ajustar y «se acabó» con reposición por evento', async () => {
      const add = await api.post('/me/pantry/items', { ingredientId: 'ing_pecorino', productId: 'prd_pomona_pecorino150', storage: 'fridge' });
      expect(add.status).toBe(201);
      expect(add.body.data).toMatchObject({ label: 'Pecorino Romano', product: { brand: 'Pomona', packLabel: '150 g' }, quantity: { display: '150 g' }, remainingPct: 100, storage: 'fridge' });
      const fridge = await api.get('/me/pantry?storage=fridge&limit=50');
      expect(fridge.body.data.every((i: any) => i.storage === 'fridge')).toBe(true);
      const patched = await api.patch(`/me/pantry/${add.body.data.id}`, { remainingPct: 30, expiresOn: '2026-12-01' });
      expect(patched.body.data).toMatchObject({ remainingPct: 30, expiresOn: '2026-12-01', expiryEstimated: false });
      const del = await api.del(`/me/pantry/${add.body.data.id}?addToShoppingList=true`);
      expect(del.status).toBe(204);
      await drain(app);
      const list = (await api.get('/me/shopping-lists/current')).body.data;
      expect(list.groups.flatMap((g: any) => g.items).some((i: any) => i.ingredientId === 'ing_pecorino')).toBe(true);
      const ov = await api.get('/me/pantry/overview');
      expect(ov.body.data.storageCounts.all).toBe(ov.body.data.totalItems);
    });

    it('modo cocina: empezar, eventos, terminar → día, despensa, racha', async () => {
      const start = await api.post('/me/cooking-sessions', { recipeId: 'rcp_01JPASTAROSA', servings: 2, adaptationId: s.adaptationId, mealSlot: 'lunch' });
      expect(start.status).toBe(201);
      const sess = start.body.data;
      expect(sess.steps).toHaveLength(6);
      const step3 = sess.steps[2];
      expect(step3.title).toBe('Saltea la espinaca con el ajo');
      expect(step3.heat).toEqual({ level: 5, label: 'Medio' });
      expect(step3.ingredients.map((i: any) => i.quantity.display)).toEqual(['150 g', '2 dientes', '2 cda', '1 pizca']);
      const step4 = sess.steps[3];
      expect(step4.subSteps[1].heatChange).toEqual({ from: 5, to: 8, message: 'Sube a fuego alto' });
      expect(step4.ingredients[1]).toMatchObject({ label: 'Jugo reservado del paso 3', fromStepIndex: 2, quantity: { display: 'todo' } });
      expect(step4.ingredients[3].quantity.display).toBe('al gusto');
      // sustitución aplicada al texto del paso 2
      expect(JSON.stringify(sess.steps[1])).toContain('Bebida de avena');
      const dupStart = await api.post('/me/cooking-sessions', { recipeId: 'rcp_01AREPAHUEVO', servings: 1 });
      expect(dupStart.body.error.code).toBe('SESSION_ALREADY_ACTIVE');

      const ev = await api.post(`/me/cooking-sessions/${sess.id}/events`, {
        events: [
          { type: 'stepEntered', stepIndex: 2, at: '2026-10-16T17:16:00Z' },
          { type: 'timerExtended', stepIndex: 2, subStepIndex: 2, addedSeconds: 60, at: '2026-10-16T17:17:40Z' },
          { type: 'voiceCommand', command: 'next', at: '2026-10-16T17:20:05Z' },
        ],
      });
      expect(ev.status).toBe(202);
      expect(ev.body.data).toEqual({ accepted: 3, currentStepIndex: 2 });
      const evAgain = await api.post(`/me/cooking-sessions/${sess.id}/events`, { events: [{ type: 'stepEntered', stepIndex: 2, at: '2026-10-16T17:16:00Z' }] });
      expect(evAgain.body.data.accepted).toBe(0);

      const active = await api.get('/me/cooking-sessions/active');
      expect(active.body.data).toMatchObject({ id: sess.id, currentStepIndex: 2, stepsCount: 6 });

      const done = await api.post(`/me/cooking-sessions/${sess.id}/complete`, { finishedAt: '2026-10-16T17:42:00Z', logMeal: { slot: 'lunch', servingsEaten: 1 }, rating: 5 });
      expect(done.status).toBe(200);
      expect(done.body.data.meal.slot).toBe('lunch');
      expect(done.body.data.day.meals.find((m: any) => m.slot === 'lunch').status).toBe('logged');
      expect(done.body.data.day.nutrition.consumed.kcal).toBeGreaterThan(420);
      expect(done.body.data.timesCooked).toBe(1);
      expect(done.body.data.stats.cookedCount).toBe(1);
      expect(done.body.data.pantryUpdates.length).toBeGreaterThanOrEqual(0);
      const again = await api.post(`/me/cooking-sessions/${sess.id}/complete`, { finishedAt: '2026-10-16T17:42:00Z', logMeal: null });
      expect(again.body.error.code).toBe('SESSION_NOT_ACTIVE');
      expect((await api.get('/me/cooking-sessions/active')).status).toBe(204);
      await drain(app);
    });

    it('Mi cocina: recetas cocinadas con conteo y filtros', async () => {
      const r = await api.get('/me/cooked-recipes');
      expect(r.body.data[0]).toMatchObject({ recipe: { id: 'rcp_01JPASTAROSA', title: 'Pasta rosa con pollo' }, timesCooked: 1 });
      expect(r.body.meta.facets.map((f: any) => f.label)).toEqual(['Todo', 'Proteína', 'Veggie', '< 20 min']);
      const veggie = await api.get('/me/cooked-recipes?filter=veggie');
      expect(veggie.body.data).toHaveLength(0);
    });

    it('factura: subir → procesar por evento → despensa, señales y mensaje proactivo del chef', async () => {
      const boundary = '----noshy';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="storeId"\r\n\r\nexito\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="factura.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        Buffer.alloc(2048, 7),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const up = await app.inject({
        method: 'POST',
        url: '/api/v1/me/receipts',
        headers: { authorization: `Bearer ${s.tokens.accessToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(up.statusCode).toBe(202);
      const { receiptId } = JSON.parse(up.body).data;
      expect(receiptId).toMatch(/^rct_/);
      expect((await api.get(`/me/receipts/${receiptId}`)).body.data.status).toBe('processing');
      await drain(app);
      const r = await api.get(`/me/receipts/${receiptId}`);
      expect(r.body.data).toMatchObject({ status: 'parsed', store: { id: 'exito', name: 'Éxito' }, itemsCount: 6, pantryAdded: 5 });
      expect(r.body.data.learned).toEqual({ brandsCount: 3, productsCount: 5 });
      const msgs = await api.get('/me/chef/threads/main/messages?limit=1');
      expect(msgs.body.data[0]).toMatchObject({ role: 'chef', proactive: true });
      expect(msgs.body.data[0].blocks[0].text).toMatch(/^Vi que compraste pollo y tomate el /);
      const home = await api.get('/me/home');
      expect(home.body.data.chef.unreadCount).toBe(1);
    });

    it('aprendizajes: marcas frecuentes y voto que las descarta', async () => {
      // Dos facturas más con las mismas marcas para superar el umbral de 3
      for (const n of [1, 2]) {
        await app.container.outbox.publish('receipt.parsed', { userId: s.userId ?? (await me()), receiptId: `rct_fake${n}`, storeId: 'exito', purchasedAt: null, ingredientIds: [], brands: ['Alpina', 'Kikes'] });
      }
      await drain(app);
      const list = await api.get('/me/chef/insights');
      const brands = list.body.data.find((i: any) => i.text.startsWith('Compras'));
      expect(brands).toMatchObject({ text: 'Compras Alpina y Kikes con frecuencia', evidence: { kind: 'receipts', count: 3, label: '3 facturas' } });
      const vote = await api.post(`/me/chef/insights/${brands.id}/feedback`, { vote: 'down' });
      expect(vote.body.data).toMatchObject({ status: 'rejected', userVote: 'down' });
      expect((await api.get('/me/chef/insights')).body.data.find((i: any) => i.id === brands.id)).toBeUndefined();
      // Una compra más de Kikes cambia el orden, no el aprendizaje: lo rechazado no vuelve.
      await app.container.outbox.publish('receipt.parsed', { userId: s.userId ?? (await me()), receiptId: 'rct_fake3', storeId: 'exito', purchasedAt: null, ingredientIds: [], brands: ['Kikes'] });
      await drain(app);
      expect((await api.get('/me/chef/insights')).body.data.filter((i: any) => i.text.startsWith('Compras'))).toEqual([]);
      // Todo queda en el event store, con versión dentro del stream del usuario.
      const parsed = await app.container.events.store.readAll({ types: ['receipt.parsed'] });
      expect(parsed.length).toBeGreaterThanOrEqual(3);
      const stream = await app.container.events.store.readStream(parsed[0]!.streamId);
      expect(stream.map((e) => e.version)).toEqual(stream.map((_, i) => i + 1));
    });

    it('comunidad: feed con filtros personalizados, me gusta y comentarios', async () => {
      const feed = await api.get('/community/feed');
      expect(feed.status).toBe(200);
      expect(feed.body.meta.filters.map((f: any) => f.label)).toEqual(['Tendencia', 'Sin lactosa', 'Sin mariscos', 'Alta proteína']);
      const sopa = feed.body.data.find((x: any) => x.recipe.id === 'rcp_01SOPAPOLLO');
      expect(sopa).toMatchObject({ author: { displayName: 'Valentina R.', initial: 'V' }, chefConsultable: true, stats: { likes: 248 } });
      const like = await api.put('/me/liked-recipes/rcp_01SOPAPOLLO');
      expect(like.body.data).toEqual({ liked: true, likes: 249 });
      expect((await api.put('/me/liked-recipes/rcp_01SOPAPOLLO')).body.data.likes).toBe(249);
      const noLactose = await api.get('/community/feed?filter=lactoseFree');
      expect(noLactose.body.data.map((x: any) => x.recipe.id)).not.toContain('rcp_01ARROZPOLLO');
      const creators = await api.get('/community/creators');
      expect(creators.body.data.map((c: any) => c.firstName)).toEqual(expect.arrayContaining(['Valentina', 'Nicolás']));
      const ok = await api.post('/community/recipes/rcp_01SOPAPOLLO/comments', { text: '¿Se puede congelar?' });
      expect(ok.status).toBe(201);
      expect(ok.body.data.author.displayName).toBe('Diana');
      const comments = await api.get('/community/recipes/rcp_01SOPAPOLLO/comments');
      expect(comments.body.data[0].text).toBe('¿Se puede congelar?');
      const follow = await api.put('/me/following/usr_01LAURA');
      expect(follow.body.data.following).toBe(true);
    });

    it('crear receta: foto firmada, borrador con macros, publicar con moderación por evento', async () => {
      const up = await api.post('/media/uploads', { purpose: 'recipeCover', contentType: 'image/jpeg', sizeBytes: 3000 });
      expect(up.status).toBe(201);
      const url = new URL(up.body.data.uploadUrl);
      const put = await app.inject({ method: 'PUT', url: `${url.pathname}${url.search}`, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.alloc(3000, 1) });
      expect(put.statusCode).toBe(200);
      const tampered = await app.inject({ method: 'PUT', url: `${url.pathname}${url.search.replace(/sig=[^&]+/, 'sig=nope')}`, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.alloc(10) });
      expect(tampered.statusCode).toBe(403);

      const draft = await api.post('/me/recipes', { title: 'Pasta boloñesa de lentejas' });
      expect(draft.status).toBe(201);
      const id = draft.body.data.id;
      const incomplete = await api.post(`/me/recipes/${id}/publish`);
      expect(incomplete.body.error.code).toBe('RECIPE_INCOMPLETE');
      const patched = await api.patch(`/me/recipes/${id}`, {
        coverMediaId: up.body.data.mediaId,
        servings: 4,
        totalTimeMinutes: 20,
        difficulty: 'easy',
        ingredients: [
          { ingredientId: 'ing_lentils', quantity: { value: 250, unit: 'g' } },
          { ingredientId: 'ing_spaghetti', quantity: { value: 400, unit: 'g' } },
          { ingredientId: 'ing_tomato', quantity: { value: 3, unit: 'unit' } },
          { ingredientId: 'ing_garlic', quantity: { value: 2, unit: 'clove' } },
        ],
        steps: [{ text: 'Cocina las lentejas 15 minutos.', timerSeconds: 900, heat: 'medium' }, { text: 'Mezcla con la pasta y el tomate.' }],
        chefConsultable: { enabled: true, useMyStyle: true, suggestSubstitutes: true },
      });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({ nutritionStatus: 'calculated', summary: { ingredientsCount: 4, stepsCount: 2, stepsWithTimer: 1 } });
      expect(patched.body.data.nutritionPerServing.kcal).toBeGreaterThan(300);
      const badUnit = await api.patch(`/me/recipes/${id}`, { ingredients: [{ ingredientId: 'ing_egg', quantity: { value: 1, unit: 'ml' } }] });
      expect(badUnit.body.error.details[0].code).toBe('INVALID_UNIT');
      const pub = await api.post(`/me/recipes/${id}/publish`);
      expect(pub.body.data.status).toBe('inReview');
      await drain(app);
      const mine = await api.get('/me/recipes?status=published');
      expect(mine.body.data.map((r: any) => r.id)).toContain(id);
      const detail = await api.get(`/recipes/${id}`);
      expect(detail.body.data.author.displayName).toBe('Diana');
      const cook = await api.post('/me/cooking-sessions', { recipeId: id, servings: 2 });
      expect(cook.body.data.steps[0].subSteps[0].timerSeconds).toBe(900);
      expect(cook.body.data.steps[0].ingredients[0].quantity.display).toBe('125 g');
      // Mise en place: cada paso con lo suyo, no todo en el primero.
      expect(cook.body.data.steps.map((st: any) => st.ingredients.map((i: any) => i.ingredientId))).toEqual([['ing_lentils', 'ing_garlic'], ['ing_chickpeapasta', 'ing_tomato']]); // el espagueti, ya sustituido
      await api.post(`/me/cooking-sessions/${cook.body.data.id}/abandon`, { atStepIndex: 0, reason: 'later' });
    });

    it('ingredientes: búsqueda marca choques con restricciones', async () => {
      const r = await api.get('/catalog/ingredients/search?q=crema');
      expect(r.body.data.find((i: any) => i.id === 'ing_cream')).toMatchObject({ conflicts: [{ id: 'lactose', label: 'Lactosa' }], allowedUnits: ['ml', 'tbsp', 'cup'], otherUnits: ['g', 'kg', 'l', 'tsp'] });
      expect(r.body.data.find((i: any) => i.id === 'ing_coconutcream').conflicts).toEqual([]);
    });

    it('perfil: estadísticas, aprendizaje y preferencias redactadas; editar recalcula metas', async () => {
      const p = await api.get('/me/profile');
      expect(p.status).toBe(200);
      expect(p.body.data.stats).toMatchObject({ cookedCount: 1, publishedCount: 1 });
      expect(p.body.data.preferences.map((x: any) => x.summary)).toEqual([
        'Más sano · Ahorrar tiempo',
        'Ritmo activo · 2.200 kcal',
        'Sin lactosa, sin mariscos, azúcar extra, cilantro',
        expect.stringMatching(/ · 5 favoritos$/),
        '3 comidas · 30 min',
        'Éxito, D1, Plaza',
      ]);
      expect(p.body.data.learning.signalsCount).toBeGreaterThan(0);
      const edit = await api.patch('/me/preferences', { activityLevel: 'veryActive' });
      expect(edit.body.data.nutritionTargets).toMatchObject({ source: 'recalculated' });
      expect(edit.body.data.nutritionTargets.kcal).toBeGreaterThan(2200);
    });
  });

  async function me() {
    const r = await app.container.pg.db.execute<{ id: string }>(sql`select id from users where email = 'diana@correo.co'`);
    s.userId = r.rows[0]!.id;
    return s.userId as string;
  }
});
