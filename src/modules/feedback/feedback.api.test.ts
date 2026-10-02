import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createServer } from '../../infrastructure/http/server';

const registerUser = async (serverPort: number, email: string, name: string) => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      email,
      password: 'StrongPass1!'
    })
  });

  assert.equal(response.status, 201);
  return (await response.json()).token as string;
};

const openChefSession = async (serverPort: number, token: string) => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/chef/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(response.status, 201);
  return (await response.json()).id as string;
};

test('POST /feedback stores a prepared event and GET /recommendations returns positive interactions', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'feedback@noshy.com', 'Feedback User');
    const sessionId = await openChefSession(address.port, token);

    const feedbackResponse = await fetch(`http://127.0.0.1:${address.port}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        sessionId,
        targetType: 'recipe',
        targetId: 'recipe-123',
        targetName: 'Ensalada de quinoa',
        eventType: 'prepared',
        note: 'Muy fresca'
      })
    });

    assert.equal(feedbackResponse.status, 201);
    const feedback = await feedbackResponse.json();
    assert.equal(feedback.targetType, 'recipe');
    assert.equal(feedback.eventType, 'prepared');

    const recommendationsResponse = await fetch(`http://127.0.0.1:${address.port}/recommendations`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(recommendationsResponse.status, 200);
    const recommendations = await recommendationsResponse.json();
    assert.ok(Array.isArray(recommendations));
    assert.ok(recommendations.length > 0);
    assert.equal(recommendations[0].targetName, 'Ensalada de quinoa');

    const closeResponse = await fetch(`http://127.0.0.1:${address.port}/chef/sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual', preferencesMarkdown: '# Preferencias\n' })
    });

    assert.equal(closeResponse.status, 200);

    const inactiveFeedbackResponse = await fetch(`http://127.0.0.1:${address.port}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        sessionId,
        targetType: 'recipe',
        targetId: 'recipe-789',
        targetName: 'Receta posterior',
        eventType: 'prepared'
      })
    });

    assert.equal(inactiveFeedbackResponse.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('POST /feedback stores behavior events idempotently and GET /feedback returns the history', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'events@noshy.com', 'Events User');
    const sessionId = await openChefSession(address.port, token);
    const event = {
      sessionId,
      targetType: 'recipe',
      targetId: 'recipe-456',
      targetName: 'Pasta de verduras',
      eventType: 'prepared',
      note: 'La preparé y funcionó bien'
    };

    const firstResponse = await fetch(`http://127.0.0.1:${address.port}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'event-prepared-recipe-456'
      },
      body: JSON.stringify(event)
    });

    assert.equal(firstResponse.status, 201);
    const firstEvent = await firstResponse.json();

    const retryResponse = await fetch(`http://127.0.0.1:${address.port}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': 'event-prepared-recipe-456'
      },
      body: JSON.stringify(event)
    });

    assert.equal(retryResponse.status, 200);
    const retryEvent = await retryResponse.json();
    assert.equal(retryEvent.id, firstEvent.id);

    const historyResponse = await fetch(`http://127.0.0.1:${address.port}/feedback`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.length, 1);
    assert.equal(history[0].eventType, 'prepared');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
