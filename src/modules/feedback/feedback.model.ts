export type FeedbackTargetType = 'recipe' | 'plan' | 'ingredient';

export interface FeedbackEntry {
  id: string;
  userId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  rating: number;
  note?: string;
  createdAt: string;
}

export interface FeedbackInput {
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  rating: number;
  note?: string;
}
