import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMessage, Timers } from '../src/core/timers/timers.js';
import { defaultConfig, TimerConfig } from '../src/core/types.js';

test('nextMessage rotates and wraps', () => {
  assert.deepEqual(nextMessage(['a', 'b'], 0), { text: 'a', nextIndex: 1 });
  assert.deepEqual(nextMessage(['a', 'b'], 1), { text: 'b', nextIndex: 0 });
});

function cfg(over: Partial<TimerConfig> = {}): TimerConfig {
  return { ...defaultConfig().timers, enabled: true, intervalMinutes: 10, minChatLines: 2, messages: ['one', 'two'], ...over };
}

test('tick does nothing until interval AND min chat lines are met', async () => {
  let clock = 0;
  const c = cfg();
  const out: string[] = [];
  const t = new Timers({ getConfig: () => c, emit: x => out.push(x), now: () => clock });
  await t.tick();                       // t=0, no chat lines
  clock = 11 * 60_000;                  // interval elapsed, but 0 chat lines
  await t.tick();
  assert.deepEqual(out, []);
  t.noteChatLine(); t.noteChatLine();   // meet min lines
  await t.tick();
  assert.deepEqual(out, ['one']);
  assert.equal(c.nextIndex, 1);
});

test('tick with aiRephrase uses rephrase, falling back to seed on error', async () => {
  let clock = 100 * 60_000;
  const c = cfg({ aiRephrase: true, minChatLines: 0 });
  const out: string[] = [];
  const rephrase = async (seed: string) => { if (seed === 'one') return 'ONE!!'; throw new Error('down'); };
  const t = new Timers({ getConfig: () => c, emit: x => out.push(x), rephrase, now: () => clock });
  await t.tick();                       // index 0 -> 'one' -> 'ONE!!'
  clock += 100 * 60_000;
  await t.tick();                       // index 1 -> 'two' -> rephrase throws -> raw 'two'
  assert.deepEqual(out, ['ONE!!', 'two']);
});
