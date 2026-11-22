import type { EventType } from './catalog.js';
import type { DomainEvent } from './domain-event.js';

/**
 * GoF Observer: reacciona a lo que pasa en el Subject (el stream de un usuario).
 * `name` es estable y único: con él se registra qué eventos ya procesó (idempotencia).
 */
export interface Observer {
  readonly name: string;
  interestedIn(type: EventType): boolean;
  update(event: DomainEvent): Promise<void>;
}

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

export const isReplayable = (o: Observer): o is ReplayableObserver => (o as Partial<ReplayableObserver>).replayable === true;

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
