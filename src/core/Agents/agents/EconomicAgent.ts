import { ChefAgent } from '../ChefAgent';
import type { UserProfile } from '../interfaces';

export class EconomicAgent extends ChefAgent {
  constructor() {
    super('BudgetChef', 'Savings and Budget');
  }

  generatePlan(profile: UserProfile): string {
    const budget = profile.weeklyBudget || 50000;
    return `Budget plan for ${profile.name || 'User'} (max $${budget} weekly)`;
  }

  suggestSubstitution(ingredient: string, _restrictions: string[]): string {
    const substitutions: Record<string, string> = {
      salmon: 'canned sardines',
      steak: 'chicken thigh'
    };
    return substitutions[ingredient] || `budget alternative for ${ingredient}`;
  }
}
