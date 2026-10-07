import { ChefAgent } from '../ChefAgent';
import type { UserProfile } from '../interfaces';

export class KetoAgent extends ChefAgent {
  constructor() {
    super('KetoChef', 'Ketogenic Diet');
  }

  generatePlan(profile: UserProfile): string {
    return `7-day keto plan for ${profile.name || 'User'}`;
  }

  suggestSubstitution(ingredient: string, _restrictions: string[]): string {
    const substitutions: Record<string, string> = {
      rice: 'grated cauliflower',
      potato: 'cauliflower mash',
      sugar: 'erythritol'
    };
    return substitutions[ingredient] || `low carb alternative for ${ingredient}`;
  }
}
