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

const createRecipe = async (serverPort: number, token: string, title: string, ingredientName: string) => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title,
      ingredients: [{ name: ingredientName, quantity: 2, unit: 'tazas' }],
      instructions: ['Preparar la receta']
    })
  });

  assert.equal(response.status, 201);
  return (await response.json()).id as string;
};

test('POST /plans/:planId/meals/:mealId/complete consumes inventory atomically', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'meal@noshy.com', 'Meal User');
    const headers = { Authorization: `Bearer ${token}` };
    const recipeId = await createRecipe(address.port, token, 'Arroz preparado', 'Arroz');

    await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Arroz', quantity: 2, unit: 'tazas' })
    });

    const generationResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 1, goals: ['maintain'], mealsPerDay: 1, recipeIds: [recipeId] })
    });
    const generation = await generationResponse.json();
    const plan = generation.plans[0];

    await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/select`, { method: 'POST', headers });

    const completeResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/meals/${plan.meals[0].id}/complete`, {
      method: 'POST',
      headers
    });
    assert.equal(completeResponse.status, 200);
    const completed = await completeResponse.json();
    assert.equal(completed.meal.id, plan.meals[0].id);
    assert.ok(completed.meal.completedAt);
    assert.deepEqual(completed.consumedInventory, [{ name: 'Arroz', quantity: 2, unit: 'tazas' }]);

    const inventoryResponse = await fetch(`http://127.0.0.1:${address.port}/inventory/items`, { headers });
    const inventory = await inventoryResponse.json();
    assert.equal(inventory[0].quantity, 0);

    const repeatedResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/meals/${plan.meals[0].id}/complete`, {
      method: 'POST',
      headers
    });
    assert.equal(repeatedResponse.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('meal completion does not mutate inventory when ingredients are missing', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'missing-meal@noshy.com', 'Missing Meal User');
    const recipeId = await createRecipe(address.port, token, 'Garbanzos', 'Garbanzos');
    const generationResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ days: 1, goals: ['maintain'], mealsPerDay: 1, recipeIds: [recipeId] })
    });
    const generation = await generationResponse.json();
    const plan = generation.plans[0];
    const headers = { Authorization: `Bearer ${token}` };
    await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/select`, { method: 'POST', headers });

    const completeResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/meals/${plan.meals[0].id}/complete`, {
      method: 'POST',
      headers
    });
    assert.equal(completeResponse.status, 409);
    const result = await completeResponse.json();
    assert.equal(result.code, 'INVENTORY_INSUFFICIENT');
    assert.deepEqual(result.missingIngredients, [{ name: 'Garbanzos', quantity: 2, unit: 'tazas' }]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
