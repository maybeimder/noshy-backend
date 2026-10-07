import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { ChefAgentContext } from '../../modules/chef-sessions/chef-agent.port';
import { createServer } from '../http/server';
import { DEFAULT_OPENROUTER_MODELS, OpenRouterChefAgent, parseChefReply } from './openrouter-chef-agent';

type Captured = { url: string; init: RequestInit; body: any };

// fetch falso: guarda la request y devuelve lo que diga `reply`.
function fakeFetch(reply: { status?: number; content?: string; raw?: unknown }) {
  const calls: Captured[] = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: JSON.parse(String(init.body)) });
    const payload = reply.raw ?? { choices: [{ message: { content: reply.content } }] };
    return new Response(JSON.stringify(payload), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

const context = (overrides: Partial<ChefAgentContext> = {}): ChefAgentContext => ({
  sessionId: 's1',
  userId: 'u1',
  preferencesMarkdown: '# Preferencias\nSin gluten\n',
  preferencesVersion: 1,
  inventory: [{ id: 'i1', userId: 'u1', name: 'Arroz', quantity: 2, unit: 'kg', createdAt: new Date().toISOString() }],
  messages: [
    { id: 'm1', sessionId: 's1', userId: 'u1', role: 'user', content: 'Hola', createdAt: '' },
    { id: 'm2', sessionId: 's1', userId: 'u1', role: 'assistant', content: '¡Hola! ¿Qué cocinamos?', createdAt: '' },
    { id: 'm3', sessionId: 's1', userId: 'u1', role: 'user', content: '¿Qué hago con arroz?', createdAt: '' }
  ],
  message: '¿Qué hago con arroz?',
  ...overrides
});

test('sends an authenticated chat request with the free models, JSON mode and the user context', async () => {
  const { fn, calls } = fakeFetch({ content: '{"message":"Haz arroz frito.","feedback":[]}' });
  await new OpenRouterChefAgent({ apiKey: 'sk-test', fetch: fn }).respond(context());

  const [call] = calls;
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal((call.init.headers as Record<string, string>).Authorization, 'Bearer sk-test');
  assert.equal(call.body.model, DEFAULT_OPENROUTER_MODELS[0]);
  assert.ok(DEFAULT_OPENROUTER_MODELS.every((model) => model.endsWith(':free') || model === 'openrouter/free'));
  assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.match(call.body.messages[1].content, /Arroz 2 kg/);
  assert.match(call.body.messages[1].content, /Sin gluten/);
  // historial previo + el mensaje actual una sola vez (no duplicado)
  assert.deepEqual(call.body.messages.slice(2).map((message: any) => message.content), ['Hola', '¡Hola! ¿Qué cocinamos?', '¿Qué hago con arroz?']);
});

test('parses the reply and keeps only well-formed feedback events', async () => {
  const content = JSON.stringify({
    message: 'Anotado, nada de brócoli.',
    feedback: [
      { targetType: 'ingredient', targetId: 'brocoli', targetName: 'Brócoli', eventType: 'discarded', note: 'No le gusta' },
      { targetType: 'planeta', targetId: 'x', targetName: 'X', eventType: 'selected' }
    ]
  });
  const { fn } = fakeFetch({ content });

  const reply = await new OpenRouterChefAgent({ apiKey: 'k', fetch: fn }).respond(context());

  assert.equal(reply.message, 'Anotado, nada de brócoli.');
  assert.deepEqual(reply.feedback, [{ targetType: 'ingredient', targetId: 'brocoli', targetName: 'Brócoli', eventType: 'discarded', note: 'No le gusta' }]);
});

test('tolerates fenced JSON and falls back to plain text when the model ignores the format', () => {
  assert.equal(parseChefReply('```json\n{"message":"Listo","feedback":[]}\n```').message, 'Listo');
  assert.deepEqual(parseChefReply('Claro, prueba un risotto.'), { message: 'Claro, prueba un risotto.', feedback: [] });
});

test('custom models are sent with fallbacks; HTTP errors and empty replies throw', async () => {
  const custom = fakeFetch({ content: '{"message":"ok"}' });
  await new OpenRouterChefAgent({ apiKey: 'k', models: ['a:free', 'b:free'], fetch: custom.fn }).respond(context());
  assert.equal(custom.calls[0].body.model, 'a:free');
  assert.deepEqual(custom.calls[0].body.models, ['a:free', 'b:free']);

  await assert.rejects(new OpenRouterChefAgent({ apiKey: 'k', fetch: fakeFetch({ status: 429, raw: { error: { message: 'rate limited' } } }).fn }).respond(context()), /429/);
  await assert.rejects(new OpenRouterChefAgent({ apiKey: 'k', fetch: fakeFetch({ raw: { choices: [] } }).fn }).respond(context()), /contenido/);
});

test('end to end over HTTP: the chef answers and the feedback it detects is recorded', async () => {
  const { fn } = fakeFetch({
    content: '{"message":"¡Que lo disfrutes!","feedback":[{"targetType":"recipe","targetId":"arroz-frito","targetName":"Arroz frito","eventType":"prepared"}]}'
  });
  const server = createServer({ chefAgent: new OpenRouterChefAgent({ apiKey: 'k', fetch: fn }) }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const json = { 'Content-Type': 'application/json' };

  try {
    const { token } = await (await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Chef', email: 'chef-or@noshy.com', password: 'StrongPass1!' })
    })).json();
    const auth = { ...json, Authorization: `Bearer ${token}` };
    const session = await (await fetch(`${base}/chef/sessions`, { method: 'POST', headers: auth })).json();

    const response = await fetch(`${base}/chef/sessions/${session.id}/respond`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ content: 'Ya preparé el arroz frito' })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.message.content, '¡Que lo disfrutes!');
    assert.equal(body.feedback[0].targetName, 'Arroz frito');

    const recommendations = await (await fetch(`${base}/recommendations`, { headers: auth })).json();
    assert.equal(recommendations[0].targetName, 'Arroz frito');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

// Contra OpenRouter real (gratis). Se salta si no hay OPENROUTER_API_KEY.
test('live: a free OpenRouter model answers in the expected format', { skip: process.env.OPENROUTER_API_KEY ? false : 'OPENROUTER_API_KEY no definido' }, async () => {
  const agent = new OpenRouterChefAgent({ apiKey: process.env.OPENROUTER_API_KEY!, timeoutMs: 90_000 });
  const reply = await agent.respond(context({ messages: [], message: 'Dame una idea rápida para cenar con lo que tengo. Ya no quiero comer brócoli.' }));

  assert.ok(reply.message.length > 0);
  assert.ok(Array.isArray(reply.feedback));
});
