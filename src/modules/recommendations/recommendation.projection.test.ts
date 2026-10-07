import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedbackRecordedEvent } from '../feedback/events/feedback.events';
import type { FeedbackEntry } from '../feedback/feedback.model';
import { RecommendationEngine } from './events/recommendations.observers';
import { RecommendationProjection } from './recommendation.projection';

const entry = (overrides: Partial<FeedbackEntry>): FeedbackEntry => ({
  id: 'f1',
  userId: 'u1',
  sessionId: 's1',
  targetType: 'recipe',
  targetId: 'r1',
  targetName: 'Quinoa',
  eventType: 'selected',
  createdAt: new Date().toISOString(),
  ...overrides
});

test('RecommendationEngine (Observer) projects feedback events and ignores duplicates by eventId', async () => {
  const engine = new RecommendationEngine();
  const prepared = new FeedbackRecordedEvent({ userId: 'u1', entry: entry({ eventType: 'prepared' }) });
  const repeated = new FeedbackRecordedEvent({ userId: 'u1', entry: entry({ eventType: 'repeated' }) });

  await engine.update(prepared, 'u1');
  await engine.update(prepared, 'u1'); // reentrega at-least-once
  await engine.update(repeated, 'u1');

  const [top] = engine.topFor('u1');
  assert.equal(top.targetName, 'Quinoa');
  assert.equal(top.score, 5);
});

test('reset() clears the projection so it can be rebuilt by replay', async () => {
  const engine = new RecommendationEngine();
  const event = new FeedbackRecordedEvent({ userId: 'u1', entry: entry({ eventType: 'prepared' }) });
  await engine.update(event, 'u1');

  engine.reset();
  assert.deepEqual(engine.topFor('u1'), []);

  await engine.update(event, 'u1');
  assert.equal(engine.topFor('u1')[0].score, 2);
});

test('discarded feedback drops a target out of the recommendations', () => {
  const projection = new RecommendationProjection();
  projection.apply(entry({ eventType: 'selected' }));
  projection.apply(entry({ eventType: 'discarded' }));
  assert.deepEqual(projection.topFor('u1'), []);
});

test('scores are isolated per user and ranked', () => {
  const projection = new RecommendationProjection();
  projection.apply(entry({ targetId: 'a', targetName: 'A', eventType: 'selected' }));
  projection.apply(entry({ targetId: 'b', targetName: 'B', eventType: 'repeated' }));
  projection.apply(entry({ userId: 'u2', targetId: 'c', targetName: 'C', eventType: 'prepared' }));

  assert.deepEqual(projection.topFor('u1').map((score) => score.targetName), ['B', 'A']);
  assert.deepEqual(projection.topFor('u2').map((score) => score.targetName), ['C']);
});
