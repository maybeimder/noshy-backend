import { DomainEvent } from '../../../core/events/domain-event';
import type { FeedbackEntry } from '../feedback.model';

export class FeedbackRecordedEvent extends DomainEvent<{ userId: string; entry: FeedbackEntry }> {
  static readonly eventName = 'feedback.feedback_recorded';
}