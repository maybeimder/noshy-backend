export type FeedbackTargetType = 'recipe' | 'plan' | 'ingredient';
export type FeedbackEventType = 'selected' | 'discarded' | 'prepared' | 'repeated' | 'preference_changed';

export interface FeedbackEntry {
  id: string;
  userId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  eventType: FeedbackEventType;
  note?: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface FeedbackInput {
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  eventType: FeedbackEventType;
  note?: string;
}
