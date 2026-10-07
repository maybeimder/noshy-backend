import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { configureAuthTokens, issueToken, usesEphemeralSecret, verifyToken } from './token';

const SECRET = 'un-secreto-de-pruebas-de-al-menos-32-caracteres';

test('without configuration it uses an ephemeral secret (tokens die on restart)', () => {
  assert.equal(usesEphemeralSecret(), true);
});

test('a signed token round-trips to the user id', async () => {
  configureAuthTokens({ secret: SECRET });
  const token = await issueToken('user-123');

  assert.match(token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(await verifyToken(token), 'user-123');
  assert.equal(usesEphemeralSecret(), false);
});

test('a tampered token is rejected', async () => {
  configureAuthTokens({ secret: SECRET });
  const [header, , signature] = (await issueToken('user-123')).split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'admin', iss: 'noshy', aud: 'noshy-api', exp: 9999999999 })).toString('base64url');

  assert.equal(await verifyToken(`${header}.${forgedPayload}.${signature}`), null);
});

test('a token signed with another secret is rejected', async () => {
  configureAuthTokens({ secret: 'otro-secreto-distinto-de-al-menos-32-caracteres' });
  const foreign = await issueToken('user-123');
  configureAuthTokens({ secret: SECRET });

  assert.equal(await verifyToken(foreign), null);
});

test('an expired token is rejected', async () => {
  configureAuthTokens({ secret: SECRET });
  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-123')
    .setIssuer('noshy')
    .setAudience('noshy-api')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(new TextEncoder().encode(SECRET));

  assert.equal(await verifyToken(expired), null);
});

test('the old predictable noshy_<id> tokens no longer work', async () => {
  configureAuthTokens({ secret: SECRET });
  assert.equal(await verifyToken('noshy_user-123'), null);
});
