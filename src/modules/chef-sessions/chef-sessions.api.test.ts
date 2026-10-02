import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createServer } from '../../infrastructure/http/server';
import type { ChefAgentPort } from './chef-agent.port';

const registerUser = async (serverPort: number, email: string, name: string) => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'StrongPass1!' })
  });

  assert.equal(response.status, 201);
  return (await response.json()).token as string;
};

test('chef sessions load preferences, version updates on close, and reject stale snapshots', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'chef@noshy.com', 'Chef User');
    const headers = { Authorization: `Bearer ${token}` };

    const firstOpenResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions`, {
      method: 'POST',
      headers
    });

    assert.equal(firstOpenResponse.status, 201);
    const firstSession = await firstOpenResponse.json();
    assert.equal(firstSession.status, 'active');
    assert.equal(firstSession.preferencesVersion, 1);

    const messageResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${firstSession.id}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Quiero una receta rápida con lo que tengo.' })
    });

    assert.equal(messageResponse.status, 201);
    const message = await messageResponse.json();
    assert.equal(message.role, 'user');
    assert.equal(message.content, 'Quiero una receta rápida con lo que tengo.');

    const contextResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${firstSession.id}/context`, {
      headers
    });

    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.match(context.preferencesMarkdown, /Preferencias/);
    assert.equal(context.messages.length, 1);
    assert.equal(context.messages[0].id, message.id);

    const staleOpenResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions`, {
      method: 'POST',
      headers
    });
    const staleSession = await staleOpenResponse.json();

    const closeResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${firstSession.id}/close`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'manual',
        preferencesMarkdown: '# Preferencias\n- Evitar cebolla'
      })
    });

    assert.equal(closeResponse.status, 200);
    const closedSession = await closeResponse.json();
    assert.equal(closedSession.status, 'closed');
    assert.equal(closedSession.preferencesVersion, 2);

    const nextOpenResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions`, {
      method: 'POST',
      headers
    });
    const nextSession = await nextOpenResponse.json();
    assert.equal(nextSession.preferencesVersion, 2);
    assert.match(nextSession.preferencesMarkdown, /Evitar cebolla/);

    const staleCloseResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${staleSession.id}/close`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'error',
        preferencesMarkdown: '# Preferencias obsoletas'
      })
    });

    assert.equal(staleCloseResponse.status, 409);
    const staleResult = await staleCloseResponse.json();
    assert.equal(staleResult.session.status, 'recovery_pending');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('chef agent receives context and returns an assistant message with detected feedback', async () => {
  const agent: ChefAgentPort = {
    respond: async (input) => ({
      message: `Recibí: ${input.message}`,
      feedback: [{
        targetType: 'recipe',
        targetId: 'recipe-agent-1',
        targetName: 'Sopa de verduras',
        eventType: 'prepared',
        note: 'Detectado por el agente'
      }]
    })
  };
  const server = createServer({ chefAgent: agent }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'agent@noshy.com', 'Agent User');
    const headers = { Authorization: `Bearer ${token}` };
    const sessionResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions`, {
      method: 'POST',
      headers
    });
    const session = await sessionResponse.json();

    const response = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${session.id}/respond`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Ya preparé la sopa.' })
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.message.role, 'assistant');
    assert.equal(result.message.content, 'Recibí: Ya preparé la sopa.');
    assert.equal(result.feedback.length, 1);

    const contextResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${session.id}/context`, {
      headers
    });
    const context = await contextResponse.json();
    assert.equal(context.messages.length, 2);
    assert.equal(context.messages[1].role, 'assistant');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
