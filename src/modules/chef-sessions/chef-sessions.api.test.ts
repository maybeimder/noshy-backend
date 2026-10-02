import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createServer } from '../../infrastructure/http/server';

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
