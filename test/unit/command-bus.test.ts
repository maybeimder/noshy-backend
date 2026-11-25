import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { CommandBus, DuplicateCommandError, mergeHandlers, UnknownCommandError, type CommandMiddleware } from '../../src/core/commands/command-bus.js';
import { Errors } from '../../src/core/shared/errors.js';
import { createCommandHandlers, type CommandServices } from '../../src/infrastructure/command-bus/register-handlers.js';
import { AccountService } from '../../src/modules/account/index.js';
import { AuthService } from '../../src/modules/auth/index.js';
import { AuthoringService } from '../../src/modules/authoring/index.js';
import { ChefService, InsightsService } from '../../src/modules/chef/index.js';
import { CommunityService } from '../../src/modules/community/index.js';
import { CookingService } from '../../src/modules/cooking/index.js';
import { DaysService, NudgesService } from '../../src/modules/home/index.js';
import { MediaService } from '../../src/modules/media/index.js';
import { MenusService } from '../../src/modules/menus/index.js';
import { OnboardingService, PreferencesService } from '../../src/modules/onboarding/index.js';
import { PantryService, PantrySetupService } from '../../src/modules/pantry/index.js';
import { ReceiptsService } from '../../src/modules/receipts/index.js';
import { RecipesService } from '../../src/modules/recipes/index.js';
import { ShoppingService } from '../../src/modules/shopping/index.js';

const classes: { [K in keyof CommandServices]: { prototype: object } } = {
  account: AccountService,
  auth: AuthService,
  authoring: AuthoringService,
  chef: ChefService,
  insights: InsightsService,
  community: CommunityService,
  cooking: CookingService,
  days: DaysService,
  nudges: NudgesService,
  media: MediaService,
  menus: MenusService,
  onboarding: OnboardingService,
  preferences: PreferencesService,
  pantry: PantryService,
  pantrySetup: PantrySetupService,
  receipts: ReceiptsService,
  recipes: RecipesService,
  shopping: ShoppingService,
};

describe('CommandBus', () => {
  const handlers = mergeHandlers({ 'a.sum': (c: { userId: string; x: number; y: number }) => c.x + c.y }, { 'b.fail': async (_: { userId: string }): Promise<string> => Promise.reject(Errors.notFound('no')) });

  it('ejecuta el único handler del comando y conserva el tipo del resultado', async () => {
    const bus = new CommandBus(handlers);
    const result = await bus.execute('a.sum', { userId: 'u', x: 2, y: 3 });
    expectTypeOf(result).toEqualTypeOf<number>();
    expect(result).toBe(5);
    // @ts-expect-error falta `y`
    void bus.execute('a.sum', { userId: 'u', x: 1 });
    // @ts-expect-error comando que no existe
    await expect(bus.execute('a.nope', {})).rejects.toBeInstanceOf(UnknownCommandError);
  });

  it('deja pasar los errores de aplicación tal cual', async () => {
    await expect(new CommandBus(handlers).execute('b.fail', { userId: 'u' })).rejects.toMatchObject({ status: 404, message: 'no' });
  });

  it('un comando no puede tener dos handlers', () => {
    expect(() => mergeHandlers({ x: () => 1 }, { x: () => 2 })).toThrow(DuplicateCommandError);
  });

  it('los middlewares envuelven al handler en orden y ven al usuario', async () => {
    const seen: string[] = [];
    const mw =
      (name: string): CommandMiddleware =>
      async (ctx, next) => {
        seen.push(`${name}:${ctx.type}:${ctx.userId}`);
        const r = await next();
        seen.push(`/${name}`);
        return r;
      };
    await new CommandBus(handlers, [mw('1'), mw('2')]).execute('a.sum', { userId: 'u', x: 0, y: 0 });
    expect(seen).toEqual(['1:a.sum:u', '2:a.sum:u', '/2', '/1']);
  });
});

describe('handlers del sistema', () => {
  /** Nombre del campo que recibe cada argumento del servicio, cuando no se llama igual que el parámetro. */
  const renamed: Record<string, string> = { 'cooking.recordEvents:id': 'sessionId', 'cooking.complete:id': 'sessionId', 'cooking.abandon:id': 'sessionId' };
  const paramsOf = (fn: (...a: never[]) => unknown) =>
    /\(([^)]*)\)/
      .exec(fn.toString())![1]!
      .split(',')
      .map((p) => p.split('=')[0]!.trim())
      .filter(Boolean);

  it('cada comando llama a su servicio con los argumentos en su lugar', () => {
    const calls: { service: string; method: string; args: unknown[] }[] = [];
    const services = Object.fromEntries(
      Object.keys(classes).map((service) => [service, new Proxy({ service }, { get: (t, method) => (method === 'service' ? t.service : (...args: unknown[]) => void calls.push({ service, method: String(method), args })) })]),
    ) as unknown as CommandServices;
    const handlers = createCommandHandlers(services) as unknown as Record<string, (c: unknown) => unknown>;
    // Cada campo del payload vale su propio nombre: así se ve a qué parámetro llegó.
    const echo = new Proxy({}, { get: (_, key) => String(key) });

    const types = Object.keys(handlers);
    for (const type of types) {
      handlers[type]!(echo);
      const { service, method, args } = calls.pop()!;
      const real = (classes[service as keyof CommandServices].prototype as Record<string, (...a: never[]) => unknown>)[method];
      expect(real, `${type} → ${service}.${method}`).toBeTypeOf('function');
      const params = paramsOf(real!);
      expect(args.length, type).toBe(params.length);
      args.forEach((arg, i) => {
        // Los que pone el handler (opciones fijas, otro servicio) no vienen del payload.
        if (typeof arg === 'string') expect(arg, `${type}, argumento ${i}`).toBe(renamed[`${type}:${params[i]}`] ?? params[i]);
      });
    }
    expect(types.length).toBe(60);
  });

  it('toda ruta que escribe pasa por el bus', () => {
    // POST que solo calculan.
    const queries = new Set(['onboarding.preview', 'recipes.estimate']);
    const root = path.resolve('src/modules');
    const direct: string[] = [];
    for (const module of readdirSync(root)) {
      let routes: string;
      let controller: string;
      try {
        routes = readFileSync(path.join(root, module, 'http', `${module}.routes.ts`), 'utf8');
        controller = readFileSync(path.join(root, module, 'http', `${module}.controller.ts`), 'utf8');
      } catch {
        continue;
      }
      for (const [, method] of routes.matchAll(/r\.(?:post|put|patch|delete)\([\s\S]*?=>\s*c\.(\w+)\(/g)) {
        const start = controller.indexOf(`  ${method} = async`);
        const body = controller.slice(start, controller.indexOf('\n\n', start) === -1 ? undefined : controller.indexOf('\n\n', start));
        if (!queries.has(`${module}.${method}`) && !body.includes('this.c.commands.execute(')) direct.push(`${module}.${method}`);
      }
    }
    expect(direct).toEqual([]);
  });
});
