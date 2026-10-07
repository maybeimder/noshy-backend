import type { Tx } from '../../core/persistence/unit-of-work';
import type { PreferencesDocument } from './chef-session.model';

export const DEFAULT_PREFERENCES = '# Preferencias\n';

export interface PreferencesRepository {
  getByUserId(userId: string, tx?: Tx): Promise<PreferencesDocument>;
  // Concurrencia optimista: solo guarda si la versión actual sigue siendo expectedVersion.
  saveIfVersionMatches(userId: string, content: string, expectedVersion: number, tx?: Tx): Promise<PreferencesDocument | null>;
}

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly documents = new Map<string, PreferencesDocument>();

  async getByUserId(userId: string) {
    return this.documents.get(userId) ?? {
      userId,
      content: DEFAULT_PREFERENCES,
      version: 1,
      updatedAt: new Date().toISOString()
    };
  }

  async saveIfVersionMatches(userId: string, content: string, expectedVersion: number) {
    const current = await this.getByUserId(userId);
    if (current.version !== expectedVersion) {
      return null;
    }

    const document: PreferencesDocument = {
      userId,
      content,
      version: current.version + 1,
      updatedAt: new Date().toISOString()
    };
    this.documents.set(userId, document);
    return document;
  }
}
