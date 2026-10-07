import { VeganAgent } from '../agents/VeganAgent';
import type { ChefAgent } from '../ChefAgent';
import { ChefAgentFactory } from './ChefAgentFactory';

export class VeganAgentFactory extends ChefAgentFactory {
  createAgent(): ChefAgent {
    return new VeganAgent();
  }
}
