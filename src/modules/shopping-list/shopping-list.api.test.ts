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

test('POST /shopping-list aggregates recipe ingredients and separates inventory coverage', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'shopping-recipes@noshy.com', 'Shopping User');
    const headers = { Authorization: `Bearer ${token}` };
    const recipeResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Pasta vegetal',
        ingredients: [
          { name: 'Pasta', quantity: 2, unit: 'tazas' },
          { name: 'Tomate', quantity: 3, unit: 'unidades' }
        ],
        instructions: ['Cocinar la pasta']
      })
    });
    const recipe = await recipeResponse.json();

    await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pasta', quantity: 1, unit: 'tazas' })
    });

    const shoppingResponse = await fetch(`http://127.0.0.1:${address.port}/shopping-list`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipes: [
          { recipeId: recipe.id, servings: 2 },
          {
            title: 'Salsa rápida',
            servings: 1,
            ingredients: [{ name: 'Tomate', quantity: 1, unit: 'unidades' }]
          }
        ]
      })
    });

    assert.equal(shoppingResponse.status, 201);
    const shopping = await shoppingResponse.json();
    assert.deepEqual(shopping.items, [
      { name: 'Pasta', quantity: 4, unit: 'tazas', availableQuantity: 1, missingQuantity: 3 },
      { name: 'Tomate', quantity: 7, unit: 'unidades', availableQuantity: 0, missingQuantity: 7 }
    ]);
    assert.deepEqual(shopping.availableItems, []);
    assert.deepEqual(shopping.missingItems, [
      { name: 'Pasta', quantity: 3, unit: 'tazas' },
      { name: 'Tomate', quantity: 7, unit: 'unidades' }
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
