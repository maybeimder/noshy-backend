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

test('PATCH and DELETE /recipes/:id manage only the recipe owner', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const ownerToken = await registerUser(address.port, 'recipe-owner@noshy.com', 'Recipe Owner');
    const otherToken = await registerUser(address.port, 'recipe-other@noshy.com', 'Other User');
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Receta original',
        ingredients: [{ name: 'Arroz', quantity: 1, unit: 'taza' }],
        instructions: ['Cocinar']
      })
    });
    const recipe = await createResponse.json();

    const updateResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/${recipe.id}`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Receta actualizada',
        ingredients: [{ name: 'Arroz integral', quantity: 2, unit: 'tazas' }]
      })
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.title, 'Receta actualizada');
    assert.equal(updated.ingredients[0].name, 'Arroz integral');
    assert.deepEqual(updated.instructions, ['Cocinar']);

    const otherUpdateResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/${recipe.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Cambio no autorizado' })
    });
    assert.equal(otherUpdateResponse.status, 404);

    const otherDeleteResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/${recipe.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    assert.equal(otherDeleteResponse.status, 404);

    const ownerDeleteResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/${recipe.id}`, {
      method: 'DELETE',
      headers: ownerHeaders
    });
    assert.equal(ownerDeleteResponse.status, 204);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
