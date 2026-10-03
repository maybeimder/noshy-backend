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

test('POST /recipes/:id/publish makes a recipe available in GET /community/recipes', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'community@noshy.com', 'Community User');
    const recipeResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'Tacos de lentejas',
        ingredients: [{ name: 'Lentejas', quantity: 1, unit: 'taza' }],
        instructions: ['Cocinar las lentejas']
      })
    });

    assert.equal(recipeResponse.status, 201);
    const recipe = await recipeResponse.json();

    const publishResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/${recipe.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(publishResponse.status, 200);
    const published = await publishResponse.json();
    assert.equal(published.isPublic, true);

    const communityResponse = await fetch(`http://127.0.0.1:${address.port}/community/recipes`);

    assert.equal(communityResponse.status, 200);
    const communityRecipes = await communityResponse.json();
    assert.equal(communityRecipes.length, 1);
    assert.equal(communityRecipes[0].title, 'Tacos de lentejas');
    assert.equal(communityRecipes[0].authorName, 'Community User');

    const detailResponse = await fetch(`http://127.0.0.1:${address.port}/community/recipes/${recipe.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.id, recipe.id);
    assert.equal(detail.instructions[0], 'Cocinar las lentejas');

    const unpublishResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/${recipe.id}/unpublish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(unpublishResponse.status, 200);
    const unpublished = await unpublishResponse.json();
    assert.equal(unpublished.isPublic, false);

    const hiddenDetailResponse = await fetch(`http://127.0.0.1:${address.port}/community/recipes/${recipe.id}`);
    assert.equal(hiddenDetailResponse.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
