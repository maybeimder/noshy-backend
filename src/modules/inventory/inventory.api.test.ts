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

test('POST /inventory/items registers inventory and GET returns it', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'inventory@noshy.com', 'Inventory User');

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name: 'Tomato',
        quantity: 2,
        unit: 'kg'
      })
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.name, 'Tomato');

    const listingResponse = await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(listingResponse.status, 200);
    const items = await listingResponse.json();
    assert.equal(items[0].name, 'Tomato');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('POST /recipes creates a recipe and GET returns it', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const token = await registerUser(address.port, 'recipes@noshy.com', 'Recipes User');

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'Tomato Salad',
        ingredients: [{ name: 'Tomato', quantity: 2, unit: 'kg' }],
        instructions: ['Wash the tomatoes', 'Cut them', 'Season and serve']
      })
    });

    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.title, 'Tomato Salad');
    assert.equal(created.ingredients[0].name, 'Tomato');

    const listResponse = await fetch(`http://127.0.0.1:${address.port}/recipes`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(listResponse.status, 200);
    const recipes = await listResponse.json();
    assert.equal(recipes[0].title, 'Tomato Salad');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('PATCH and DELETE /inventory/items/:id manage only the owner inventory', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const ownerToken = await registerUser(address.port, 'inventory-owner@noshy.com', 'Inventory Owner');
    const otherToken = await registerUser(address.port, 'inventory-other@noshy.com', 'Other User');
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

    const createResponse = await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Arroz', quantity: 2, unit: 'tazas' })
    });
    const item = await createResponse.json();

    const unauthorizedUpdate = await fetch(`http://127.0.0.1:${address.port}/inventory/items/${item.id}`, {
      method: 'PATCH',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 5 })
    });
    assert.equal(unauthorizedUpdate.status, 200);
    assert.equal((await unauthorizedUpdate.json()).quantity, 5);

    const otherDelete = await fetch(`http://127.0.0.1:${address.port}/inventory/items/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    assert.equal(otherDelete.status, 404);

    const ownerDelete = await fetch(`http://127.0.0.1:${address.port}/inventory/items/${item.id}`, {
      method: 'DELETE',
      headers: ownerHeaders
    });
    assert.equal(ownerDelete.status, 204);

    const listingResponse = await fetch(`http://127.0.0.1:${address.port}/inventory/items`, {
      headers: ownerHeaders
    });
    assert.deepEqual(await listingResponse.json(), []);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
