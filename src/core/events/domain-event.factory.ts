import type { DomainEvent, EventType } from './domain-event';
import type { StoredEvent } from './event-store';

// Factory: reconstruye la clase de evento correcta a partir de un registro persistido (rehidratación).
export class DomainEventFactory {
  private readonly typesByName = new Map<string, EventType>();

  constructor(types: EventType[] = []) {
    types.forEach((type) => this.register(type));
  }

  register(type: EventType): this {
    if (this.typesByName.has(type.eventName)) {
      throw new Error(`Evento duplicado en el factory: ${type.eventName}`);
    }
    this.typesByName.set(type.eventName, type);
    return this;
  }

  create(record: StoredEvent): DomainEvent<any> {
    const type = this.typesByName.get(record.type);
    if (!type) {
      throw new Error(`Tipo de evento desconocido: ${record.type}`);
    }
    return new type(structuredClone(record.payload), record.eventId, record.occurredAt);
  }
}
