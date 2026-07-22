import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/core/types.js';

test('defaultConfig has moderation disabled and no commands', () => {
  const c = defaultConfig();
  assert.equal(c.moderation.enabled, false);
  assert.deepEqual(c.commands, []);
  assert.equal(c.polls.defaultDurationSec, 120);
});
