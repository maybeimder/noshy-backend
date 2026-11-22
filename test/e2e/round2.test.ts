import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, drain, ONBOARDING_PAYLOAD, resetDatabases, testApp } from './helpers.js';
import type { LogMailer } from '../../src/modules/account/account.providers.js';

/**
 * Lo que quedó pendiente en la iteración anterior: verificación de email, Ajustes, exportación y borrado
 * de cuenta, Mi semana, estimación de calorías, revisión de facturas y lista compartida pública.
 */
describe('pendientes v0.3', () => {
  let app: FastifyInstance;
  let api: ReturnType<typeof client>;
  let other: ReturnType<typeof client>;
  const s: Record<string, any> = {};
  const lastCode = (email: string) => {
    const mails = (app.container.providers.mailer as LogMailer).outbox.filter((m) => m.to === email && m.tag === 'emailVerification');
    return mails.at(-1)?.subject.slice(0, 6) ?? null;
  };

  beforeAll(async () => {
    await resetDatabases();
    app = await testApp();
    api = client(app);
    other = client(app);
    const r = await api.post('/auth/register', { name: 'Diana', email: 'diana2@correo.co', password: 'supersecreta', acceptedTermsVersion: '2026-09' });
    api.setToken(r.body.data.tokens.accessToken);
    s.dianaId = r.body.data.user.id;
    await api.post('/me/onboarding/complete', ONBOARDING_PAYLOAD);
    const o = await other.post('/auth/register', { name: 'Leo', email: 'leo@correo.co', password: 'supersecreta', acceptedTermsVersion: '2026-09' });
    other.setToken(o.body.data.tokens.accessToken);
    await other.post('/me/onboarding/complete', { ...ONBOARDING_PAYLOAD, restrictions: null });
    await drain(app);
  });
  afterAll(async () => app?.close());

  describe('verificación de email', () => {
    it('el registro envía el código por evento', () => {
      expect(lastCode('diana2@correo.co')).toMatch(/^\d{6}$/);
    });

    it('código equivocado → 422 con intentos restantes; reenviar antes de 1 min → 429', async () => {
      const code = lastCode('diana2@correo.co')!;
      const wrong = await api.post('/auth/email/verify', { code: code === '000000' ? '111111' : '000000' });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toMatchObject({ code: 'CODE_INVALID', details: { attemptsLeft: 4 } });
      const resend = await api.post('/auth/email/resend');
      expect(resend.status).toBe(429);
      expect(resend.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
      const bad = await api.post('/auth/email/verify', { code: '12ab' });
      expect(bad.status).toBe(422);
    });

    it('código correcto verifica el email', async () => {
      const r = await api.post('/auth/email/verify', { code: lastCode('diana2@correo.co')! });
      expect(r.status).toBe(200);
      expect(r.body.data.user.emailVerified).toBe(true);
      expect((await api.get('/me/settings')).body.data.account.emailVerified).toBe(true);
    });
  });

  describe('Ajustes', () => {
    it('lee y cambia cuenta, chef y notificaciones; el género cambia los textos del perfil', async () => {
      const r = await api.get('/me/settings');
      expect(r.body.data.chef).toEqual({ tone: 'conversational', proactivity: 'all', readStepsAloud: true, units: 'metric' });
      const p = await api.patch('/me/settings', { account: { lastName: 'Restrepo', grammaticalGender: 'feminine' }, chef: { proactivity: 'none' }, notifications: { community: false } });
      expect(p.body.data.account).toMatchObject({ lastName: 'Restrepo', grammaticalGender: 'feminine' });
      expect(p.body.data.chef.proactivity).toBe('none');
      expect(p.body.data.chef.readStepsAloud).toBe(true);
      const profile = await api.get('/me/profile');
      expect(profile.body.data.user.displayName).toBe('Diana Restrepo');
      expect(profile.body.data.preferences[1].summary).toBe('Activa · 2.200 kcal');
      const empty = await api.patch('/me/settings', {});
      expect(empty.status).toBe(422);
    });

    it('con el chef en «ninguno», una factura no deja mensaje proactivo', async () => {
      const boundary = '----x';
      const up = await app.inject({
        method: 'POST',
        url: '/api/v1/me/receipts',
        headers: { authorization: `Bearer ${api.getToken()}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
          Buffer.alloc(1024, 3),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      expect(up.statusCode).toBe(202);
      s.receiptId = JSON.parse(up.body).data.receiptId;
      await drain(app);
      const msgs = await api.get('/me/chef/threads/main/messages');
      expect(msgs.body.data.filter((m: any) => m.proactive)).toHaveLength(0);
    });
  });

  describe('Tu factura (revisión)', () => {
    it('lista las líneas con su toggle y la bolsa viene apagada', async () => {
      const r = await api.get(`/me/receipts/${s.receiptId}/items`);
      expect(r.body.data.items).toHaveLength(6);
      const bag = r.body.data.items.find((i: any) => i.rawLabel === 'BOLSA PLASTICA');
      expect(bag).toMatchObject({ ingredientId: null, addToPantry: false });
      s.chickenLine = r.body.data.items.find((i: any) => i.ingredientId === 'ing_chickenbreast');
      expect(s.chickenLine.addToPantry).toBe(true);
      const tryBag = await api.patch(`/me/receipts/${s.receiptId}/items/${bag.id}`, { addToPantry: true });
      expect(tryBag.body.error.code).toBe('NOT_A_FOOD_ITEM');
    });

    it('apagar una línea la saca de la despensa y prenderla la devuelve', async () => {
      const count = async () => (await api.get('/me/pantry/overview')).body.data.totalItems;
      const before = await count();
      const off = await api.patch(`/me/receipts/${s.receiptId}/items/${s.chickenLine.id}`, { addToPantry: false });
      expect(off.body.data.addToPantry).toBe(false);
      expect(await count()).toBe(before - 1);
      await api.patch(`/me/receipts/${s.receiptId}/items/${s.chickenLine.id}`, { addToPantry: true });
      expect(await count()).toBe(before);
    });
  });

  describe('estimar calorías de texto libre', () => {
    it('reconoce platos comunes y cantidades', async () => {
      const bandeja = await api.post('/nutrition/estimate', { text: 'Bandeja paisa' });
      expect(bandeja.body.data).toMatchObject({ kcal: 1100, confidence: 0.8, matches: [{ label: 'bandeja paisa', servings: 1, source: 'dish' }] });
      const combo = await api.post('/nutrition/estimate', { text: '2 empanadas y un jugo' });
      expect(combo.body.data.kcal).toBe(680);
      expect(combo.body.data.matches.map((m: any) => m.servings)).toEqual([2, 1]);
      const recipe = await api.post('/nutrition/estimate', { text: 'Ajiaco' });
      expect(recipe.body.data.kcal).toBeGreaterThan(400);
      const unknown = await api.post('/nutrition/estimate', { text: 'algo raro' });
      expect(unknown.body.data.confidence).toBeLessThan(0.5);
    });
  });

  describe('Mi semana', () => {
    it('muestra la semana en 7 días', async () => {
      const r = await api.get('/me/menus/current');
      expect(r.status).toBe(200);
      expect(r.body.data.days).toHaveLength(7);
      const entries = r.body.data.days.flatMap((d: any) => d.entries).concat(r.body.data.otherEntries ?? []);
      expect(entries.length).toBeGreaterThan(0);
      s.menuId = r.body.data.id;
      s.entry = entries[0];
    });

    it('cambiar la receta de un día actualiza la lista de compras por evento', async () => {
      const list = (await api.get('/me/shopping-lists/current')).body.data;
      const inList = list.recipes.map((r: any) => r.recipeId);
      const newRecipe = ['rcp_01KATSU', 'rcp_01AJIACO', 'rcp_01BACALAO', 'rcp_01ESPARRAGOS', 'rcp_01GRANOLA'].find((id) => !inList.includes(id))!;
      const p = await api.patch(`/me/menus/${s.menuId}/entries/${s.entry.id}`, { recipeId: newRecipe, servings: 3 });
      expect(p.status).toBe(200);
      expect(p.body.data.entries.find((e: any) => e.id === s.entry.id)).toMatchObject({ servings: 3, recipe: { id: newRecipe } });
      await drain(app);
      const after = (await api.get('/me/shopping-lists/current')).body.data.recipes.map((r: any) => r.recipeId);
      expect(after).toContain(newRecipe);
      expect(after).not.toContain(s.entry.recipe.id);
      s.entryRecipe = newRecipe;
    });

    it('no deja poner una receta que choca con las restricciones', async () => {
      // Diana es sin lactosa y sin mariscos; el yogur del granola bowl no tiene sustituto
      const r = await api.patch(`/me/menus/${s.menuId}/entries/${s.entry.id}`, { recipeId: 'rcp_01GRANOLA' });
      expect(r.body.error.code).toBe('RECIPE_NOT_COMPATIBLE');
    });

    it('mover, agregar y quitar recetas; «Generar lista» no duplica', async () => {
      const moved = await api.patch(`/me/menus/${s.menuId}/entries/${s.entry.id}`, { date: '2026-11-27', slot: 'dinner' });
      expect(moved.body.data.entries.find((e: any) => e.id === s.entry.id)).toMatchObject({ date: '2026-11-27', slot: 'dinner' });
      const added = await api.post(`/me/menus/${s.menuId}/entries`, { date: '2026-11-28', slot: 'lunch', recipeId: 'rcp_01AREPAHUEVO' });
      const newEntry = added.body.data.entries.find((e: any) => e.recipe.id === 'rcp_01AREPAHUEVO');
      expect(newEntry).toBeTruthy();
      await drain(app);
      expect((await api.get('/me/shopping-lists/current')).body.data.recipes.map((r: any) => r.recipeId)).toContain('rcp_01AREPAHUEVO');
      await api.del(`/me/menus/${s.menuId}/entries/${newEntry.id}`);
      await drain(app);
      expect((await api.get('/me/shopping-lists/current')).body.data.recipes.map((r: any) => r.recipeId)).not.toContain('rcp_01AREPAHUEVO');
      const gen = await api.post(`/me/menus/${s.menuId}/shopping-list`);
      expect(gen.body.data.added).toBe(0);
      expect(gen.body.data.recipes).toBeGreaterThan(0);
    });
  });

  describe('lista compartida', () => {
    it('el enlace se abre sin login y muestra solo lo necesario', async () => {
      const list = (await api.get('/me/shopping-lists/current')).body.data;
      const share = await api.post(`/me/shopping-lists/${list.id}/share`);
      const token = share.body.data.url.split('/l/')[1];
      const pub = await app.inject({ method: 'GET', url: `/api/v1/shared/lists/${token}` });
      expect(pub.statusCode).toBe(200);
      const body = JSON.parse(pub.body).data;
      expect(body.progress.total).toBe(list.progress.total);
      expect(body.groups[0].items[0]).toEqual({ label: expect.any(String), quantity: expect.any(String), checked: expect.any(Boolean) });
      expect(JSON.stringify(body)).not.toContain('usr_');
      expect((await app.inject({ method: 'GET', url: '/api/v1/shared/lists/nope1234' })).statusCode).toBe(404);
    });
  });

  describe('exportar y borrar la cuenta', () => {
    it('exporta mis datos de forma asíncrona', async () => {
      const req = await api.post('/me/data-exports');
      expect(req.status).toBe(202);
      expect((await api.get(`/me/data-exports/${req.body.data.exportId}`)).body.data.status).toBe('processing');
      await drain(app);
      const st = await api.get(`/me/data-exports/${req.body.data.exportId}`);
      expect(st.body.data).toMatchObject({ status: 'ready', downloadPath: expect.stringContaining('/download') });
      const file = await api.get(`/me/data-exports/${req.body.data.exportId}/download`);
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(file.body.profile.email).toBe('diana2@correo.co');
      expect(file.body.profile.passwordHash).toBeUndefined();
      expect(file.body.pantry_items.length).toBeGreaterThan(0);
      expect(file.body.chefThreads).toBeDefined();
    });

    it('borra la cuenta: sus recetas quedan retiradas (410) y Mongo queda limpio', async () => {
      const up = await api.post('/media/uploads', { purpose: 'recipeCover', contentType: 'image/jpeg', sizeBytes: 100 });
      const url = new URL(up.body.data.uploadUrl);
      await app.inject({ method: 'PUT', url: `${url.pathname}${url.search}`, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.alloc(100, 1) });
      const draft = await api.post('/me/recipes', { title: 'Arroz de Diana' });
      await api.patch(`/me/recipes/${draft.body.data.id}`, {
        coverMediaId: up.body.data.mediaId,
        ingredients: [
          { ingredientId: 'ing_rice', quantity: { value: 200, unit: 'g' } },
          { ingredientId: 'ing_tomato', quantity: { value: 1, unit: 'unit' } },
        ],
        steps: [{ text: 'Cocina el arroz con tomate.' }],
      });
      await api.post(`/me/recipes/${draft.body.data.id}/publish`);
      await drain(app);
      expect((await other.get(`/recipes/${draft.body.data.id}`)).status).toBe(200);

      const noConfirm = await api.call('DELETE', '/me', { body: {} });
      expect(noConfirm.status).toBe(422);
      const del = await api.call('DELETE', '/me', { body: { confirm: true } });
      expect(del.status).toBe(204);
      await drain(app);
      expect((await api.get('/me/settings')).status).toBe(401);
      const gone = await other.get(`/recipes/${draft.body.data.id}`);
      expect(gone.status).toBe(410);
      expect(gone.body.error.code).toBe('RECIPE_REMOVED');
      const feed = await other.get('/community/feed');
      expect(feed.body.data.map((x: any) => x.recipe.id)).not.toContain(draft.body.data.id);
      const { c } = app.container.mongo;
      expect(await c.chefThreads.countDocuments({ userId: s.dianaId })).toBe(0);
      // Del stream del usuario solo queda la lápida `user.deleted`.
      expect((await app.container.events.store.readStream(s.dianaId)).map((e) => e.type)).toEqual(['user.deleted']);
      const login = await api.post('/auth/login', { email: 'diana2@correo.co', password: 'supersecreta' }, { auth: false });
      expect(login.status).toBe(401);
    });
  });
});
