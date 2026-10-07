import type { DomainEvent } from './domain-event';
import type { Observer } from './observer';

// GoF Subject: uno por usuario (igual que en la arquitectura de referencia).
export class Subject {
  private readonly observers: Observer[] = [];

  constructor(readonly userId: string) {}

  attach(observer: Observer): void {
    if (!this.observers.includes(observer)) this.observers.push(observer);
  }

  detach(observer: Observer): void {
    const index = this.observers.indexOf(observer);
    if (index !== -1) this.observers.splice(index, 1);
  }

  // Notifica a todos aunque alguno falle; si hubo fallos lanza AggregateError para que el outbox reintente.
  async notify(event: DomainEvent<any>): Promise<void> {
    const failures: unknown[] = [];
    for (const observer of [...this.observers]) {
      try {
        await observer.update(event, this.userId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} observer(s) fallaron con "${event.name}"`);
    }
  }
}

export interface EventDispatcher {
  dispatch(event: DomainEvent<any>): Promise<void>;
}

// Crea perezosamente el Subject de cada usuario y le conecta los observers del sistema.
export class SubjectRegistry implements EventDispatcher {
  private readonly subjects = new Map<string, Subject>();

  constructor(private readonly observers: Observer[]) {}

  subjectFor(userId: string): Subject {
    let subject = this.subjects.get(userId);
    if (!subject) {
      const created = new Subject(userId);
      this.observers.forEach((observer) => created.attach(observer));
      this.subjects.set(userId, created);
      subject = created;
    }
    return subject;
  }

  dispatch(event: DomainEvent<any>): Promise<void> {
    return this.subjectFor(event.userId).notify(event);
  }
}
