import type { Tx } from '../../core/persistence/unit-of-work';
import type { NutritionPlan } from './plan.model';

export interface PlanRepository {
  // En orden de creación; el activo es el último.
  listByUser(userId: string, tx?: Tx): Promise<NutritionPlan[]>;
  insert(plan: NutritionPlan, tx?: Tx): Promise<void>;
  update(plan: NutritionPlan, tx?: Tx): Promise<void>;
}

export class InMemoryPlanRepository implements PlanRepository {
  private readonly byUser = new Map<string, NutritionPlan[]>();

  async listByUser(userId: string) {
    return this.byUser.get(userId) ?? [];
  }

  async insert(plan: NutritionPlan) {
    const plans = this.byUser.get(plan.userId) ?? [];
    plans.push(plan);
    this.byUser.set(plan.userId, plans);
  }

  async update(plan: NutritionPlan) {
    const plans = this.byUser.get(plan.userId) ?? [];
    const index = plans.findIndex((entry) => entry.id === plan.id);
    if (index !== -1) plans[index] = plan;
  }
}
