import type { DomainEvent } from '../../../core/events/domain-event';
import { IdempotentObserver } from '../../../core/events/observer';
import { FeedbackRecordedEvent } from '../../feedback/events/feedback.events';

export interface LearnedPreferences {
  likes: string[];
  dislikes: string[];
  notes: string[];
}

// Observer: aprende gustos del usuario a partir del feedback (selected/prepared/repeated gustan, discarded no).
export class PreferenceEngine extends IdempotentObserver {
  private preferencesByUser = new Map<string, { likes: Set<string>; dislikes: Set<string>; notes: string[] }>();

  preferencesOf(userId: string): LearnedPreferences {
    const current = this.preferencesByUser.get(userId);
    return {
      likes: [...(current?.likes ?? [])],
      dislikes: [...(current?.dislikes ?? [])],
      notes: [...(current?.notes ?? [])]
    };
  }

  protected handle(event: DomainEvent<any>, userId: string): void {
    if (!(event instanceof FeedbackRecordedEvent)) return;

    const { eventType, targetName, note } = event.payload.entry;
    const current = this.preferencesByUser.get(userId) ?? { likes: new Set<string>(), dislikes: new Set<string>(), notes: [] };

    if (eventType === 'discarded') {
      current.likes.delete(targetName);
      current.dislikes.add(targetName);
    } else if (eventType === 'preference_changed') {
      if (note) current.notes.push(note);
    } else {
      current.dislikes.delete(targetName);
      current.likes.add(targetName);
    }

    this.preferencesByUser.set(userId, current);
  }

  protected clearState(): void {
    this.preferencesByUser = new Map();
  }
}
