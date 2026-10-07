import { KetoAgent } from '../agents/KetoAgent';
import type { ChefAgent } from '../ChefAgent';
import { ChefAgentFactory } from './ChefAgentFactory';

export class KetoAgentFactory extends ChefAgentFactory {
  createAgent(): ChefAgent {
    return new KetoAgent();
  }
}
