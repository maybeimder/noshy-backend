// Salida: solo define la forma de los datos (como un DTO). Nunca incluye contraseñas ni tokens.
import { DomainEvent } from '../../../core/events/domain-event';

export class UserRegisteredEvent extends DomainEvent<{ userId: string; name: string; email: string }> {
  static readonly eventName = 'auth.user_registered';
}

export class UserLoggedInEvent extends DomainEvent<{ userId: string; email: string }> {
  static readonly eventName = 'auth.user_logged_in';
}