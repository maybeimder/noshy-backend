import { DomainEvent } from '../../../core/events/domain-event';
import type { NutritionPlan } from '../plan.model';

export class NutritionPlanCreatedEvent extends DomainEvent<{ userId: string; plan: NutritionPlan }> {
  static readonly eventName = 'plans.nutrition_plan_created';
}

export class NutritionPlanUpdatedEvent extends DomainEvent<{ userId: string; plan: NutritionPlan }> {
  static readonly eventName = 'plans.nutrition_plan_updated';
}