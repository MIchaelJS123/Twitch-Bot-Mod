import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersion } from '../src/core/version.js';

test('getVersion returns the package version string', () => {
  assert.equal(getVersion(), '0.1.0');
});
