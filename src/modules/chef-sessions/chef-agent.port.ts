import type { FeedbackEventType, FeedbackTargetType } from '../feedback/feedback.model';
import type { ChefSessionMessage } from './chef-session.model';
import type { NutritionPlan } from '../plans/plan.model';

export interface ChefAgentContext {
  sessionId: string;
  userId: string;
  preferencesMarkdown: string;
  preferencesVersion: number;
  nutritionPlan?: NutritionPlan;
  messages: ChefSessionMessage[];
  message: string;
}

export interface ChefAgentFeedback {
  targetType: FeedbackTargetType;
  targetId: string;
  targetName: string;
  eventType: FeedbackEventType;
  note?: string;
  idempotencyKey?: string;
}

export interface ChefAgentResponse {
  message: string;
  feedback: ChefAgentFeedback[];
}

export interface ChefAgentPort {
  respond(context: ChefAgentContext): Promise<ChefAgentResponse>;
}

export function createUnavailableChefAgent(): ChefAgentPort {
  return {
    respond: async () => {
      throw new Error('CHEF_AGENT_NOT_CONFIGURED');
    }
  };
}
