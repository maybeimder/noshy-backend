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

const createRecipe = async (serverPort: number, token: string, title: string) => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/recipes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      title,
      ingredients: [{ name: 'Arroz', quantity: 1, unit: 'taza' }],
      instructions: ['Cocinar el arroz']
    })
  });

  assert.equal(response.status, 201);
  return (await response.json()).id as string;
};

test('POST /plans/generate creates a plan and GET /plans returns it', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'plans@noshy.com', 'Plan User');
    const recipeId = await createRecipe(address.port, token, 'Arroz de prueba');

    const generateResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        days: 2,
        goals: ['maintain'],
        mealsPerDay: 2,
        recipeIds: [recipeId]
      })
    });

    assert.equal(generateResponse.status, 201);
    const generated = await generateResponse.json();
    assert.ok(generated.generationId);
    assert.equal(generated.plans.length, 3);
    assert.equal(generated.plans[0].days, 2);
    assert.ok(Array.isArray(generated.plans[0].meals));

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/plans`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list[0].days, 2);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('POST /shopping-list generates a shopping list from a selected plan', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'shopping@noshy.com', 'Shopping User');
    const recipeId = await createRecipe(address.port, token, 'Arroz para compras');

    const generateResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        days: 1,
        goals: ['maintain'],
        mealsPerDay: 2,
        recipeIds: [recipeId]
      })
    });

    const generation = await generateResponse.json();
    const plan = generation.plans[0];

    const selectResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(selectResponse.status, 200);

    const shoppingResponse = await fetch(`http://127.0.0.1:${address.port}/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        planId: plan.id
      })
    });

    assert.equal(shoppingResponse.status, 201);
    const shopping = await shoppingResponse.json();
    assert.ok(Array.isArray(shopping.items));
    assert.ok(shopping.items.length > 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('POST /plans/generate links recipes and shopping list aggregates their ingredients', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'linked-plan@noshy.com', 'Linked Plan User');
    const recipeResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'Lentejas rápidas',
        ingredients: [
          { name: 'Lentejas', quantity: 2, unit: 'tazas' },
          { name: 'Tomate', quantity: 1, unit: 'unidad' }
        ],
        instructions: ['Cocinar las lentejas']
      })
    });
    assert.equal(recipeResponse.status, 201);
    const recipe = await recipeResponse.json();

    const planResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        days: 1,
        goals: ['maintain'],
        mealsPerDay: 1,
        recipeIds: [recipe.id]
      })
    });

    assert.equal(planResponse.status, 201);
    const generation = await planResponse.json();
    const plan = generation.plans[0];
    assert.equal(plan.meals[0].recipeId, recipe.id);
    assert.equal(plan.meals[0].title, 'Lentejas rápidas');

    const selectResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${plan.id}/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(selectResponse.status, 200);

    const shoppingResponse = await fetch(`http://127.0.0.1:${address.port}/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ planId: plan.id })
    });

    assert.equal(shoppingResponse.status, 201);
    const shopping = await shoppingResponse.json();
    assert.deepEqual(shopping.items, [
      { name: 'Lentejas', quantity: 2, unit: 'tazas' },
      { name: 'Tomate', quantity: 1, unit: 'unidad' }
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('POST /plans/:id/select selects one alternative and discards the other candidates', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'selection@noshy.com', 'Selection User');
    const recipeId = await createRecipe(address.port, token, 'Receta seleccionable');
    const generationResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ days: 1, goals: ['maintain'], mealsPerDay: 1, recipeIds: [recipeId] })
    });
    const generation = await generationResponse.json();
    const selectedPlan = generation.plans[1];

    const selectResponse = await fetch(`http://127.0.0.1:${address.port}/plans/${selectedPlan.id}/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(selectResponse.status, 200);

    const generationListResponse = await fetch(
      `http://127.0.0.1:${address.port}/plans/generations/${generation.generationId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const generationList = await generationListResponse.json();
    assert.equal(generationList.plans.find((plan: { id: string }) => plan.id === selectedPlan.id).status, 'selected');
    assert.equal(generationList.plans.filter((plan: { status: string }) => plan.status === 'discarded').length, 2);

    const discardedPlan = generationList.plans.find((plan: { status: string }) => plan.status === 'discarded');
    const shoppingResponse = await fetch(`http://127.0.0.1:${address.port}/shopping-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ planId: discardedPlan.id })
    });
    assert.equal(shoppingResponse.status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('POST /plans creates a nutrition plan and GET /plans/active returns it', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'nutrition-plan@noshy.com', 'Nutrition User');
    const createResponse = await fetch(`http://127.0.0.1:${address.port}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        objective: 'gain_muscle',
        targets: {
          calories: 2400,
          carbohydratesGrams: 280,
          proteinGrams: 160,
          fatGrams: 80
        },
        restrictions: ['sin lactosa'],
        mealsPerDay: 4
      })
    });

    assert.equal(createResponse.status, 201);
    const plan = await createResponse.json();
    assert.equal(plan.objective, 'gain_muscle');
    assert.equal(plan.targets.proteinGrams, 160);

    const activeResponse = await fetch(`http://127.0.0.1:${address.port}/plans/active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(activeResponse.status, 200);
    const activePlan = await activeResponse.json();
    assert.equal(activePlan.id, plan.id);
    assert.deepEqual(activePlan.restrictions, ['sin lactosa']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
