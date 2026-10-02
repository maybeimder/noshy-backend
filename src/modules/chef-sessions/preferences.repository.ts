import type { PreferencesDocument } from './chef-session.model';

export interface PreferencesRepository {
  getByUserId(userId: string): PreferencesDocument;
  saveIfVersionMatches(userId: string, content: string, expectedVersion: number): PreferencesDocument | null;
}

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly documents = new Map<string, PreferencesDocument>();

  getByUserId(userId: string) {
    return this.documents.get(userId) ?? {
      userId,
      content: '# Preferencias\n',
      version: 1,
      updatedAt: new Date().toISOString()
    };
  }

  saveIfVersionMatches(userId: string, content: string, expectedVersion: number) {
    const current = this.getByUserId(userId);
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
