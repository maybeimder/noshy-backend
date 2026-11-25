# 04 · GoF Observer

Un objeto (**Subject**) avisa a sus dependientes (**Observers**) cuando algo pasa, sin conocer sus clases concretas.

| Rol del patrón | En el código | Archivo |
| --- | --- | --- |
| Observer | `interface Observer` | [`src/core/events/observer.ts`](../src/core/events/observer.ts) |
| Observer base | `abstract class EventObserver` | [`src/core/events/observer.ts`](../src/core/events/observer.ts) |
| Subject (`attach`, `detach`, `notify`) | `EventSubject`, uno por usuario | [`src/core/events/subject.ts`](../src/core/events/subject.ts) |
| Creación y búsqueda de Subjects | `SubjectRegistry` | [`src/core/events/subject.ts`](../src/core/events/subject.ts) |
| ConcreteObserver | `AccountObserver`, `MenusObserver`… | `src/modules/<módulo>/events/` |
| Cliente que los conecta | `createObservers` + `EventSystem.attach` | [`src/infrastructure/event-bus/register-observers.ts`](../src/infrastructure/event-bus/register-observers.ts) |

```
                 attach(observer)                  notify(event)
 createObservers ───────────────► SubjectRegistry ◄─────────────── RabbitMqEventConsumer / InProcessTransport
                                       │ subjectFor(streamId)
                                       ▼
                                  EventSubject (usuario)
                                       │ update(event), en orden
              ┌────────────────┬───────┴────────┬─────────────────┐
              ▼                ▼                ▼                 ▼
       ShoppingObserver  NudgesObserver  LearningObserver  NotificationsObserver …
```

## 1. Observer

📄 [`src/core/events/observer.ts`](../src/core/events/observer.ts#L4-L12) · líneas 4–12

```ts
/**
 * GoF Observer: reacciona a lo que pasa en el Subject (el stream de un usuario).
 * `name` es estable y único: con él se registra qué eventos ya procesó (idempotencia).
 */
export interface Observer {
  readonly name: string;
  interestedIn(type: EventType): boolean;
  update(event: DomainEvent): Promise<void>;
}
```


Observer que además es una proyección reconstruible:

📄 [`src/core/events/observer.ts`](../src/core/events/observer.ts#L14-L23) · líneas 14–23

```ts
/**
 * Observer que es una proyección reconstruible: se puede borrar su estado y volver a llenarlo
 * reproduciendo el event store (`pnpm events:replay`). Los que tienen efectos externos
 * (push, emails, moderación) no lo son.
 */
export interface ReplayableObserver extends Observer {
  readonly replayable: true;
  /** Borra la proyección de un usuario o, sin `streamId`, la de todos. */
  reset(streamId?: string): Promise<void>;
}
```


Clase base: cada subclase declara en su constructor a qué eventos reacciona.

📄 [`src/core/events/observer.ts`](../src/core/events/observer.ts#L27-L60) · líneas 27–60

```ts
type Handler<T extends EventType> = (event: DomainEvent<T>) => Promise<void>;

/**
 * Base de los observers concretos: cada subclase declara en su constructor a qué eventos reacciona
 * con `this.on(tipo, handler)`. `update` despacha al handler del tipo; los demás eventos se ignoran.
 */
export abstract class EventObserver implements Observer {
  abstract readonly name: string;
  private readonly handlers = new Map<EventType, Handler<EventType>>();

  protected on<T extends EventType>(type: T, handler: Handler<T>): this {
    if (this.handlers.has(type)) throw new Error(`${this.constructor.name} ya tiene un handler para ${type}`);
    this.handlers.set(type, handler as unknown as Handler<EventType>);
    return this;
  }

  /** Mismo handler para varios tipos. */
  protected onEach(types: readonly EventType[], handler: Handler<EventType>): this {
    for (const t of types) this.on(t, handler);
    return this;
  }

  interestedIn(type: EventType): boolean {
    return this.handlers.has(type);
  }

  get interests(): EventType[] {
    return [...this.handlers.keys()];
  }

  async update(event: DomainEvent): Promise<void> {
    await this.handlers.get(event.type)?.(event);
  }
}
```


## 2. Subject

Uno por usuario. Serializa sus notificaciones, avisa a todos aunque uno falle y, si hubo fallos, lanza `ObserversFailedError` para que el transporte reintente.

📄 [`src/core/events/subject.ts`](../src/core/events/subject.ts#L17-L83) · líneas 17–83

```ts
/**
 * GoF Subject: uno por stream (por usuario). Mantiene sus observers y los notifica.
 *
 * - Serializa sus notificaciones: los eventos de un mismo usuario se procesan en orden,
 *   aunque el consumer de RabbitMQ reciba varios mensajes a la vez.
 * - Notifica a todos aunque alguno falle; si hubo fallos lanza `ObserversFailedError` para que
 *   el transporte reintente. En el reintento, los que ya tuvieron éxito se saltan (ledger).
 */
export class EventSubject {
  private readonly observers: Observer[] = [];
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    readonly streamId: string,
    private readonly ledger: ProcessedEventsLedger,
    private readonly log: FastifyBaseLogger,
    private readonly beforeNotify?: () => Promise<void>,
  ) {}

  attach(observer: Observer): void {
    if (!this.observers.includes(observer)) this.observers.push(observer);
  }

  detach(observer: Observer): void {
    const i = this.observers.indexOf(observer);
    if (i !== -1) this.observers.splice(i, 1);
  }

  get idle(): boolean {
    return this.pending === 0;
  }

  notify(event: DomainEvent): Promise<void> {
    this.pending++;
    const run = this.tail.then(() => this.notifyNow(event));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => this.pending--);
  }

  private async notifyNow(event: DomainEvent): Promise<void> {
    const interested = this.observers.filter((o) => o.interestedIn(event.type));
    if (interested.length === 0) return;
    const done = await this.ledger.done(
      event.id,
      interested.map((o) => o.name),
    );
    await this.beforeNotify?.();
    const errors: unknown[] = [];
    const failed: string[] = [];
    for (const observer of interested) {
      if (done.has(observer.name)) continue;
      try {
        await observer.update(event);
        await this.ledger.mark(event.id, observer.name);
      } catch (err) {
        errors.push(err);
        failed.push(observer.name);
        this.log.warn({ err, event: event.type, eventId: event.id, observer: observer.name }, 'observer falló');
      }
    }
    if (errors.length) throw new ObserversFailedError(errors, event, failed);
  }
}
```


Error que agrupa los fallos:

📄 [`src/core/events/subject.ts`](../src/core/events/subject.ts#L6-L15) · líneas 6–15

```ts
export class ObserversFailedError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly event: DomainEvent,
    readonly failedObservers: string[],
  ) {
    super(errors, `${failedObservers.length} observer(s) fallaron con "${event.type}" (${event.id}): ${failedObservers.join(', ')}`);
    this.name = 'ObserversFailedError';
  }
}
```


## 3. Registro de Subjects

Crea el Subject de cada usuario cuando hace falta y le conecta todos los observers. Guarda hasta 5000 y descarta los ociosos.

📄 [`src/core/events/subject.ts`](../src/core/events/subject.ts#L85-L145) · líneas 85–145

```ts
/**
 * Crea el Subject de cada stream bajo demanda y le conecta los observers del sistema.
 * Guarda como máximo `maxSubjects` en memoria; los que están ociosos se descartan primero
 * (se vuelven a crear igual la próxima vez, no tienen estado propio más allá de la cola).
 */
export class SubjectRegistry {
  private readonly subjects = new Map<string, EventSubject>();
  private readonly systemObservers: Observer[] = [];

  constructor(
    private readonly ledger: ProcessedEventsLedger,
    private readonly log: FastifyBaseLogger,
    private readonly maxSubjects = 5_000,
    /** Antes de notificar cada evento (p. ej. poner al día cachés que cambió otro proceso). */
    private readonly beforeNotify?: () => Promise<void>,
  ) {}

  /** Conecta un observer a todos los Subjects, los actuales y los que se creen después. */
  attach(observer: Observer): void {
    if (this.systemObservers.some((o) => o.name === observer.name)) throw new Error(`Observer duplicado: ${observer.name}`);
    this.systemObservers.push(observer);
    for (const s of this.subjects.values()) s.attach(observer);
  }

  detach(observer: Observer): void {
    const i = this.systemObservers.indexOf(observer);
    if (i !== -1) this.systemObservers.splice(i, 1);
    for (const s of this.subjects.values()) s.detach(observer);
  }

  get observers(): readonly Observer[] {
    return this.systemObservers;
  }

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
  }

  private evictIdle() {
    if (this.subjects.size <= this.maxSubjects) return;
    for (const [id, s] of this.subjects) {
      if (this.subjects.size <= this.maxSubjects) break;
      if (s.idle) this.subjects.delete(id);
    }
  }
}
```


## 4. Conexión

📄 [`src/infrastructure/event-bus/register-observers.ts`](../src/infrastructure/event-bus/register-observers.ts#L12-L29) · líneas 12–29

```ts
/**
 * Observers del sistema (cada módulo los declara en `events/<módulo>.observers.ts`).
 * Cada Subject de usuario los recibe a todos; cada uno decide a qué eventos reacciona.
 * Su `name` es estable: cambiarlo hace que vuelvan a procesar eventos ya vistos.
 */
export function createObservers(c: Container): Observer[] {
  return [
    new AccountObserver(c),
    new MenusObserver(c),
    new ShoppingObserver(c),
    new ReceiptsObserver(c),
    new ChefObserver(c),
    new LearningObserver(c),
    new NudgesObserver(c),
    new CommunityObserver(c),
    new NotificationsObserver(c),
  ];
}
```


Se llama en dos sitios:

📄 [`src/infrastructure/http/server.ts`](../src/infrastructure/http/server.ts#L38-L38) · líneas 38–38

```ts
  container.events.attach(createObservers(container));
```

📄 [`src/entrypoints/worker.ts`](../src/entrypoints/worker.ts#L17-L17) · líneas 17–17

```ts
container.events.attach(createObservers(container));
```


## 5. Observers concretos

| Clase (`name`) | Reacciona a | Archivo |
| --- | --- | --- |
| `AccountObserver` (`account`) | `user.registered`, `user.deleted`, `data_export.requested` | [`src/modules/account/events/account.observers.ts`](../src/modules/account/events/account.observers.ts) |
| `ChefObserver` (`chef`) | `receipt.parsed` | [`src/modules/chef/events/chef.observers.ts`](../src/modules/chef/events/chef.observers.ts) |
| `LearningObserver` (`learning`) | `receipt.parsed`, `shopping.item_swapped`, `meal.logged`, `cooking.events_recorded`, `cooking.completed`, `recipe.liked`, `chef.feedback_given` | [`src/modules/chef/events/learning.observers.ts`](../src/modules/chef/events/learning.observers.ts) |
| `CommunityObserver` (`community`) | `recipe.publish_requested` | [`src/modules/community/events/community.observers.ts`](../src/modules/community/events/community.observers.ts) |
| `NudgesObserver` (`nudges`) | `pantry.items_added`, `pantry.item_updated`, `pantry.item_removed`, `pantry.items_consumed`, `cooking.completed` | [`src/modules/home/events/nudges.observers.ts`](../src/modules/home/events/nudges.observers.ts) |
| `MenusObserver` (`menus`) | `onboarding.completed` | [`src/modules/menus/events/menus.observers.ts`](../src/modules/menus/events/menus.observers.ts) |
| `NotificationsObserver` (`notifications`) | `receipt.parsed`, `menu.generated`, `recipe.published`, `recipe.rejected`, `comment.created` | [`src/modules/notifications/events/notifications.observers.ts`](../src/modules/notifications/events/notifications.observers.ts) |
| `ReceiptsObserver` (`receipts`) | `receipt.uploaded` | [`src/modules/receipts/events/receipts.observers.ts`](../src/modules/receipts/events/receipts.observers.ts) |
| `ShoppingObserver` (`shopping`) | `pantry.item_removed`, `menu.generated`, `menu.entry_added`, `menu.entry_changed`, `menu.entry_removed` | [`src/modules/shopping/events/shopping.observers.ts`](../src/modules/shopping/events/shopping.observers.ts) |

📄 [`src/modules/account/events/account.observers.ts`](../src/modules/account/events/account.observers.ts#L1-L18) · líneas 1–18

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Cuenta: código de verificación al registrarse, exportación de datos y purga al borrar la cuenta. */
export class AccountObserver extends EventObserver {
  readonly name = 'account';

  constructor(c: Container) {
    super();
    const account = c.services.account;
    this.on('user.registered', async (e) => {
      if (e.payload.method !== 'password') return;
      await account.sendVerification(e.payload.userId, { enforceCooldown: false });
    });
    this.on('data_export.requested', (e) => account.buildExport(e.payload.userId, e.payload.exportId));
    this.on('user.deleted', (e) => account.purge(e.payload.userId, [...e.payload.storageKeys]));
  }
}
```

📄 [`src/modules/chef/events/chef.observers.ts`](../src/modules/chef/events/chef.observers.ts#L1-L23) · líneas 1–23

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Factura procesada → mensaje proactivo del chef en el hilo principal. */
export class ChefObserver extends EventObserver {
  readonly name = 'chef';

  constructor(c: Container) {
    super();
    this.on('receipt.parsed', async (e) => {
      const user = await c.repos.users.findById(e.payload.userId);
      if (!user || user.onboardingStatus !== 'completed') return;
      const cat = c.services.catalog;
      // Lo más útil para proponer un plato: una proteína y una verdura («pollo y tomate»).
      const ings = [...new Set(e.payload.ingredientIds)].map((id) => cat.ingredient(id)).filter((i) => !!i && !i.isBasic);
      const protein = ings.find((i) => i!.categoryId === 'protein' || i!.categoryId === 'seafood');
      const produce = ings.find((i) => i!.categoryId === 'produce');
      const picked = [protein, produce].filter(Boolean).length ? [protein, produce].filter(Boolean) : ings.slice(0, 2);
      const labels = picked.map((i) => i!.label.split(' de ').pop()!);
      await c.services.chef.proactiveFromReceipt(e.payload.userId, user.timezone, labels, e.payload.purchasedAt ? new Date(e.payload.purchasedAt) : null);
    });
  }
}
```

📄 [`src/modules/chef/events/learning.observers.ts`](../src/modules/chef/events/learning.observers.ts#L1-L60) · líneas 1–60

```ts
import type { Container } from '../../../container.js';
import { EventObserver, type ReplayableObserver } from '../../../core/events/observer.js';

/**
 * Señales de aprendizaje: cada hecho relevante queda como señal en Mongo y se recalculan los insights.
 * Es la única puerta de entrada al «Lo que tu chef ha aprendido».
 *
 * Es una proyección: `pnpm events:replay -- --observer learning --reset` borra las señales y las
 * reconstruye desde el event store (los votos del usuario sobre los insights se conservan).
 */
export class LearningObserver extends EventObserver implements ReplayableObserver {
  readonly name = 'learning';
  readonly replayable = true as const;

  constructor(private readonly c: Container) {
    super();
    const insights = c.services.insights;

    this.on('cooking.completed', async (e) => {
      const p = e.payload;
      await insights.recordSignal({ userId: p.userId, kind: 'cooked', at: e.occurredAt, weekday: p.weekday, slot: p.slot ?? undefined, recipeId: p.recipeId, tags: [...p.tags], eventId: e.id });
      if (p.rating) await insights.recordSignal({ userId: p.userId, kind: 'rated', at: e.occurredAt, recipeId: p.recipeId, value: p.rating, eventId: e.id });
      await insights.rebuild(p.userId);
    });

    this.on('receipt.parsed', async (e) => {
      for (const brand of e.payload.brands) {
        await insights.recordSignal({ userId: e.payload.userId, kind: 'brandPurchased', at: e.occurredAt, brand, eventId: e.id });
      }
      await insights.rebuild(e.payload.userId);
    });

    this.on('shopping.item_swapped', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'brandSwapped', at: e.occurredAt, brand: e.payload.brand, eventId: e.id });
      await insights.rebuild(e.payload.userId);
    });

    this.on('chef.feedback_given', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'ideaFeedback', at: e.occurredAt, recipeId: e.payload.recipeId ?? undefined, value: e.payload.rating === 'up' ? 1 : -1, eventId: e.id });
    });

    this.on('recipe.liked', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'liked', at: e.occurredAt, recipeId: e.payload.recipeId, value: e.payload.liked ? 1 : -1, eventId: e.id });
    });

    this.on('meal.logged', async (e) => {
      await insights.recordSignal({ userId: e.payload.userId, kind: 'mealLogged', at: e.occurredAt, slot: e.payload.slot, recipeId: e.payload.recipeId ?? undefined, eventId: e.id });
    });

    this.on('cooking.events_recorded', async (e) => {
      for (const ext of e.payload.timerExtensions) {
        await insights.recordSignal({ userId: e.payload.userId, kind: 'timerExtended', at: e.occurredAt, value: ext.addedSeconds, eventId: `${e.id}:${ext.stepIndex}` });
      }
    });
  }

  async reset(streamId?: string) {
    await this.c.mongo.c.userSignals.deleteMany(streamId ? { userId: streamId } : {});
  }
}
```

📄 [`src/modules/community/events/community.observers.ts`](../src/modules/community/events/community.observers.ts#L1-L14) · líneas 1–14

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Publicación con moderación asíncrona: `recipe.publish_requested` → `recipe.published` / `recipe.rejected`. */
export class CommunityObserver extends EventObserver {
  readonly name = 'community';

  constructor(c: Container) {
    super();
    this.on('recipe.publish_requested', async (e) => {
      await c.services.authoring.moderateAndPublish(e.payload.recipeId);
    });
  }
}
```

📄 [`src/modules/home/events/nudges.observers.ts`](../src/modules/home/events/nudges.observers.ts#L1-L17) · líneas 1–17

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Cualquier cambio en la despensa o una receta cocinada recalcula los avisos del usuario. */
export class NudgesObserver extends EventObserver {
  readonly name = 'nudges';

  constructor(c: Container) {
    super();
    this.onEach(['pantry.items_added', 'pantry.item_updated', 'pantry.item_removed', 'pantry.items_consumed', 'cooking.completed'], async (e) => {
      if (!e.userId) return;
      const [user, prefs] = await Promise.all([c.repos.users.findById(e.userId), c.repos.preferences.get(e.userId)]);
      if (!user || !prefs) return;
      await c.services.nudges.refresh(e.userId, user.timezone, prefs.kitchen.mealsPerDay);
    });
  }
}
```

📄 [`src/modules/menus/events/menus.observers.ts`](../src/modules/menus/events/menus.observers.ts#L1-L15) · líneas 1–15

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Onboarding terminado → primer menú de la semana (`menu.generated`). */
export class MenusObserver extends EventObserver {
  readonly name = 'menus';

  constructor(c: Container) {
    super();
    this.on('onboarding.completed', async (e) => {
      const tz = (await c.repos.users.findById(e.payload.userId))?.timezone ?? 'America/Bogota';
      await c.services.menus.generate(e.payload.userId, e.payload.menuId, tz);
    });
  }
}
```

📄 [`src/modules/notifications/events/notifications.observers.ts`](../src/modules/notifications/events/notifications.observers.ts#L1-L39) · líneas 1–39

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

type Kind = 'transactional' | 'dailyIdeas' | 'community';
type Push = { title: string; body: string; deepLink: string };

/** Push notifications. Solo reaccionan a eventos; ningún servicio llama al notificador directamente. */
export class NotificationsObserver extends EventObserver {
  readonly name = 'notifications';

  constructor(private readonly c: Container) {
    super();
    this.on('receipt.parsed', (e) =>
      this.push(e.payload.userId, { title: 'Factura lista', body: `Agregué ${e.payload.ingredientIds.length} productos a tu despensa`, deepLink: `noshy://receipts/${e.payload.receiptId}` }),
    );
    this.on('menu.generated', (e) =>
      this.push(e.payload.userId, { title: 'Tu menú está listo', body: 'Tu chef armó tus recetas de la semana', deepLink: `noshy://menus/${e.payload.menuId}` }, 'dailyIdeas'),
    );
    this.on('recipe.published', (e) =>
      this.push(e.payload.userId, { title: '¡Publicada!', body: 'Tu receta ya está en la comunidad', deepLink: `noshy://recipes/${e.payload.recipeId}` }, 'community'),
    );
    this.on('recipe.rejected', (e) =>
      this.push(e.payload.userId, { title: 'Tu receta necesita cambios', body: e.payload.reason, deepLink: `noshy://my-recipes/${e.payload.recipeId}` }),
    );
    this.on('comment.created', async (e) => {
      if (!e.payload.recipeAuthorId || e.payload.recipeAuthorId === e.payload.userId) return;
      await this.push(e.payload.recipeAuthorId, { title: 'Nuevo comentario', body: 'Alguien comentó tu receta', deepLink: `noshy://recipes/${e.payload.recipeId}/comments` }, 'community');
    });
  }

  /** Respeta Ajustes › Notificaciones. Lo transaccional (factura lista, receta rechazada) siempre sale. */
  private async push(userId: string, n: Push, kind: Kind = 'transactional') {
    if (kind !== 'transactional') {
      const u = await this.c.repos.users.findById(userId);
      if (!u || !u.settings.notifications[kind]) return;
    }
    await this.c.providers.notifier.push(userId, n);
  }
}
```

📄 [`src/modules/receipts/events/receipts.observers.ts`](../src/modules/receipts/events/receipts.observers.ts#L1-L15) · líneas 1–15

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/** Factura subida → OCR e interpretación → `receipt.parsed` / `receipt.failed`. */
export class ReceiptsObserver extends EventObserver {
  readonly name = 'receipts';

  constructor(c: Container) {
    super();
    this.on('receipt.uploaded', async (e) => {
      const user = await c.repos.users.findById(e.payload.userId);
      await c.services.receipts.process(e.payload.receiptId, user?.timezone ?? 'America/Bogota');
    });
  }
}
```

📄 [`src/modules/shopping/events/shopping.observers.ts`](../src/modules/shopping/events/shopping.observers.ts#L1-L52) · líneas 1–52

```ts
import type { Container } from '../../../container.js';
import { EventObserver } from '../../../core/events/observer.js';

/**
 * La lista de compras sigue al menú y a la despensa:
 * - `menu.generated` arma la lista con lo que falta para las recetas.
 * - «Mi semana»: agregar, cambiar o quitar una receta del menú actualiza la lista.
 * - «Se acabó» en la despensa con «agregar a la lista» → el ingrediente pasa a la lista.
 */
export class ShoppingObserver extends EventObserver {
  readonly name = 'shopping';

  constructor(c: Container) {
    super();
    const shopping = c.services.shopping;
    const tzOf = async (userId: string) => (await c.repos.users.findById(userId))?.timezone ?? 'America/Bogota';
    const stillInMenu = async (menuId: string, recipeId: string) => (await c.repos.menus.entries(menuId)).some((x) => x.recipeId === recipeId);

    this.on('menu.generated', async (e) => {
      const tz = await tzOf(e.payload.userId);
      await c.pg.db.transaction(async (tx) => {
        for (const recipeId of e.payload.recipeIds) {
          await shopping.addRecipeTx(tx, e.payload.userId, tz, { recipeId }, { failIfPresent: false });
        }
      });
    });

    this.on('menu.entry_added', async (e) => {
      const tz = await tzOf(e.payload.userId);
      await c.pg.db.transaction((tx) => shopping.addRecipeTx(tx, e.payload.userId, tz, { recipeId: e.payload.recipeId, servings: e.payload.servings }, { failIfPresent: false }));
    });

    this.on('menu.entry_changed', async (e) => {
      const tz = await tzOf(e.payload.userId);
      const keep = await stillInMenu(e.payload.menuId, e.payload.fromRecipeId);
      await c.pg.db.transaction(async (tx) => {
        if (!keep) await shopping.removeRecipeTx(tx, e.payload.userId, e.payload.fromRecipeId);
        await shopping.addRecipeTx(tx, e.payload.userId, tz, { recipeId: e.payload.toRecipeId, servings: e.payload.servings }, { failIfPresent: false });
      });
    });

    this.on('menu.entry_removed', async (e) => {
      if (await stillInMenu(e.payload.menuId, e.payload.recipeId)) return;
      await c.pg.db.transaction((tx) => shopping.removeRecipeTx(tx, e.payload.userId, e.payload.recipeId));
    });

    this.on('pantry.item_removed', async (e) => {
      if (!e.payload.addToShoppingList) return;
      await shopping.addItems(e.payload.userId, await tzOf(e.payload.userId), [{ ingredientId: e.payload.ingredientId }]);
    });
  }
}
```


## Agregar un observer

1. Crear `src/modules/<módulo>/events/<módulo>.observers.ts` con una clase que extienda `EventObserver`. Su `name` es único y no cambia: con él se registra lo ya procesado.
2. Exportarla en el `index.ts` del módulo.
3. Agregarla a `createObservers`.
4. Si el evento es nuevo, agregarlo a `EventPayloads` y a `EVENT_TYPES` en `catalog.ts`.
