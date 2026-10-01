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

test('POST /plans/generate creates a plan and GET /plans returns it', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'plans@noshy.com', 'Plan User');

    const generateResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        days: 2,
        goals: ['maintain'],
        mealsPerDay: 2
      })
    });

    assert.equal(generateResponse.status, 201);
    const generated = await generateResponse.json();
    assert.equal(generated.days, 2);
    assert.ok(Array.isArray(generated.meals));

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

    const generateResponse = await fetch(`http://127.0.0.1:${address.port}/plans/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        days: 1,
        goals: ['maintain'],
        mealsPerDay: 2
      })
    });

    const plan = await generateResponse.json();

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
