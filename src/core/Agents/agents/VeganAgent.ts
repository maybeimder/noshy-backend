import { ChefAgent } from '../ChefAgent';
import type { UserProfile } from '../interfaces';

export class VeganAgent extends ChefAgent {
  constructor() {
    super('VeganChef', 'Vegan Diet');
  }

  generatePlan(profile: UserProfile): string {
    return `7-day vegan plan for ${profile.name || 'User'}`;
  }

  suggestSubstitution(ingredient: string, _restrictions: string[]): string {
    const substitutions: Record<string, string> = {
      chicken: 'firm tofu',
      egg: 'aquafaba',
      milk: 'oat milk'
    };
    return substitutions[ingredient] || `vegan alternative for ${ingredient}`;
  }
}
