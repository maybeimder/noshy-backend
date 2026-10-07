import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { CommandBus, defineHandler } from './command-bus';

const double = defineHandler({
  name: 'math.double',
  schema: z.object({ n: z.number() }),
  requiresUser: false,
  execute: ({ data }) => data.n * 2
});

test('validates data with the DTO schema and executes the handler', async () => {
  const bus = new CommandBus().register(double);

  assert.deepEqual(await bus.dispatch({ name: 'math.double', data: { n: 4 } }), { status: 'handled', result: 8 });
});

test('invalid data returns the raw schema issues (same body as the HTTP 400) and never runs the handler', async () => {
  let calls = 0;
  const bus = new CommandBus().register(
    defineHandler({ name: 'x.run', schema: z.object({ n: z.number() }), requiresUser: false, execute: () => void calls++ })
  );

  const outcome = await bus.dispatch({ name: 'x.run', data: { n: 'no' } });

  assert.equal(outcome.status, 'invalid');
  assert.deepEqual(outcome.status === 'invalid' && outcome.issues[0].path, ['n']);
  assert.equal(calls, 0);
});

test('handlers require a user unless marked public, and check required params', async () => {
  const bus = new CommandBus().register(
    defineHandler({ name: 'secure.run', params: ['id'], execute: ({ userId, params }) => `${userId}:${params.id}` })
  );

  assert.deepEqual(await bus.dispatch({ name: 'secure.run', params: { id: '1' } }), { status: 'unauthorized' });
  const missing = await bus.dispatch({ name: 'secure.run', userId: 'u1' });
  assert.equal(missing.status, 'invalid');
  assert.deepEqual(await bus.dispatch({ name: 'secure.run', userId: 'u1', params: { id: '1' } }), { status: 'handled', result: 'u1:1' });
});

test('unknown handlers and duplicate registrations are reported', async () => {
  const bus = new CommandBus().register(double);

  assert.deepEqual(await bus.dispatch({ name: 'nope' }), { status: 'unknown_handler' });
  assert.throws(() => bus.register(double), /duplicado/);
});

test('a redelivered messageId is ignored, but a failed execution can be retried', async () => {
  let attempts = 0;
  let executed = 0;
  const bus = new CommandBus().register(
    defineHandler({
      name: 'flaky.run',
      requiresUser: false,
      execute: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('boom');
        executed += 1;
      }
    })
  );

  await assert.rejects(bus.dispatch({ name: 'flaky.run', messageId: 'm1' }), /boom/);
  assert.equal((await bus.dispatch({ name: 'flaky.run', messageId: 'm1' })).status, 'handled');
  assert.equal((await bus.dispatch({ name: 'flaky.run', messageId: 'm1' })).status, 'duplicate');
  assert.equal(executed, 1);
});
