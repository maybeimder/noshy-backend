// Entrada: reacciona a eventos de otros módulos (como un controller, pero para eventos).
import type { DomainEvent } from '../../../core/events/domain-event';
import { IdempotentObserver } from '../../../core/events/observer';
import { FeedbackRecordedEvent } from '../../feedback/events/feedback.events';
import { RecommendationProjection, type RecommendationScore } from '../recommendation.projection';

// Observer: mantiene el puntaje de recomendaciones de cada usuario a partir del feedback.
export class RecommendationEngine extends IdempotentObserver {
  private projection = new RecommendationProjection();

  topFor(userId: string, limit?: number): RecommendationScore[] {
    return this.projection.topFor(userId, limit);
  }

  protected handle(event: DomainEvent<any>): void {
    if (event instanceof FeedbackRecordedEvent) {
      this.projection.apply(event.payload.entry);
    }
  }

  protected clearState(): void {
    this.projection = new RecommendationProjection();
  }
}
