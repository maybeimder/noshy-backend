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

test('POST /feedback stores a rating and GET /recommendations returns the most liked items', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'feedback@noshy.com', 'Feedback User');

    const feedbackResponse = await fetch(`http://127.0.0.1:${address.port}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        targetType: 'recipe',
        targetId: 'recipe-123',
        targetName: 'Ensalada de quinoa',
        rating: 5,
        note: 'Muy fresca'
      })
    });

    assert.equal(feedbackResponse.status, 201);
    const feedback = await feedbackResponse.json();
    assert.equal(feedback.targetType, 'recipe');
    assert.equal(feedback.rating, 5);

    const recommendationsResponse = await fetch(`http://127.0.0.1:${address.port}/recommendations`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(recommendationsResponse.status, 200);
    const recommendations = await recommendationsResponse.json();
    assert.ok(Array.isArray(recommendations));
    assert.ok(recommendations.length > 0);
    assert.equal(recommendations[0].targetName, 'Ensalada de quinoa');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
