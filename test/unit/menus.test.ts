import { describe, expect, it } from 'vitest';
import { MenusService } from '../../src/modules/menus/menus.service.js';
import { addDays, localDate, weekStart } from '../../src/core/shared/time.js';

const TZ = 'America/Bogota';
const today = localDate(new Date(), TZ);
const thisWeek = weekStart(today);

type Menu = { id: string; userId: string; weekStart: string; status: string; progress: unknown; createdAt: Date };
type Entry = { id: string; menuId: string; localDate: string; slot: string; recipeId: string; servings: number };

/** Repositorio en memoria. Las transacciones van en fila, como con el advisory lock de Postgres. */
function setup(menus: Menu[], entries: Entry[], recipeIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const db = { transaction: (fn: (tx: unknown) => Promise<unknown>) => (chain = chain.then(() => fn({}), () => fn({}))) };
  const sorted = () => [...menus].sort((x, y) => y.weekStart.localeCompare(x.weekStart) || y.createdAt.getTime() - x.createdAt.getTime());
  const repo = {
    create: async (_: unknown, m: Omit<Menu, 'createdAt'>) => void menus.push({ createdAt: new Date(), ...m }),
    byId: async (_: string, id: string) => menus.find((m) => m.id === id) ?? null,
    latest: async () => sorted()[0] ?? null,
    lockUser: async () => undefined,
    statusForUpdate: async (_: unknown, id: string) => menus.find((m) => m.id === id)?.status ?? null,
    update: async (_: unknown, id: string, patch: Partial<Menu>) => void Object.assign(menus.find((m) => m.id === id)!, patch),
    entries: async (id: string) => entries.filter((e) => e.menuId === id),
    insertEntries: async (_: unknown, rows: Entry[]) => void entries.push(...rows),
    moveEntries: async (_: unknown, from: string, to: string, day: string) => entries.filter((e) => e.menuId === from && e.localDate >= day).forEach((e) => (e.menuId = to)),
    deleteEntriesFrom: async (_: unknown, id: string, day: string) => {
      const gone = entries.filter((e) => e.menuId === id && e.localDate >= day);
      gone.forEach((e) => entries.splice(entries.indexOf(e), 1));
      return gone;
    },
    recentRecipeIds: async (_: string, id: string) => {
      const previous = sorted().find((m) => m.id !== id);
      return previous ? entries.filter((e) => e.menuId === previous.id).map((e) => e.recipeId) : [];
    },
  };
  const recommendations = { ranked: async () => recipeIds.map((id) => ({ e: { recipe: { id } } })) };
  const recipes = { cards: async (_: string, ids: string[]) => ids.map((id) => ({ id })) };
  const outbox = { record: async (_: unknown, type: string, payload: Record<string, unknown>) => void events.push({ type, payload }), kick: () => undefined };
  const service = new MenusService(db as never, repo as never, recommendations as never, recipes as never, outbox as never);
  return { service, menus, entries, events, settle: () => new Promise((r) => setTimeout(r, 30)) };
}
const menu = (id: string, week: string, status = 'ready'): Menu => ({ id, userId: 'u', weekStart: week, status, progress: {}, createdAt: new Date() });
const entry = (id: string, menuId: string, date: string, recipeId: string, slot = 'lunch'): Entry => ({ id, menuId, localDate: date, slot, recipeId, servings: 2 });

describe('menú semanal', () => {
  it('en una semana nueva abre otro menú, sin repetir primero lo del anterior', async () => {
    const t = setup([menu('m1', addDays(thisWeek, -7))], [entry('e1', 'm1', addDays(thisWeek, -7), 'a'), entry('e2', 'm1', addDays(thisWeek, -6), 'b')]);
    expect((await t.service.currentWeek('u', TZ)).weekStart).toBe(thisWeek);
    await t.settle();
    const week = await t.service.currentWeek('u', TZ);
    expect(week.status).toBe('ready');
    expect(week.entries.map((e) => e.recipe?.id)).toEqual(['c', 'd', 'e', 'f', 'g']);
    expect(week.entries[0]!.date).toBe(today);
    expect(t.events.filter((e) => e.type === 'menu.generated')).toHaveLength(1);
  });

  it('dos peticiones a la vez abren un solo menú', async () => {
    const t = setup([menu('m1', addDays(thisWeek, -7))], []);
    await Promise.all([t.service.currentWeek('u', TZ), t.service.currentWeek('u', TZ)]);
    await t.settle();
    expect(t.menus).toHaveLength(2);
    expect(t.entries).toHaveLength(5);
  });

  it('se trae lo que ya estaba puesto y no le pone otra receta a ese almuerzo', async () => {
    const t = setup([menu('m1', addDays(thisWeek, -7))], [entry('mine', 'm1', today, 'z')]);
    await t.service.currentWeek('u', TZ);
    await t.settle();
    const opened = t.menus.find((m) => m.weekStart === thisWeek)!;
    const mine = t.entries.filter((e) => e.menuId === opened.id);
    expect(mine).toHaveLength(5);
    expect(mine.filter((e) => e.localDate === today).map((e) => e.recipeId)).toEqual(['z']);
  });

  it('generar dos veces el mismo menú no duplica recetas', async () => {
    const t = setup([menu('m1', thisWeek, 'generating')], []);
    await Promise.all([t.service.generate('u', 'm1', TZ), t.service.generate('u', 'm1', TZ)]);
    expect(t.entries).toHaveLength(5);
  });

  it('«Armar otra semana» cambia de hoy en adelante y avisa a la lista de compras', async () => {
    const t = setup([menu('m1', thisWeek)], [entry('past', 'm1', addDays(today, -1), 'a'), entry('now', 'm1', today, 'b')]);
    await t.service.regenerate('u', 'm1', TZ);
    await t.settle();
    expect(t.entries.some((e) => e.id === 'past')).toBe(true);
    expect(t.entries.some((e) => e.id === 'now')).toBe(false);
    expect(t.events.filter((e) => e.type === 'menu.entry_removed').map((e) => e.payload.recipeId)).toEqual(['b']);
    expect(t.entries.filter((e) => e.localDate >= today)).toHaveLength(5);
  });

  it('no regenera uno de otra semana ni uno que ya se está armando', async () => {
    const t = setup([menu('old', addDays(thisWeek, -7)), menu('m1', thisWeek, 'generating')], []);
    await expect(t.service.regenerate('u', 'old', TZ)).rejects.toMatchObject({ code: 'MENU_NOT_CURRENT' });
    await expect(t.service.regenerate('u', 'm1', TZ)).rejects.toMatchObject({ code: 'MENU_GENERATING' });
  });
});
