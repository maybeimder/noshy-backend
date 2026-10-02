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

test('GET /plans/:planId/inventory-coverage and POST /recipes/adapt use inventory from a selected plan', async () => {
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

    const planResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 1, goals: ['maintain'], mealsPerDay: 1, recipeIds: [recipe.id] })
    });
    const generation = await planResponse.json();
    const selectResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${generation.plans[0].id}/select`, {
      method: 'POST',
      headers
    });
    assert.equal(selectResponse.status, 200);
    const plan = generation.plans[0];

    const coverageResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/inventory-coverage`, { headers });
    assert.equal(coverageResponse.status, 200);
    const coverage = await coverageResponse.json();
    assert.equal(coverage.items.find((item: { name: string }) => item.name === 'Arroz').missingQuantity, 1);
    assert.equal(coverage.items.find((item: { name: string }) => item.name === 'Zanahoria').covered, true);

    const adaptationResponse = await fetch(`http://127.0.0.1:${address.port}/recipes/adapt`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: plan.id, recipeId: recipe.id })
    });
    assert.equal(adaptationResponse.status, 201);
    const adapted = await adaptationResponse.json();
    assert.equal(adapted.title, 'Arroz con verduras adaptada');
    assert.deepEqual(adapted.ingredients, [{ name: 'Zanahoria', quantity: 3, unit: 'unidades' }]);
    assert.deepEqual(adapted.missingIngredients, [{ name: 'Arroz', quantity: 1, unit: 'tazas' }]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
