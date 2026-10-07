import type { Tx } from '../../core/persistence/unit-of-work';
import type { AuthUser } from './auth.model';

export interface UserRepository {
  findByEmail(email: string, tx?: Tx): Promise<AuthUser | null>;
  findById(id: string, tx?: Tx): Promise<AuthUser | null>;
  insert(user: AuthUser, tx?: Tx): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byEmail = new Map<string, AuthUser>();
  private readonly byId = new Map<string, AuthUser>();

  async findByEmail(email: string) {
    return this.byEmail.get(email) ?? null;
  }

  async findById(id: string) {
    return this.byId.get(id) ?? null;
  }

  async insert(user: AuthUser) {
    this.byEmail.set(user.email, user);
    this.byId.set(user.id, user);
  }
}
