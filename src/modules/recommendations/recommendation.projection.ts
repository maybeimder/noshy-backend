import type { FeedbackEntry, FeedbackEventType } from '../feedback/feedback.model';

export interface RecommendationScore {
  targetType: FeedbackEntry['targetType'];
  targetId: string;
  targetName: string;
  score: number;
  lastEventAt: string;
}

const WEIGHTS: Record<FeedbackEventType, number> = {
  selected: 1,
  prepared: 2,
  repeated: 3,
  discarded: -2,
  preference_changed: 0
};

/** Proyección (read model) alimentada por eventos de feedback. Mantiene un puntaje por usuario y objetivo. */
export class RecommendationProjection {
  private readonly scoresByUser = new Map<string, Map<string, RecommendationScore>>();

  apply(entry: FeedbackEntry): void {
    const weight = WEIGHTS[entry.eventType];
    if (weight === 0) return;

    const key = `${entry.targetType}::${entry.targetId}`;
    const scores = this.scoresByUser.get(entry.userId) ?? new Map<string, RecommendationScore>();
    const current = scores.get(key) ?? {
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      score: 0,
      lastEventAt: entry.createdAt
    };

    current.score += weight;
    current.targetName = entry.targetName;
    current.lastEventAt = entry.createdAt;
    scores.set(key, current);
    this.scoresByUser.set(entry.userId, scores);
  }

  topFor(userId: string, limit = 10): RecommendationScore[] {
    return [...(this.scoresByUser.get(userId)?.values() ?? [])]
      .filter((score) => score.score > 0)
      .sort((left, right) => right.score - left.score || right.lastEventAt.localeCompare(left.lastEventAt))
      .slice(0, limit);
  }

  reset(): void {
    this.scoresByUser.clear();
  }
}

