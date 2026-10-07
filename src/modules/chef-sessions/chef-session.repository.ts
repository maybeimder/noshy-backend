import type { Tx } from '../../core/persistence/unit-of-work';
import type { ChefSession, ChefSessionMessage } from './chef-session.model';

export interface ChefSessionRepository {
  findById(sessionId: string, tx?: Tx): Promise<ChefSession | null>;
  insert(session: ChefSession, tx?: Tx): Promise<void>;
  update(session: ChefSession, tx?: Tx): Promise<void>;
  listMessages(sessionId: string, tx?: Tx): Promise<ChefSessionMessage[]>;
  insertMessage(message: ChefSessionMessage, tx?: Tx): Promise<void>;
}

export class InMemoryChefSessionRepository implements ChefSessionRepository {
  private readonly sessions = new Map<string, ChefSession>();
  private readonly messagesBySessionId = new Map<string, ChefSessionMessage[]>();

  async findById(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async insert(session: ChefSession) {
    this.sessions.set(session.id, session);
    this.messagesBySessionId.set(session.id, []);
  }

  async update(session: ChefSession) {
    this.sessions.set(session.id, session);
  }

  async listMessages(sessionId: string) {
    return this.messagesBySessionId.get(sessionId) ?? [];
  }

  async insertMessage(message: ChefSessionMessage) {
    const messages = this.messagesBySessionId.get(message.sessionId) ?? [];
    messages.push(message);
    this.messagesBySessionId.set(message.sessionId, messages);
  }
}
