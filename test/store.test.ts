import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/core/config/store.js';

function tmpPath() {
  return join(mkdtempSync(join(tmpdir(), 'tb-')), 'config.json');
}

test('load returns defaults when file is missing', () => {
  const s = new ConfigStore(tmpPath());
  assert.equal(s.load().moderation.enabled, false);
});

test('save then load round-trips', () => {
  const p = tmpPath();
  const s = new ConfigStore(p);
  const c = s.load();
  c.polls.defaultDurationSec = 300;
  s.save(c);
  assert.equal(new ConfigStore(p).load().polls.defaultDurationSec, 300);
});

test('corrupt file backs up and returns defaults', () => {
  const p = tmpPath();
  writeFileSync(p, '{ not valid json');
  const s = new ConfigStore(p);
  assert.equal(s.load().moderation.enabled, false);
  assert.ok(existsSync(p + '.bak'));
});

test('subscribe fires on save and unsubscribe stops it', () => {
  const s = new ConfigStore(tmpPath());
  s.load();
  let calls = 0;
  const off = s.subscribe(() => { calls++; });
  s.save(s.get());
  off();
  s.save(s.get());
  assert.equal(calls, 1);
});
