import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { LlmChefEngine, RuleBasedChefEngine, type ChefChunk, type ChefTools, type ChefTurn } from '../../src/modules/chef/chef.providers.js';
import { OpenRouterClient } from '../../src/infrastructure/ai/openrouter.client.js';

const log = pino({ level: 'silent' });
const card = (id: string) => ({
  id,
  title: `Receta ${id}`,
  imageUrl: null,
  cuisine: null,
  tags: [],
  totalTimeMinutes: { min: 20, max: 25 },
  nutritionPerServing: { kcal: 500, proteinG: 30, carbsG: 50, fatG: 15 },
  pantryMatch: { have: 3, total: 4 },
  isAdapted: false,
  isSaved: false,
});
const tools: ChefTools = {
  candidates: async () => [card('rcp_A'), card('rcp_B')],
  preferencesSummary: () => 'Sin lactosa',
  recommend: async () => card('rcp_RULES'),
  missingFromShoppingList: async () => [],
  topInsight: async () => null,
  recipe: async () => null,
  proposeAdaptation: async () => 'prp_1',
  hasEquipment: () => false,
};
const turn = (text: string): ChefTurn => ({
  userName: 'Diana',
  thread: { _id: 'thr_1', userId: 'u', contextKey: 'main', context: { type: 'main' }, lastMessageAt: null, lastReadAt: null, createdAt: new Date() },
  input: { kind: 'text', text },
  shownRecipeIds: [],
  lastChefMessage: null,
});
const collect = async (it: AsyncIterable<ChefChunk>) => {
  const out: ChefChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
};
const fakeFetch = (content: string, status = 200) =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;

describe('LlmChefEngine', () => {
  it('usa la respuesta del modelo y solo acepta recetas de las candidatas', async () => {
    const llm = new OpenRouterClient('k', ['m'], log, 1000, fakeFetch('```json\n{"reply":"Te propongo esta, Diana.","recipeId":"rcp_B"}\n```'));
    const chunks = await collect(new LlmChefEngine(llm, new RuleBasedChefEngine(), log).reply(turn('algo con pollo'), tools));
    expect(chunks.filter((c) => c.type === 'text').map((c) => (c as { delta: string }).delta).join('')).toBe('Te propongo esta, Diana.');
    const block = chunks.find((c) => c.type === 'block' && c.block.type === 'recipeCard') as unknown as { block: { recipe: { id: string } } };
    expect(block.block.recipe.id).toBe('rcp_B');
  });

  it('ignora un recipeId inventado', async () => {
    const llm = new OpenRouterClient('k', ['m'], log, 1000, fakeFetch('{"reply":"Hola","recipeId":"rcp_FAKE"}'));
    const chunks = await collect(new LlmChefEngine(llm, new RuleBasedChefEngine(), log).reply(turn('hola'), tools));
    expect(chunks.some((c) => c.type === 'block' && c.block.type === 'recipeCard')).toBe(false);
  });

  it('si el modelo falla, responde el motor de reglas', async () => {
    const llm = new OpenRouterClient('k', ['m'], log, 1000, fakeFetch('error', 500));
    const chunks = await collect(new LlmChefEngine(llm, new RuleBasedChefEngine(), log).reply(turn('dame una idea'), tools));
    const block = chunks.find((c) => c.type === 'block' && c.block.type === 'recipeCard') as unknown as { block: { recipe: { id: string } } };
    expect(block.block.recipe.id).toBe('rcp_RULES');
  });
});
