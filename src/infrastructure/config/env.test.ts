import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEnv } from './env';

test('getEnv applies safe defaults', () => {
  assert.deepEqual(getEnv({}), {
    port: 3000,
    corsOrigin: '*',
    jsonBodyLimit: '1mb'
  });
});

test('getEnv parses configured values', () => {
  assert.deepEqual(getEnv({ PORT: '4000', CORS_ORIGIN: 'http://localhost:5173', JSON_BODY_LIMIT: '2mb' }), {
    port: 4000,
    corsOrigin: 'http://localhost:5173',
    jsonBodyLimit: '2mb'
  });
});

test('getEnv rejects invalid ports', () => {
  assert.throws(() => getEnv({ PORT: '0' }), /Configuración de entorno inválida/);
});
