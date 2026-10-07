// Cliente del Factory Method: registry DietType -> fábrica. Agregar una dieta = una clase agente,
// una fábrica y una línea aquí; el resto del sistema no cambia.
import type { ChefAgent } from './ChefAgent';
import { ChefAgentFactory } from './factories/ChefAgentFactory';
import { EconomicAgentFactory } from './factories/EconomicAgentFactory';
import { KetoAgentFactory } from './factories/KetoAgentFactory';
import { VeganAgentFactory } from './factories/VeganAgentFactory';
import type { Interaction } from './interfaces';

export { ChefAgent } from './ChefAgent';
export type { Interaction, UserProfile } from './interfaces';

export enum DietType {
  keto = 'keto',
  vegan = 'vegan',
  economic = 'economic'
}

const agentFactories: Record<DietType, ChefAgentFactory> = {
  [DietType.keto]: new KetoAgentFactory(),
  [DietType.vegan]: new VeganAgentFactory(),
  [DietType.economic]: new EconomicAgentFactory()
};

function factoryFor(dietType: DietType): ChefAgentFactory {
  const factory = agentFactories[dietType];
  if (!factory) throw new Error(`Factory for diet type '${dietType}' not found.`);
  return factory;
}

export function assignChefAgent(dietType: DietType): ChefAgent {
  return factoryFor(dietType).createAgent();
}

export function restoreChefAgent(dietType: DietType, history: readonly Interaction[]): ChefAgent {
  return factoryFor(dietType).restoreAgent(history);
}
