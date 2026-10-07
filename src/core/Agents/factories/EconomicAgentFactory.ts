import { EconomicAgent } from '../agents/EconomicAgent';
import type { ChefAgent } from '../ChefAgent';
import { ChefAgentFactory } from './ChefAgentFactory';

export class EconomicAgentFactory extends ChefAgentFactory {
  createAgent(): ChefAgent {
    return new EconomicAgent();
  }
}
