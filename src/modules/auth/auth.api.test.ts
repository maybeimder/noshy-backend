import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createServer } from '../../infrastructure/http/server';

test('POST /auth/register creates a user and returns a token', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ana',
        email: 'ana@noshy.com',
        password: 'StrongPass1!'
      })
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.user.email, 'ana@noshy.com');
    assert.equal(body.user.name, 'Ana');
    assert.match(body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/, 'debe ser un JWT (header.payload.firma)');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('GET /auth/me requires a valid token', async () => {
  const server = createServer().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  try {
    const register = await fetch(`http://127.0.0.1:${address.port}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Luis',
        email: 'luis@noshy.com',
        password: 'StrongPass1!'
      })
    });

    const createdUser = await register.json();

    const response = await fetch(`http://127.0.0.1:${address.port}/auth/me`, {
      headers: { Authorization: `Bearer ${createdUser.token}` }
    });

    assert.equal(response.status, 200);
    const profile = await response.json();
    assert.equal(profile.email, 'luis@noshy.com');
    assert.equal(profile.name, 'Luis');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
