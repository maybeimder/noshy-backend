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

test('POST /recipes/adapt uses inventory without depending on a menu plan', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'inventory-adapt@noshy.com', 'Inventory User');
    const headers = { Authorization: `Bearer ${token}` };
    const recipeResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Arroz con verduras',
        ingredients: [
          { name: 'Arroz', quantity: 2, unit: 'tazas' },
          { name: 'Zanahoria', quantity: 3, unit: 'unidades' }
        ],
        instructions: ['Cocinar el arroz', 'Agregar la zanahoria']
      })
    });
    const recipe = await recipeResponse.json();

    await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'arroz', quantity: 1, unit: 'tazas' })
    });
    await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zanahoria', quantity: 3, unit: 'unidades' })
    });

    const adaptationResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/adapt`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipeId: recipe.id })
    });
    assert.equal(adaptationResponse.status, 201);
    const adapted = await adaptationResponse.json();
    assert.deepEqual(adapted.ingredients, [{ name: 'Zanahoria', quantity: 3, unit: 'unidades' }]);
    assert.deepEqual(adapted.missingIngredients, [{ name: 'Arroz', quantity: 1, unit: 'tazas' }]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
