# 02 · Event driven y buses

Los módulos no se llaman entre sí para lo derivado: uno emite un hecho (`comment.created`) y otros reaccionan. Quien emite no conoce a quien escucha.

**Regla:** lo que la respuesta HTTP necesita se hace síncrono, dentro de la transacción. Lo derivado va por eventos.

## Los dos caminos

| | Comando | Evento |
| --- | --- | --- |
| Qué es | Una orden: «comenta esta receta» | Un hecho: «se comentó esta receta» |
| Destinatarios | Uno | Cero o varios |
| Puede rechazarse | Sí | No: ya ocurrió |
| Camino | HTTP → controller → `CommandBus` → handler → service (síncrono) | outbox → RabbitMQ → Subject → observers (asíncrono) |
| Bus | **`CommandBus`** | **`EventTransport`** (RabbitMQ o en proceso) |

## Bus de comandos

`CommandBus` es el único camino por el que HTTP cambia el estado. Un comando tiene **exactamente un** handler.

```
 route → controller ──execute('community.addComment', {…})──► CommandBus
                                                                │ middlewares (log)
                                                                ▼
                                                     handler del módulo (commands/)
                                                                ▼
                                                     service: transacción + outbox
                                                                │
                                                                ▼
                                                     resultado → respuesta HTTP
```

- **Síncrono y en proceso.** La respuesta HTTP necesita el resultado, así que los comandos no pasan por RabbitMQ; los eventos sí.
- **Tipado.** El nombre del comando determina su payload y su resultado.
- **Sin payload en el log:** puede traer contraseñas o archivos.
- **Las consultas (GET) no son comandos:** el controller llama al service.
- **Los observers** llaman a los services directamente: ya están dentro del procesamiento de un evento.

| Pieza | Archivo |
| --- | --- |
| Bus, middlewares, `mergeHandlers` | [`src/core/commands/command-bus.ts`](../src/core/commands/command-bus.ts) |
| Handlers | `src/modules/<módulo>/commands/<módulo>.commands.ts` |
| Registro de handlers | [`src/infrastructure/command-bus/register-handlers.ts`](../src/infrastructure/command-bus/register-handlers.ts) |
| Middleware de log | [`src/infrastructure/command-bus/logging.middleware.ts`](../src/infrastructure/command-bus/logging.middleware.ts) |
| Creación | [`src/container.ts`](../src/container.ts) |
| Pruebas | [`test/unit/command-bus.test.ts`](../test/unit/command-bus.test.ts) |

### El bus

📄 [`src/core/commands/command-bus.ts`](../src/core/commands/command-bus.ts#L1-L79) · líneas 1–79

```ts
/**
 * Un handler por comando: recibe el payload y devuelve el resultado (o lanza un error de aplicación).
 * El tipo `any` del parámetro es solo la cota: cada handler declara el suyo y `execute` lo exige.
 */
export type CommandHandler = (command: any) => unknown;
export type CommandHandlers = Record<string, CommandHandler>;

export type CommandPayload<H extends CommandHandler> = Parameters<H>[0];
export type CommandResult<H extends CommandHandler> = Awaited<ReturnType<H>>;

/** Tipo del argumento `I` de un método, para declarar payloads sin repetir el de los servicios. */
export type Arg<F extends (...args: any[]) => unknown, I extends number> = Parameters<F>[I];

/** Lo que ve un middleware. Nunca se registra el payload completo: puede traer contraseñas o archivos. */
export type CommandContext = { readonly type: string; readonly payload: unknown; readonly userId: string | null };
export type CommandMiddleware = (ctx: CommandContext, next: () => Promise<unknown>) => Promise<unknown>;

export class UnknownCommandError extends Error {
  constructor(readonly commandType: string) {
    super(`No hay handler para el comando ${commandType}`);
    this.name = 'UnknownCommandError';
  }
}

export class DuplicateCommandError extends Error {
  constructor(readonly commandType: string) {
    super(`El comando ${commandType} ya tiene handler`);
    this.name = 'DuplicateCommandError';
  }
}

/**
 * Bus de comandos: el único camino por el que HTTP cambia el estado.
 *
 * - Un comando tiene exactamente un handler. Un evento puede tener cero o varios observers.
 * - Es síncrono y en proceso: la respuesta HTTP necesita el resultado, así que no pasa por RabbitMQ.
 * - Los middlewares envuelven todos los comandos, en el orden en que se pasan (el primero es el de afuera).
 * - Los errores del handler salen tal cual: el contrato HTTP no cambia.
 */
export class CommandBus<H extends CommandHandlers> {
  private readonly handlers: ReadonlyMap<string, CommandHandler>;

  constructor(
    handlers: H,
    private readonly middlewares: readonly CommandMiddleware[] = [],
  ) {
    this.handlers = new Map(Object.entries(handlers));
  }

  get types(): string[] {
    return [...this.handlers.keys()];
  }

  async execute<T extends keyof H & string>(type: T, payload: CommandPayload<H[T]>): Promise<CommandResult<H[T]>> {
    const handler = this.handlers.get(type);
    if (!handler) throw new UnknownCommandError(type);
    const userId = (payload as { userId?: unknown } | undefined)?.userId;
    const ctx: CommandContext = { type, payload, userId: typeof userId === 'string' ? userId : null };
    const run = this.middlewares.reduceRight<() => Promise<unknown>>(
      (next, middleware) => () => middleware(ctx, next),
      async () => handler(payload),
    );
    return (await run()) as CommandResult<H[T]>;
  }
}

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;

/** Junta los handlers de los módulos. Dos handlers para el mismo comando es un error de arranque. */
export function mergeHandlers<T extends CommandHandlers[]>(...groups: T): UnionToIntersection<T[number]> {
  const all: CommandHandlers = {};
  for (const group of groups) {
    for (const [type, handler] of Object.entries(group)) {
      if (type in all) throw new DuplicateCommandError(type);
      all[type] = handler;
    }
  }
  return all as UnionToIntersection<T[number]>;
}
```


### Registro

📄 [`src/infrastructure/command-bus/register-handlers.ts`](../src/infrastructure/command-bus/register-handlers.ts#L1-L50) · líneas 1–50

```ts
import { mergeHandlers } from '../../core/commands/command-bus.js';
import { accountCommands } from '../../modules/account/index.js';
import { authCommands } from '../../modules/auth/index.js';
import { authoringCommands } from '../../modules/authoring/index.js';
import { chefCommands } from '../../modules/chef/index.js';
import { communityCommands } from '../../modules/community/index.js';
import { cookingCommands } from '../../modules/cooking/index.js';
import { homeCommands } from '../../modules/home/index.js';
import { mediaCommands } from '../../modules/media/index.js';
import { menusCommands } from '../../modules/menus/index.js';
import { onboardingCommands } from '../../modules/onboarding/index.js';
import { pantryCommands } from '../../modules/pantry/index.js';
import { receiptsCommands } from '../../modules/receipts/index.js';
import { recipesCommands } from '../../modules/recipes/index.js';
import { shoppingCommands } from '../../modules/shopping/index.js';

/** Servicios que usan los handlers de todos los módulos. */
export type CommandServices = Parameters<typeof accountCommands>[0] &
  Parameters<typeof authCommands>[0] &
  Parameters<typeof authoringCommands>[0] &
  Parameters<typeof chefCommands>[0] &
  Parameters<typeof communityCommands>[0] &
  Parameters<typeof cookingCommands>[0] &
  Parameters<typeof homeCommands>[0] &
  Parameters<typeof mediaCommands>[0] &
  Parameters<typeof menusCommands>[0] &
  Parameters<typeof onboardingCommands>[0] &
  Parameters<typeof pantryCommands>[0] &
  Parameters<typeof receiptsCommands>[0] &
  Parameters<typeof recipesCommands>[0] &
  Parameters<typeof shoppingCommands>[0];

/** Comandos del sistema (cada módulo los declara en `commands/<módulo>.commands.ts`). */
export const createCommandHandlers = (s: CommandServices) =>
  mergeHandlers(
    accountCommands(s),
    authCommands(s),
    authoringCommands(s),
    chefCommands(s),
    communityCommands(s),
    cookingCommands(s),
    homeCommands(s),
    mediaCommands(s),
    menusCommands(s),
    onboardingCommands(s),
    pantryCommands(s),
    receiptsCommands(s),
    recipesCommands(s),
    shoppingCommands(s),
  );
```


📄 [`src/container.ts`](../src/container.ts#L152-L153) · líneas 152–153

```ts
  // Comandos: HTTP → CommandBus → handler del módulo → servicio.
  const commands = new CommandBus(createCommandHandlers(services), [logCommands(log)]);
```


### Middleware

📄 [`src/infrastructure/command-bus/logging.middleware.ts`](../src/infrastructure/command-bus/logging.middleware.ts#L1-L20) · líneas 1–20

```ts
import type { FastifyBaseLogger } from 'fastify';
import type { CommandMiddleware } from '../../core/commands/command-bus.js';
import { AppError } from '../../core/shared/errors.js';

/** Deja en el log qué comando se ejecutó, de quién y cuánto tardó. Sin payload: puede traer datos sensibles. */
export const logCommands =
  (log: FastifyBaseLogger): CommandMiddleware =>
  async (ctx, next) => {
    const start = performance.now();
    const info = () => ({ command: ctx.type, userId: ctx.userId, ms: Math.round(performance.now() - start) });
    try {
      const result = await next();
      log.debug(info(), 'comando ejecutado');
      return result;
    } catch (err) {
      // Un rechazo de negocio (404, 409, 422) es normal; el error inesperado lo registra el manejador HTTP.
      log.debug({ ...info(), code: err instanceof AppError ? err.code : 'UNEXPECTED' }, 'comando rechazado');
      throw err;
    }
  };
```


### Un comando de punta a punta

Ruta:

📄 [`src/modules/community/http/community.routes.ts`](../src/modules/community/http/community.routes.ts#L16-L16) · líneas 16–16

```ts
  r.post('/community/recipes/:recipeId/comments', { preHandler: done, schema: { tags, summary: 'Comentar', params: RecipeIdParam, body: CommentBody } }, (req, rep) => c.addComment(req, rep));
```


Controller, que despacha:

📄 [`src/modules/community/http/community.controller.ts`](../src/modules/community/http/community.controller.ts#L18-L21) · líneas 18–21

```ts
  addComment = async (req: Req<{ Params: z.infer<typeof RecipeIdParam>; Body: z.infer<typeof CommentBody> }>, reply: Rep) => {
    reply.code(201);
    return ok(await this.c.commands.execute('community.addComment', { userId: req.user.id, recipeId: req.params.recipeId, text: req.body.text }));
  };
```


Handler:

📄 [`src/modules/community/commands/community.commands.ts`](../src/modules/community/commands/community.commands.ts#L1-L10) · líneas 1–10

```ts
import type { Arg } from '../../../core/commands/command-bus.js';
import type { CommunityService } from '../community.service.js';

/** Comandos del módulo community. Comentarios, denuncias y seguir. */
export const communityCommands = (s: { community: CommunityService }) => ({
  'community.addComment': (c: { userId: string; recipeId: string; text: string }) => s.community.addComment(c.userId, c.recipeId, c.text),
  'community.deleteComment': (c: { userId: string; commentId: string }) => s.community.deleteComment(c.userId, c.commentId),
  'community.report': (c: { userId: string; input: Arg<CommunityService['report'], 1> }) => s.community.report(c.userId, c.input),
  'community.setFollowing': (c: { userId: string; followeeId: string; following: boolean }) => s.community.setFollowing(c.userId, c.followeeId, c.following),
});
```


Service, que ejecuta el cambio y emite el evento:

📄 [`src/modules/community/community.service.ts`](../src/modules/community/community.service.ts#L164-L176) · líneas 164–176

```ts
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
```


Los reintentos del cliente se controlan con `Idempotency-Key`: [`src/infrastructure/http/middlewares/idempotency.middleware.ts`](../src/infrastructure/http/middlewares/idempotency.middleware.ts).

### Todos los comandos

| Comando | Service | Handler |
| --- | --- | --- |
| `account.verifyEmail` | `account.verifyEmail` | [`account.commands.ts`](../src/modules/account/commands/account.commands.ts) |
| `account.resendVerification` | `account.sendVerification` | [`account.commands.ts`](../src/modules/account/commands/account.commands.ts) |
| `account.updateSettings` | `account.updateSettings` | [`account.commands.ts`](../src/modules/account/commands/account.commands.ts) |
| `account.requestExport` | `account.requestExport` | [`account.commands.ts`](../src/modules/account/commands/account.commands.ts) |
| `account.delete` | `account.deleteAccount` | [`account.commands.ts`](../src/modules/account/commands/account.commands.ts) |
| `auth.register` | `auth.register` | [`auth.commands.ts`](../src/modules/auth/commands/auth.commands.ts) |
| `auth.login` | `auth.login` | [`auth.commands.ts`](../src/modules/auth/commands/auth.commands.ts) |
| `auth.oauthSignIn` | `auth.oauthSignIn` | [`auth.commands.ts`](../src/modules/auth/commands/auth.commands.ts) |
| `auth.logout` | `auth.logout` | [`auth.commands.ts`](../src/modules/auth/commands/auth.commands.ts) |
| `auth.changePassword` | `auth.changePassword` | [`auth.commands.ts`](../src/modules/auth/commands/auth.commands.ts) |
| `auth.refresh` | `auth.refresh` | [`auth.commands.ts`](../src/modules/auth/commands/auth.commands.ts) |
| `authoring.create` | `authoring.create` | [`authoring.commands.ts`](../src/modules/authoring/commands/authoring.commands.ts) |
| `authoring.patch` | `authoring.patch` | [`authoring.commands.ts`](../src/modules/authoring/commands/authoring.commands.ts) |
| `authoring.publish` | `authoring.publish` | [`authoring.commands.ts`](../src/modules/authoring/commands/authoring.commands.ts) |
| `authoring.unpublish` | `authoring.unpublish` | [`authoring.commands.ts`](../src/modules/authoring/commands/authoring.commands.ts) |
| `authoring.remove` | `authoring.remove` | [`authoring.commands.ts`](../src/modules/authoring/commands/authoring.commands.ts) |
| `chef.openRecipeThread` | `chef.openRecipeThread` | [`chef.commands.ts`](../src/modules/chef/commands/chef.commands.ts) |
| `chef.sendMessage` | `chef.send` | [`chef.commands.ts`](../src/modules/chef/commands/chef.commands.ts) |
| `chef.markRead` | `chef.markRead` | [`chef.commands.ts`](../src/modules/chef/commands/chef.commands.ts) |
| `chef.giveFeedback` | `chef.feedback` | [`chef.commands.ts`](../src/modules/chef/commands/chef.commands.ts) |
| `chef.voteInsight` | `insights.vote` | [`chef.commands.ts`](../src/modules/chef/commands/chef.commands.ts) |
| `community.addComment` | `community.addComment` | [`community.commands.ts`](../src/modules/community/commands/community.commands.ts) |
| `community.deleteComment` | `community.deleteComment` | [`community.commands.ts`](../src/modules/community/commands/community.commands.ts) |
| `community.report` | `community.report` | [`community.commands.ts`](../src/modules/community/commands/community.commands.ts) |
| `community.setFollowing` | `community.setFollowing` | [`community.commands.ts`](../src/modules/community/commands/community.commands.ts) |
| `cooking.start` | `cooking.start` | [`cooking.commands.ts`](../src/modules/cooking/commands/cooking.commands.ts) |
| `cooking.recordEvents` | `cooking.recordEvents` | [`cooking.commands.ts`](../src/modules/cooking/commands/cooking.commands.ts) |
| `cooking.complete` | `cooking.complete` | [`cooking.commands.ts`](../src/modules/cooking/commands/cooking.commands.ts) |
| `cooking.abandon` | `cooking.abandon` | [`cooking.commands.ts`](../src/modules/cooking/commands/cooking.commands.ts) |
| `home.logMeal` | `days.log` | [`home.commands.ts`](../src/modules/home/commands/home.commands.ts) |
| `home.deleteMeal` | `days.remove` | [`home.commands.ts`](../src/modules/home/commands/home.commands.ts) |
| `home.dismissNudge` | `nudges.dismiss` | [`home.commands.ts`](../src/modules/home/commands/home.commands.ts) |
| `media.requestUpload` | `media.requestUpload` | [`media.commands.ts`](../src/modules/media/commands/media.commands.ts) |
| `media.receiveUpload` | `media.receiveUpload` | [`media.commands.ts`](../src/modules/media/commands/media.commands.ts) |
| `menus.retry` | `menus.retry` | [`menus.commands.ts`](../src/modules/menus/commands/menus.commands.ts) |
| `menus.regenerate` | `menus.regenerate` | [`menus.commands.ts`](../src/modules/menus/commands/menus.commands.ts) |
| `menus.addEntry` | `menus.addEntry` | [`menus.commands.ts`](../src/modules/menus/commands/menus.commands.ts) |
| `menus.patchEntry` | `menus.patchEntry` | [`menus.commands.ts`](../src/modules/menus/commands/menus.commands.ts) |
| `menus.removeEntry` | `menus.removeEntry` | [`menus.commands.ts`](../src/modules/menus/commands/menus.commands.ts) |
| `menus.toShoppingList` | `menus.toShoppingList` | [`menus.commands.ts`](../src/modules/menus/commands/menus.commands.ts) |
| `onboarding.saveDraft` | `onboarding.saveDraft` | [`onboarding.commands.ts`](../src/modules/onboarding/commands/onboarding.commands.ts) |
| `onboarding.complete` | `onboarding.complete` | [`onboarding.commands.ts`](../src/modules/onboarding/commands/onboarding.commands.ts) |
| `onboarding.patchPreferences` | `preferences.patch` | [`onboarding.commands.ts`](../src/modules/onboarding/commands/onboarding.commands.ts) |
| `pantry.add` | `pantry.add` | [`pantry.commands.ts`](../src/modules/pantry/commands/pantry.commands.ts) |
| `pantry.patch` | `pantry.patch` | [`pantry.commands.ts`](../src/modules/pantry/commands/pantry.commands.ts) |
| `pantry.remove` | `pantry.remove` | [`pantry.commands.ts`](../src/modules/pantry/commands/pantry.commands.ts) |
| `pantry.bulkSetup` | `pantrySetup.bulk` | [`pantry.commands.ts`](../src/modules/pantry/commands/pantry.commands.ts) |
| `receipts.upload` | `receipts.upload` | [`receipts.commands.ts`](../src/modules/receipts/commands/receipts.commands.ts) |
| `receipts.reviewItem` | `receipts.reviewItem` | [`receipts.commands.ts`](../src/modules/receipts/commands/receipts.commands.ts) |
| `recipes.applyProposal` | `recipes.applyProposal` | [`recipes.commands.ts`](../src/modules/recipes/commands/recipes.commands.ts) |
| `recipes.setSaved` | `recipes.setSaved` | [`recipes.commands.ts`](../src/modules/recipes/commands/recipes.commands.ts) |
| `recipes.setLiked` | `recipes.setLiked` | [`recipes.commands.ts`](../src/modules/recipes/commands/recipes.commands.ts) |
| `shopping.patchItem` | `shopping.patchItem` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.removeItem` | `shopping.removeItem` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.removeRecipe` | `shopping.removeRecipe` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.swap` | `shopping.swap` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.addItems` | `shopping.addItems` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.addRecipe` | `shopping.addRecipe` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.share` | `shopping.share` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |
| `shopping.checkout` | `shopping.checkout` | [`shopping.commands.ts`](../src/modules/shopping/commands/shopping.commands.ts) |

### Agregar un comando

1. Escribir el método en el service del módulo.
2. Agregar `'<módulo>.<verbo>'` en `commands/<módulo>.commands.ts`.
3. Despacharlo desde el controller con `this.c.commands.execute(…)`.

Una prueba falla si una ruta que escribe no pasa por el bus o si un handler pasa un argumento en el lugar equivocado.

## Bus de eventos

### El puerto

El relay entrega a un `EventDispatcher`; el resto del sistema solo conoce `EventTransport`.

📄 [`src/core/events/transport.ts`](../src/core/events/transport.ts#L4-L7) · líneas 4–7

```ts
/** A dónde entrega el relay del outbox cada evento. */
export interface EventDispatcher {
  dispatch(event: DomainEvent): Promise<void>;
}
```

📄 [`src/core/events/transport.ts`](../src/core/events/transport.ts#L9-L23) · líneas 9–23

```ts
/**
 * Transporte de eventos entre el outbox y los observers. Lo crea `EventTransportFactory`.
 * - `dispatcher`: lo usa el relay (en RabbitMQ: publicar al exchange).
 * - `startConsuming`: empieza a entregar a los observers (en RabbitMQ: consumir la cola).
 * - `settle`: espera a que no quede nada en vuelo; devuelve cuántos eventos entregó mientras tanto (tests y apagado).
 */
export interface EventTransport {
  readonly kind: 'rabbitmq' | 'in-process';
  readonly dispatcher: EventDispatcher;
  startConsuming(): Promise<void>;
  stopConsuming(): Promise<void>;
  settle(timeoutMs?: number): Promise<number>;
  healthy(): boolean;
  close(): Promise<void>;
}
```


Dos implementaciones, elegidas por [`EventTransportFactory`](05-gof-factory.md#2-eventtransportfactory):

| Implementación | Archivo | Cuándo |
| --- | --- | --- |
| `RabbitMqTransport` | [`src/infrastructure/event-bus/rabbitmq/rabbitmq.transport.ts`](../src/infrastructure/event-bus/rabbitmq/rabbitmq.transport.ts) | Hay `RABBITMQ_URL` |
| `InProcessTransport` | [`src/core/events/transport.ts`](../src/core/events/transport.ts) | Sin broker: pruebas o una sola máquina |

📄 [`src/core/events/transport.ts`](../src/core/events/transport.ts#L25-L46) · líneas 25–46

```ts
/**
 * Sin broker: el relay notifica directamente a los Subjects de este proceso.
 * Sirve para tests y para correr todo en una sola máquina sin RabbitMQ.
 */
export class InProcessTransport implements EventTransport {
  readonly kind = 'in-process' as const;
  readonly dispatcher: EventDispatcher;

  constructor(subjects: SubjectRegistry) {
    this.dispatcher = { dispatch: (e) => subjects.dispatch(e) };
  }

  async startConsuming() {}
  async stopConsuming() {}
  async settle() {
    return 0;
  }
  healthy() {
    return true;
  }
  async close() {}
}
```


### Salida del bus: de un evento a los observers

`SubjectRegistry.dispatch` es el punto por el que pasa todo evento antes de llegar a un observer, venga de RabbitMQ o del transporte en proceso.

📄 [`src/core/events/subject.ts`](../src/core/events/subject.ts#L119-L135) · líneas 119–135

```ts
  subjectFor(streamId: string): EventSubject {
    let subject = this.subjects.get(streamId);
    if (subject) {
      // LRU: lo movemos al final.
      this.subjects.delete(streamId);
      this.subjects.set(streamId, subject);
      return subject;
    }
    subject = new EventSubject(streamId, this.ledger, this.log, this.beforeNotify);
    for (const o of this.systemObservers) subject.attach(o);
    this.subjects.set(streamId, subject);
    this.evictIdle();
    return subject;
  }

  dispatch(event: DomainEvent): Promise<void> {
    return this.subjectFor(event.streamId).notify(event);
```


Detalle en [04 · GoF Observer](04-gof-observer.md).

## El sistema de eventos

`EventSystem` une outbox, relay, transporte y Subjects.

📄 [`src/core/events/system.ts`](../src/core/events/system.ts#L12-L70) · líneas 12–70

```ts
/**
 * Todo el sistema de eventos en un objeto:
 *
 *   caso de uso ─tx─▶ Outbox.record ─▶ event_store + outbox (misma transacción)
 *   OutboxRelay ─▶ transport.dispatcher (RabbitMQ: exchange noshy.events)
 *   transport consumer ─▶ SubjectRegistry ─▶ Subject del usuario ─▶ Observers
 */
export class EventSystem {
  constructor(
    readonly db: Db,
    readonly factory: DomainEventFactory,
    readonly store: EventStore,
    readonly outbox: Outbox,
    readonly relay: OutboxRelay,
    readonly subjects: SubjectRegistry,
    readonly transport: EventTransport,
    private readonly log: FastifyBaseLogger,
  ) {
    outbox.onKick(() => {
      if (relay.started) relay.kick();
    });
  }

  attach(observers: readonly Observer[]) {
    for (const o of observers) this.subjects.attach(o);
  }

  /** Arranca el relay (publicar) y/o el consumer (procesar) en este proceso. */
  async start(roles: EventRoles, pollMs: number) {
    if (roles.consumer) await this.transport.startConsuming();
    if (roles.relay) this.relay.start(pollMs);
    this.log.info({ transport: this.transport.kind, ...roles }, 'eventos: en marcha');
  }

  /**
   * Entrega todo lo pendiente y espera a que los observers terminen, incluidos los eventos que ellos mismos
   * emiten. En producción esto pasa solo; aquí lo usan los tests y el apagado ordenado.
   */
  async drain(): Promise<number> {
    let total = 0;
    for (let i = 0; i < 50; i++) {
      const published = await this.relay.drain();
      const consumed = await this.transport.settle();
      total += published;
      if (published === 0 && consumed === 0) break;
    }
    return total;
  }

  async stop() {
    this.relay.stop();
    await this.transport.stopConsuming();
  }

  async close() {
    this.relay.stop();
    await this.transport.close();
  }
}
```


Composición:

📄 [`src/container.ts`](../src/container.ts#L45-L52) · líneas 45–52

```ts
  // Eventos: Factory → Event Store + Outbox → Relay → Transporte (RabbitMQ) → Subjects → Observers.
  const eventFactory = new DomainEventFactory();
  const eventStore = new PostgresEventStore(db, eventFactory);
  const outbox = new Outbox(db, eventStore, eventFactory);
  const subjects = new SubjectRegistry(new ProcessedEventsLedger(db), log, undefined, () => catalog.sync());
  const transport = await new EventTransportFactory(env, log).create({ subjects, factory: eventFactory });
  const relay = new OutboxRelay(db, eventFactory, transport.dispatcher, log, { maxAttempts: env.OUTBOX_MAX_ATTEMPTS });
  const events = new EventSystem(db, eventFactory, eventStore, outbox, relay, subjects, transport, log);
```


## Procesos

| | API | Worker |
| --- | --- | --- |
| HTTP | Sí | No |
| Relay (publica) | Sí, con RabbitMQ | Sí |
| Consumer y observers | Solo con `RUN_WORKERS=true` | Sí |
| Scheduler | Solo con `RUN_WORKERS=true` | Sí |

API:

📄 [`src/entrypoints/api.ts`](../src/entrypoints/api.ts#L27-L30) · líneas 27–30

```ts
// La API siempre publica lo que escribe en el outbox cuando hay RabbitMQ (latencia mínima).
// Con RUN_WORKERS=true además consume y corre el scheduler (todo en un proceso).
await events.start({ relay: events.transport.kind === 'rabbitmq' || env.RUN_WORKERS, consumer: env.RUN_WORKERS }, env.OUTBOX_POLL_MS);
if (env.RUN_WORKERS) scheduler.start();
```


La API conecta los observers al construir la app:

📄 [`src/infrastructure/http/server.ts`](../src/infrastructure/http/server.ts#L36-L39) · líneas 36–39

```ts
  const container = await createContainer(env, app.log, providers);
  app.decorate('container', container);
  container.events.attach(createObservers(container));
  app.addHook('onClose', async () => container.close());
```


Worker:

📄 [`src/entrypoints/worker.ts`](../src/entrypoints/worker.ts#L7-L21) · líneas 7–21

```ts
/**
 * Proceso de workers, separado del HTTP:
 *   - consume `noshy.events.observers` y notifica al Subject de cada usuario (observers);
 *   - corre el relay del outbox (respaldo de la API: si la API se cae tras escribir, aquí se publica);
 *   - corre las tareas programadas.
 * Con RUN_WORKERS=false en las instancias HTTP, cada parte escala por separado.
 */
const env = loadEnv();
const log = pino({ level: env.LOG_LEVEL });
const container = await createContainer(env, log);
container.events.attach(createObservers(container));
const scheduler = new Scheduler(container);
await container.events.start({ relay: true, consumer: true }, env.OUTBOX_POLL_MS);
scheduler.start();
log.info({ transport: container.events.transport.kind }, 'worker listo: consumer + outbox relay + scheduler');
```


## El evento

📄 [`src/core/events/domain-event.ts`](../src/core/events/domain-event.ts#L1-L35) · líneas 1–35

```ts
import type { EventPayloads, EventType } from './catalog.js';

/**
 * Evento de dominio ya construido. Es inmutable: el `DomainEventFactory` lo congela.
 *
 * - `streamId`: el stream del event store al que pertenece. Todo evento es de un usuario, así que
 *   el stream es su `userId` (o `system` para los pocos que no tienen dueño).
 * - `version`: posición dentro de su stream (1, 2, 3…). Es 0 hasta que el event store lo guarda.
 */
export type DomainEvent<T extends EventType = EventType> = {
  readonly id: string;
  readonly type: T;
  readonly streamId: string;
  readonly version: number;
  readonly userId: string | null;
  readonly occurredAt: Date;
  readonly payload: Readonly<EventPayloads[T]>;
};

/** Evento tal como sale del event store: incluye su posición global (orden total de escritura). */
export type StoredEvent<T extends EventType = EventType> = DomainEvent<T> & { readonly position: number };

/** Forma del evento en el cable (cuerpo del mensaje de RabbitMQ). */
export type EventEnvelope = {
  schema: 'noshy.event/v1';
  eventId: string;
  type: string;
  streamId: string;
  version: number;
  userId: string | null;
  occurredAt: string;
  payload: unknown;
};

export const SYSTEM_STREAM = 'system';
```


## Catálogo

`EventPayloads` es el contrato. `EVENT_TYPES` existe en tiempo de ejecución y un tipo olvidado ahí no compila.

📄 [`src/core/events/catalog.ts`](../src/core/events/catalog.ts#L1-L67) · líneas 1–67

```ts
/**
 * Catálogo de eventos de dominio. Es el contrato entre módulos: quien emite no conoce a quien escucha.
 * Convención: `<agregado>.<hecho en pasado>`. Los payloads llevan IDs, no objetos completos.
 */
export type EventPayloads = {
  'user.registered': { userId: string; method: 'password' | 'google' | 'apple' };
  'user.email_verification_requested': { userId: string; verificationId: string };
  'user.email_verified': { userId: string };
  'user.settings_updated': { userId: string; sections: string[] };
  'user.deleted': { userId: string; storageKeys: string[] };
  'data_export.requested': { userId: string; exportId: string };
  'onboarding.completed': { userId: string; menuId: string; skippedSteps: string[] };
  'preferences.updated': { userId: string; sections: string[]; targetsRecalculated: boolean };

  'pantry.items_added': { userId: string; itemIds: string[]; ingredientIds: string[]; source: string };
  'pantry.item_updated': { userId: string; itemId: string; ingredientId: string };
  'pantry.item_removed': { userId: string; itemId: string; ingredientId: string; addToShoppingList: boolean };
  'pantry.items_consumed': { userId: string; sessionId: string; updates: { itemId: string; ingredientId: string; remainingPct: number; removed: boolean }[] };

  'receipt.uploaded': { userId: string; receiptId: string };
  'receipt.parsed': { userId: string; receiptId: string; storeId: string | null; purchasedAt: string | null; ingredientIds: string[]; brands: string[] };
  'receipt.failed': { userId: string; receiptId: string; reason: string };
  'receipt.item_reviewed': { userId: string; receiptId: string; itemId: string; addToPantry: boolean };

  'menu.generated': { userId: string; menuId: string; weekStart: string; recipeIds: string[] };
  'menu.entry_added': { userId: string; menuId: string; entryId: string; recipeId: string; servings: number };
  'menu.entry_changed': { userId: string; menuId: string; entryId: string; fromRecipeId: string; toRecipeId: string; servings: number };
  'menu.entry_removed': { userId: string; menuId: string; entryId: string; recipeId: string };

  'shopping.list_created': { userId: string; listId: string; weekStart: string };
  'shopping.item_checked': { userId: string; listId: string; itemId: string; checked: boolean };
  'shopping.item_swapped': { userId: string; listId: string; itemId: string; productId: string; brand: string; savings: number };
  'shopping.checked_out': { userId: string; listId: string; storeId: string; pantryItemIds: string[]; spent: number };

  'meal.logged': { userId: string; mealId: string; localDate: string; slot: string; recipeId: string | null; source: 'manual' | 'cooking' };
  'meal.deleted': { userId: string; mealId: string; localDate: string };

  'cooking.started': { userId: string; sessionId: string; recipeId: string };
  'cooking.events_recorded': { userId: string; sessionId: string; timerExtensions: { stepIndex: number; addedSeconds: number }[] };
  'cooking.completed': {
    userId: string;
    sessionId: string;
    recipeId: string;
    rating: number | null;
    localDate: string;
    weekday: number;
    slot: string | null;
    tags: string[];
  };
  'cooking.abandoned': { userId: string; sessionId: string; recipeId: string; atStepIndex: number; reason: string | null };

  'recipe.saved': { userId: string; recipeId: string; saved: boolean };
  'recipe.liked': { userId: string; recipeId: string; liked: boolean };
  'recipe.adapted': { userId: string; recipeId: string; adaptationId: string; source: 'auto' | 'proposal' };
  'recipe.publish_requested': { userId: string; recipeId: string };
  'recipe.published': { userId: string; recipeId: string };
  'recipe.rejected': { userId: string; recipeId: string; reason: string };
  'comment.created': { userId: string; recipeId: string; commentId: string; recipeAuthorId: string | null };
  'user.followed': { userId: string; followeeId: string; following: boolean };

  'chef.message_sent': { userId: string; threadId: string; messageId: string; inputType: string };
  'chef.feedback_given': { userId: string; messageId: string; blockId: string; rating: 'up' | 'down'; recipeId: string | null };
  'insight.voted': { userId: string; insightId: string; vote: 'up' | 'down' };
  'nudge.dismissed': { userId: string; nudgeId: string; kind: string; reason: 'dismissed' | 'acted' };
};

export type EventType = keyof EventPayloads;
```

📄 [`src/core/events/catalog.ts`](../src/core/events/catalog.ts#L119-L121) · líneas 119–121

```ts
type MissingInList = Exclude<EventType, (typeof EVENT_TYPES)[number]>;
const _everyTypeListed: MissingInList extends never ? true : MissingInList = true;
void _everyTypeListed;
```


## Mapa de eventos

| Evento | Lo emite | Observers que reaccionan |
| --- | --- | --- |
| `user.registered` | [`auth.service.ts`](../src/modules/auth/auth.service.ts) | [`account`](../src/modules/account/events/account.observers.ts) |
| `user.email_verification_requested` | [`account.service.ts`](../src/modules/account/account.service.ts) | — (queda en el historial) |
| `user.email_verified` | [`account.service.ts`](../src/modules/account/account.service.ts) | — (queda en el historial) |
| `user.settings_updated` | [`account.service.ts`](../src/modules/account/account.service.ts) | — (queda en el historial) |
| `user.deleted` | [`account.service.ts`](../src/modules/account/account.service.ts) | [`account`](../src/modules/account/events/account.observers.ts) |
| `data_export.requested` | [`account.service.ts`](../src/modules/account/account.service.ts) | [`account`](../src/modules/account/events/account.observers.ts) |
| `onboarding.completed` | [`onboarding.service.ts`](../src/modules/onboarding/onboarding.service.ts) | [`menus`](../src/modules/menus/events/menus.observers.ts) |
| `preferences.updated` | [`preferences.service.ts`](../src/modules/onboarding/preferences.service.ts) | — (queda en el historial) |
| `pantry.items_added` | [`pantry-setup.service.ts`](../src/modules/pantry/pantry-setup.service.ts), [`pantry.service.ts`](../src/modules/pantry/pantry.service.ts) | [`nudges`](../src/modules/home/events/nudges.observers.ts) |
| `pantry.item_updated` | [`pantry.service.ts`](../src/modules/pantry/pantry.service.ts) | [`nudges`](../src/modules/home/events/nudges.observers.ts) |
| `pantry.item_removed` | [`pantry.service.ts`](../src/modules/pantry/pantry.service.ts) | [`nudges`](../src/modules/home/events/nudges.observers.ts), [`shopping`](../src/modules/shopping/events/shopping.observers.ts) |
| `pantry.items_consumed` | [`pantry.service.ts`](../src/modules/pantry/pantry.service.ts) | [`nudges`](../src/modules/home/events/nudges.observers.ts) |
| `receipt.uploaded` | [`receipts.service.ts`](../src/modules/receipts/receipts.service.ts) | [`receipts`](../src/modules/receipts/events/receipts.observers.ts) |
| `receipt.parsed` | [`receipts.service.ts`](../src/modules/receipts/receipts.service.ts) | [`chef`](../src/modules/chef/events/chef.observers.ts), [`learning`](../src/modules/chef/events/learning.observers.ts), [`notifications`](../src/modules/notifications/events/notifications.observers.ts) |
| `receipt.failed` | [`receipts.service.ts`](../src/modules/receipts/receipts.service.ts) | — (queda en el historial) |
| `receipt.item_reviewed` | [`receipts.service.ts`](../src/modules/receipts/receipts.service.ts) | — (queda en el historial) |
| `menu.generated` | [`menus.service.ts`](../src/modules/menus/menus.service.ts) | [`notifications`](../src/modules/notifications/events/notifications.observers.ts), [`shopping`](../src/modules/shopping/events/shopping.observers.ts) |
| `menu.entry_added` | [`menus.service.ts`](../src/modules/menus/menus.service.ts) | [`shopping`](../src/modules/shopping/events/shopping.observers.ts) |
| `menu.entry_changed` | [`menus.service.ts`](../src/modules/menus/menus.service.ts) | [`shopping`](../src/modules/shopping/events/shopping.observers.ts) |
| `menu.entry_removed` | [`menus.service.ts`](../src/modules/menus/menus.service.ts) | [`shopping`](../src/modules/shopping/events/shopping.observers.ts) |
| `shopping.list_created` | [`shopping.service.ts`](../src/modules/shopping/shopping.service.ts) | — (queda en el historial) |
| `shopping.item_checked` | [`shopping.service.ts`](../src/modules/shopping/shopping.service.ts) | — (queda en el historial) |
| `shopping.item_swapped` | [`shopping.service.ts`](../src/modules/shopping/shopping.service.ts) | [`learning`](../src/modules/chef/events/learning.observers.ts) |
| `shopping.checked_out` | [`shopping.service.ts`](../src/modules/shopping/shopping.service.ts) | — (queda en el historial) |
| `meal.logged` | [`days.service.ts`](../src/modules/home/days.service.ts) | [`learning`](../src/modules/chef/events/learning.observers.ts) |
| `meal.deleted` | [`days.service.ts`](../src/modules/home/days.service.ts) | — (queda en el historial) |
| `cooking.started` | [`cooking.service.ts`](../src/modules/cooking/cooking.service.ts) | — (queda en el historial) |
| `cooking.events_recorded` | [`cooking.service.ts`](../src/modules/cooking/cooking.service.ts) | [`learning`](../src/modules/chef/events/learning.observers.ts) |
| `cooking.completed` | [`cooking.service.ts`](../src/modules/cooking/cooking.service.ts) | [`learning`](../src/modules/chef/events/learning.observers.ts), [`nudges`](../src/modules/home/events/nudges.observers.ts) |
| `cooking.abandoned` | [`scheduler.ts`](../src/infrastructure/workers/scheduler.ts), [`cooking.service.ts`](../src/modules/cooking/cooking.service.ts) | — (queda en el historial) |
| `recipe.saved` | [`recipes.service.ts`](../src/modules/recipes/recipes.service.ts) | — (queda en el historial) |
| `recipe.liked` | [`recipes.service.ts`](../src/modules/recipes/recipes.service.ts) | [`learning`](../src/modules/chef/events/learning.observers.ts) |
| `recipe.adapted` | [`recipes.service.ts`](../src/modules/recipes/recipes.service.ts) | — (queda en el historial) |
| `recipe.publish_requested` | [`authoring.service.ts`](../src/modules/authoring/authoring.service.ts) | [`community`](../src/modules/community/events/community.observers.ts) |
| `recipe.published` | [`authoring.service.ts`](../src/modules/authoring/authoring.service.ts) | [`notifications`](../src/modules/notifications/events/notifications.observers.ts) |
| `recipe.rejected` | [`authoring.service.ts`](../src/modules/authoring/authoring.service.ts) | [`notifications`](../src/modules/notifications/events/notifications.observers.ts) |
| `comment.created` | [`community.service.ts`](../src/modules/community/community.service.ts) | [`notifications`](../src/modules/notifications/events/notifications.observers.ts) |
| `user.followed` | [`community.service.ts`](../src/modules/community/community.service.ts) | — (queda en el historial) |
| `chef.message_sent` | [`chef.service.ts`](../src/modules/chef/chef.service.ts) | — (queda en el historial) |
| `chef.feedback_given` | [`chef.service.ts`](../src/modules/chef/chef.service.ts) | [`learning`](../src/modules/chef/events/learning.observers.ts) |
| `insight.voted` | [`insights.service.ts`](../src/modules/chef/insights.service.ts) | — (queda en el historial) |
| `nudge.dismissed` | [`nudges.service.ts`](../src/modules/home/nudges.service.ts) | — (queda en el historial) |

## Replay

Las proyecciones (`replayable`) se reconstruyen desde el historial, sin RabbitMQ ni ledger.

```bash
pnpm events:replay -- --observer learning --reset
pnpm events:replay -- --observer learning --stream <userId> --reset
```

📄 [`src/core/events/replay.ts`](../src/core/events/replay.ts#L7-L37) · líneas 7–37

```ts
/**
 * Event Sourcing: reconstruye proyecciones reproduciendo el historial del event store, en el orden en que
 * se escribió. Llama a los observers directamente (sin RabbitMQ ni ledger): es una reconstrucción, no una entrega.
 * Con `reset` borra antes la proyección (de un usuario o de todos).
 */
export async function replayEvents(store: EventStore, observers: readonly ReplayableObserver[], opts: ReplayOptions = {}): Promise<number> {
  if (opts.reset) for (const o of observers) await o.reset(opts.streamId);
  const types = EVENT_TYPES.filter((t) => observers.some((o) => o.interestedIn(t)));
  let count = 0;

  const apply = async (events: Awaited<ReturnType<EventStore['readAll']>>) => {
    for (const e of events) {
      for (const o of observers) if (o.interestedIn(e.type)) await o.update(e);
      count++;
    }
    opts.onProgress?.(count);
  };

  if (opts.streamId) {
    await apply(await store.readStream(opts.streamId));
    return count;
  }
  let after = 0;
  for (;;) {
    const batch = await store.readAll({ afterPosition: after, limit: opts.batchSize ?? 500, ...(types.length ? { types } : {}) });
    if (batch.length === 0) break;
    await apply(batch);
    after = batch[batch.length - 1]!.position;
  }
  return count;
}
```
