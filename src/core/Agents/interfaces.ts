export interface UserProfile {
  name?: string;
  mainGoal?: string;
  restrictions?: string[];
  weeklyBudget?: number;
}

export interface Interaction {
  action: string;
  [key: string]: unknown;
}
