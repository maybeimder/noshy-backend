import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignChefAgent, DietType, restoreChefAgent } from './Agents';
import { KetoAgent } from './agents/KetoAgent';
import { VeganAgent } from './agents/VeganAgent';

test('the registry returns the concrete agent for each diet type', () => {
  assert.ok(assignChefAgent(DietType.keto) instanceof KetoAgent);
  assert.ok(assignChefAgent(DietType.vegan) instanceof VeganAgent);
  assert.equal(assignChefAgent(DietType.economic).agentName, 'BudgetChef');
});

test('every call creates a new independent agent (1:1 per user)', () => {
  const first = assignChefAgent(DietType.keto);
  const second = assignChefAgent(DietType.keto);
  first.learn({ action: 'Favorited a cauliflower recipe' });

  assert.notEqual(first, second);
  assert.equal(second.interactionHistory.length, 0);
});

test('agents specialize plans and substitutions', () => {
  assert.equal(assignChefAgent(DietType.keto).suggestSubstitution('rice', []), 'grated cauliflower');
  assert.equal(assignChefAgent(DietType.vegan).suggestSubstitution('milk', []), 'oat milk');
  assert.match(assignChefAgent(DietType.economic).generatePlan({ name: 'Charlie', weeklyBudget: 30000 }), /30000/);
});

test('an unknown diet type is rejected', () => {
  assert.throws(() => assignChefAgent('paleo' as DietType), /not found/);
});

test('event sourcing: an agent is restored by replaying its history', () => {
  const history = [
    { action: 'Rejected recipe containing honey', detail: 'honey' },
    { action: 'Favorited a cauliflower recipe', detail: 'cauliflower' }
  ];

  const agent = restoreChefAgent(DietType.vegan, history);

  assert.ok(agent instanceof VeganAgent);
  assert.deepEqual(agent.interactionHistory, history);
});
