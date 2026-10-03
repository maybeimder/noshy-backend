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

test('POST /plans creates a nutrition plan and GET /plans/active returns it', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'nutrition-plan@noshy.com', 'Nutrition User');
    const headers = { Authorization: `Bearer ${token}` };
    const body = {
      objective: 'gain_muscle',
      targets: {
        calories: 2400,
        carbohydratesGrams: 280,
        proteinGrams: 160,
        fatGrams: 80
      },
      restrictions: ['sin lactosa'],
      mealsPerDay: 4
    };

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/plans`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    assert.equal(createResponse.status, 201);
    const plan = await createResponse.json();
    assert.equal(plan.objective, 'gain_muscle');
    assert.equal(plan.targets.proteinGrams, 160);

    const activeResponse = await fetch(`http://127.0.0.1:${address.port}/plans/active`, { headers });
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

test('PUT /plans/active updates the nutritional targets without creating a second active plan', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'nutrition-update@noshy.com', 'Nutrition Update User');
    const headers = { Authorization: `Bearer ${token}` };
    const createResponse = await fetch(`http://127.0.0.1:${address.port}/plans`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'maintain', targets: { calories: 2000 } })
    });
    const created = await createResponse.json();

    const updateResponse = await fetch(`http://127.0.0.1:${address.port}/plans/active`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'burn_fat', targets: { calories: 1800, proteinGrams: 140 } })
    });

    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.id, created.id);
    assert.equal(updated.objective, 'burn_fat');
    assert.equal(updated.targets.calories, 1800);

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/plans/nutrition`, { headers });
    const plans = await listResponse.json();
    assert.equal(plans.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
