import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DEBUG_LOGS_TOKEN, getEnv } from './env';

test('getEnv applies safe defaults (debug logs ON with default token)', () => {
  assert.deepEqual(getEnv({}), {
    port: 3000,
    corsOrigin: '*',
    jsonBodyLimit: '1mb',
    debugLogsEnabled: true,
    debugLogsToken: DEFAULT_DEBUG_LOGS_TOKEN
  });
});

test('getEnv parses configured values', () => {
  assert.deepEqual(getEnv({ PORT: '4000', CORS_ORIGIN: 'http://localhost:5173', JSON_BODY_LIMIT: '2mb' }), {
    port: 4000,
    corsOrigin: 'http://localhost:5173',
    jsonBodyLimit: '2mb',
    debugLogsEnabled: true,
    debugLogsToken: DEFAULT_DEBUG_LOGS_TOKEN
  });
});

test('getEnv can disable debug logs and override the token', () => {
  const environment = getEnv({ DEBUG_LOGS_ENABLED: 'false', DEBUG_LOGS_TOKEN: 'otro-token-largo-123456' });
  assert.equal(environment.debugLogsEnabled, false);
  assert.equal(environment.debugLogsToken, 'otro-token-largo-123456');
  assert.equal(getEnv({ DEBUG_LOGS_ENABLED: '0' }).debugLogsEnabled, false);
  assert.equal(getEnv({ DEBUG_LOGS_ENABLED: 'off' }).debugLogsEnabled, false);
});

test('getEnv reads an optional RabbitMQ URL and rejects non-AMQP URLs', () => {
  assert.equal(getEnv({ RABBITMQ_URL: 'amqp://guest:guest@localhost:5672' }).rabbitmqUrl, 'amqp://guest:guest@localhost:5672');
  assert.throws(() => getEnv({ RABBITMQ_URL: 'http://localhost' }), /amqp/);
});

test('getEnv reads an optional Postgres URL and rejects other schemes', () => {
  assert.equal(getEnv({ DATABASE_URL: 'postgres://noshy:noshy@localhost:5433/noshy' }).databaseUrl, 'postgres://noshy:noshy@localhost:5433/noshy');
  assert.throws(() => getEnv({ DATABASE_URL: 'mysql://localhost' }), /postgres/);
});

test('getEnv reads JWT settings and rejects weak secrets', () => {
  const secret = 'x'.repeat(32);
  assert.deepEqual(
    { jwtSecret: getEnv({ JWT_SECRET: secret }).jwtSecret, jwtExpiresIn: getEnv({ JWT_EXPIRES_IN: '12h' }).jwtExpiresIn },
    { jwtSecret: secret, jwtExpiresIn: '12h' }
  );
  assert.throws(() => getEnv({ JWT_SECRET: 'corto' }), /32 caracteres/);
  assert.throws(() => getEnv({ JWT_EXPIRES_IN: 'mañana' }), /JWT_EXPIRES_IN/);
});

test('getEnv reads the OpenRouter key and a comma-separated model list', () => {
  const environment = getEnv({ OPENROUTER_API_KEY: 'sk-or-test', OPENROUTER_MODEL: 'a:free, b:free' });
  assert.equal(environment.openRouterApiKey, 'sk-or-test');
  assert.deepEqual(environment.openRouterModels, ['a:free', 'b:free']);
});

test('getEnv treats empty values (KEY= in .env) as not defined', () => {
  assert.deepEqual(getEnv({ JWT_SECRET: '', DATABASE_URL: '  ', OPENROUTER_API_KEY: '' }), {
    port: 3000,
    corsOrigin: '*',
    jsonBodyLimit: '1mb',
    debugLogsEnabled: true,
    debugLogsToken: DEFAULT_DEBUG_LOGS_TOKEN
  });
});

test('getEnv rejects invalid ports', () => {
  assert.throws(() => getEnv({ PORT: '0' }), /Configuración de entorno inválida/);
});
