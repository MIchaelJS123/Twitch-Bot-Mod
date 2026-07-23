import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/core/types.js';

test('defaultConfig has moderation disabled and no commands', () => {
  const c = defaultConfig();
  assert.equal(c.moderation.enabled, false);
  assert.deepEqual(c.commands, []);
  assert.equal(c.polls.defaultDurationSec, 120);
});

test('defaultConfig has AI, quotes, timers off by default', () => {
  const c = defaultConfig();
  assert.equal(c.ai.enabled, false);
  assert.equal(c.ai.model, 'claude-haiku-4-5');
  assert.equal(c.ai.reward, null);
  assert.deepEqual(c.quotes, []);
  assert.equal(c.timers.enabled, false);
  assert.equal(c.timers.nextIndex, 0);
  assert.equal(c.timers.aiRephrase, false);
});
