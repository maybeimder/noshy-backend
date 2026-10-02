export type FeedbackTargetType = 'recipe' | 'plan' | 'ingredient';
export type FeedbackEventType = 'selected' | 'discarded' | 'prepared' | 'repeated' | 'rated' | 'preference_changed';

export interface FeedbackEntry {
  id: string;
  userId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  eventType: FeedbackEventType;
  rating?: number;
  note?: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface FeedbackInput {
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  eventType?: FeedbackEventType;
  rating?: number;
  note?: string;
}
