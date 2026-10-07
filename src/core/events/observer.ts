import type { DomainEvent } from './domain-event';

// GoF Observer: reacciona a lo que ocurre en el Subject de un usuario.
export interface Observer {
  update(event: DomainEvent<any>, userId: string): void | Promise<void>;
}

// La entrega del outbox es at-least-once: un evento puede llegar más de una vez.
// Esta base descarta duplicados por eventId (Template Method: las subclases solo implementan handle).
export abstract class IdempotentObserver implements Observer {
  private readonly processed = new Set<string>();

  async update(event: DomainEvent<any>, userId: string): Promise<void> {
    if (this.processed.has(event.eventId)) return;
    await this.handle(event, userId);
    this.processed.add(event.eventId);
  }

  // Vuelve al estado inicial antes de reconstruir la proyección con un replay.
  reset(): void {
    this.processed.clear();
    this.clearState();
  }

  protected abstract handle(event: DomainEvent<any>, userId: string): void | Promise<void>;
  protected abstract clearState(): void;
}
