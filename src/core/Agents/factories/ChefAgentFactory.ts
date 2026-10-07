import type { ChefAgent } from '../ChefAgent';
import type { Interaction } from '../interfaces';

// Creator del Factory Method: las subclases deciden qué agente concreto se instancia.
export abstract class ChefAgentFactory {
  abstract createAgent(): ChefAgent;

  // Rehidrata un agente desde su historial de eventos (Event Sourcing).
  restoreAgent(history: readonly Interaction[]): ChefAgent {
    return this.createAgent().replay(history);
  }
}
