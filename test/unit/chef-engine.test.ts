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
  nutritionEstimated: false,
  imageIsReference: false,
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
  createRecipes: async () => [],
  pantry: async () => ['Arroz', 'Pollo'],
  recipeBrief: async () => 'Ajiaco · 4 porciones\nPor porción: 600 kcal',
};
const turn = (text: string): ChefTurn => ({
  userName: 'Diana',
  thread: { _id: 'thr_1', userId: 'u', contextKey: 'main', context: { type: 'main' }, lastMessageAt: null, lastReadAt: null, createdAt: new Date() },
  input: { kind: 'text', text },
  shownRecipeIds: [],
  lastChefMessage: null,
  history: [],
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

  const recording = (replies: Record<string, { status?: number; content?: string }>) => {
    const calls: { model: string; messages: { role: string; content: string }[] }[] = [];
    const f = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      const r = replies[body.model] ?? {};
      return new Response(JSON.stringify({ choices: [{ message: { content: r.content } }] }), { status: r.status ?? 200 });
    }) as unknown as typeof fetch;
    return { calls, f };
  };
  const textOf = (chunks: ChefChunk[]) => chunks.flatMap((c) => (c.type === 'text' ? [c.delta] : [])).join('');
  const ok = { content: '{"reply":"Claro que sí","recipeId":null}' };

  it('un modelo retirado, vacío o que no da JSON no tumba a los demás; una key mala sí corta', async () => {
    const { calls, f } = recording({ retirado: { status: 404 }, vacio: {}, texto: { content: 'hola' }, bueno: ok });
    const llm = new OpenRouterClient('k', ['retirado', 'vacio', 'texto', 'bueno'], log, 1000, f);
    expect(await llm.chatJson([])).toMatchObject({ reply: 'Claro que sí' });
    expect(calls.map((c) => c.model)).toEqual(['retirado', 'vacio', 'texto', 'bueno']);
    const bad = recording({ a: { status: 401 }, b: ok });
    await expect(new OpenRouterClient('k', ['a', 'b'], log, 1000, bad.f).chatJson([])).rejects.toThrow('401');
    expect(bad.calls).toHaveLength(1);
  });

  it('manda la conversación anterior y las restricciones', async () => {
    const { calls, f } = recording({ m: ok });
    const t = { ...turn('¿y con menos grasa?'), history: [{ role: 'user' as const, text: 'quiero pasta' }, { role: 'chef' as const, text: 'Mira esta' }] };
    await collect(new LlmChefEngine(new OpenRouterClient('k', ['m'], log, 1000, f), new RuleBasedChefEngine(), log).reply(t, tools));
    expect(calls[0]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(calls[0]!.messages[0]!.content).toContain('Sin lactosa');
    expect(calls[0]!.messages[0]!.content).toContain('En su despensa: Arroz, Pollo');
    expect(calls[0]!.messages.at(-1)!.content).toBe('¿y con menos grasa?');
  });

  it('dentro de una receta responde el modelo con sus datos; airfryer y «¿qué compro?» siguen en reglas', async () => {
    const { calls, f } = recording({ m: { content: '{"reply":"Sí, con leche de coco."}' } });
    const engine = new LlmChefEngine(new OpenRouterClient('k', ['m'], log, 1000, f), new RuleBasedChefEngine(), log);
    const inRecipe = { ...turn('¿puedo reemplazar la leche?'), thread: { ...turn('').thread, context: { type: 'recipe' as const, recipeId: 'rcp_A', title: 'Ajiaco' } } };
    const chunks = await collect(engine.reply(inRecipe, tools));
    expect(textOf(chunks)).toBe('Sí, con leche de coco.');
    expect(calls[0]!.messages[0]!.content).toContain('600 kcal');
    await collect(engine.reply({ ...turn(''), input: { kind: 'suggestedPrompt', optionId: 'sp_whattobuy', label: '¿Qué compro?' } }, tools));
    await collect(engine.reply(turn('¿qué compro?'), tools));
    expect(calls).toHaveLength(1);
    await collect(engine.reply({ ...turn(''), input: { kind: 'suggestedPrompt', optionId: 'sp_moreprotein', label: 'Más proteína' } }, tools));
    await collect(engine.reply(turn('compré pollo, ¿qué hago?'), tools));
    expect(calls).toHaveLength(3);
    await collect(engine.reply({ ...turn(''), input: { kind: 'anotherIdea', recipeId: null } }, tools));
    expect(calls[3]!.messages.at(-1)!.content).toContain('otra idea');
  });

  const cardsOf = (chunks: ChefChunk[]) => chunks.flatMap((c) => (c.type === 'block' && c.block.type === 'recipeCard' ? [(c.block.recipe as { id: string }).id] : []));
  const engineWith = (content: string) => new LlmChefEngine(new OpenRouterClient('k', ['m'], log, 1000, fakeFetch(content)), new RuleBasedChefEngine(), log);

  it('inventa la receta y la entrega como tarjeta: máximo dos', async () => {
    const got: unknown[][] = [];
    const t: ChefTools = { ...tools, createRecipes: async (d) => (got.push(d), [card('n1'), card('n2'), card('n3')]) };
    const chunks = await collect(engineWith('{"reply":"Te la armo.","recipeIds":[],"recipes":[{"title":"A"},{"title":"B"},{"title":"C"}]}').reply(turn('dame opciones'), t));
    expect(got).toEqual([[{ title: 'A' }, { title: 'B' }]]);
    expect(cardsOf(chunks)).toEqual(['n1', 'n2']);
    expect(chunks.find((c) => c.type === 'block' && c.block.type === 'recipeCard')).toMatchObject({ block: { recipe: { reason: { label: 'Creada para ti' } } } });
    expect(chunks.filter((c) => c.type === 'block' && c.block.type === 'feedbackPrompt').map((c) => (c as unknown as { block: { targetBlockId: string } }).block.targetBlockId)).toEqual(['b_card0', 'b_card1']);
    await collect(engineWith('{"reply":"Va","recipe":{"title":"Sola"}}').reply(turn('idea'), t));
    expect(got[1]).toEqual([{ title: 'Sola' }]);
  });

  it('si la receta no sirve o falla al guardarla, recomienda una que existe y lo dice', async () => {
    for (const createRecipes of [async () => [], async () => Promise.reject(new Error('x'))]) {
      const chunks = await collect(engineWith('{"reply":"Voy.","recipes":[{"title":"Rara"}]}').reply(turn('idea'), { ...tools, createRecipes }));
      expect(textOf(chunks)).toContain('no me convenció');
      expect(cardsOf(chunks)).toEqual(['rcp_RULES']);
    }
    let called = 0;
    const count: ChefTools = { ...tools, createRecipes: async () => (called++, []) };
    expect(cardsOf(await collect(engineWith('{"reply":"Mira","recipeIds":["rcp_A","rcp_B","rcp_X"],"recipes":[{}]}').reply(turn('una de Noshy'), count)))).toEqual(['rcp_A', 'rcp_B']);
    expect(cardsOf(await collect(engineWith('{"reply":"El arroz va 1 a 2.","recipes":[]}').reply(turn('¿cuánta agua?'), count)))).toEqual([]);
    expect(called).toBe(0);
  });

  it('el plazo total corta aunque queden modelos', async () => {
    let n = 0;
    const slow = ((_u: string, init: RequestInit) => (n++, new Promise((_, no) => init.signal!.addEventListener('abort', () => no(new Error('timeout')))))) as unknown as typeof fetch;
    await expect(new OpenRouterClient('k', ['a', 'b', 'c', 'd'], log, 60, slow, 100).chatJson([])).rejects.toThrow();
    expect(n).toBe(2);
  });
});
