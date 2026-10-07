import { randomUUID } from 'node:crypto';

// Clase base de todo evento de dominio. Cada evento concreto declara
// `static readonly eventName` (ej. 'auth.user_registered') y un payload tipado.
// Todo evento pertenece a un usuario: el stream del Event Store y el Subject
// del Observer se resuelven con `userId`.
export abstract class DomainEvent<TPayload extends { userId: string } = { userId: string }> {
  static readonly eventName: string;

  constructor(
    readonly payload: TPayload,
    readonly eventId: string = randomUUID(),
    readonly occurredAt: string = new Date().toISOString()
  ) {}

  get name(): string {
    return (this.constructor as typeof DomainEvent).eventName;
  }

  get userId(): string {
    return this.payload.userId;
  }
}

export interface EventType<E extends DomainEvent<any> = DomainEvent<any>> {
  readonly eventName: string;
  new (payload: any, eventId?: string, occurredAt?: string): E;
}
