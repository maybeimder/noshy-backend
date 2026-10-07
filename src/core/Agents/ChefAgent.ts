import type { Interaction, UserProfile } from './interfaces';

// Abstract Product del Factory Method. Modelo 1:1: cada usuario tiene UN agente, definido por su
// tipo de dieta al registrarse. El agente es event-sourced: su estado es el historial de
// interacciones, así que puede reconstruirse reproduciéndolo (replay).
export abstract class ChefAgent {
  private readonly history: Interaction[] = [];

  constructor(
    readonly agentName: string,
    readonly specialty: string
  ) {}

  get interactionHistory(): readonly Interaction[] {
    return this.history;
  }

  abstract generatePlan(profile: UserProfile): string;

  abstract suggestSubstitution(ingredient: string, restrictions: string[]): string;

  learn(interaction: Interaction): void {
    this.history.push(interaction);
  }

  // Event Sourcing: reconstruye el estado del agente desde su historial persistido.
  replay(history: readonly Interaction[]): this {
    history.forEach((interaction) => this.learn(interaction));
    return this;
  }
}
