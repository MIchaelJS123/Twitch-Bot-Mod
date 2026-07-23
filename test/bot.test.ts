import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/core/config/store.js';
import { Bot, answerRedemption } from '../src/core/bot.js';
import { ChatMessage } from '../src/core/types.js';

function store() {
  const p = join(mkdtempSync(join(tmpdir(), 'tb-')), 'config.json');
  const s = new ConfigStore(p);
  const c = s.load();
  c.commands = [{ trigger: '!hi', response: 'hey {user}', type: 'text', count: 0, cooldownSec: 0, permission: 'everyone' }];
  s.save(c);
  return s;
}

function msg(text: string): ChatMessage {
  return { channel: 'c', username: 'v', displayName: 'V', userId: '1', messageId: 'm',
    message: text, isMod: false, isBroadcaster: false, isSubscriber: false };
}

test('dispatch routes a custom command to outgoing', async () => {
  const bot = new Bot(store());
  const out: string[] = [];
  bot.onOutgoing(t => out.push(t));
  await bot.dispatch(msg('!hi'));
  assert.deepEqual(out, ['hey V']);
});

test('dispatch persists a counter increment', async () => {
  const s = store();
  const c = s.get(); c.commands[0] = { trigger: '!d', response: '{count}', type: 'counter', count: 0, cooldownSec: 0, permission: 'everyone' };
  s.save(c);
  const bot = new Bot(s);
  bot.onOutgoing(() => {});
  await bot.dispatch(msg('!d'));
  assert.equal(new ConfigStore((s as any).path).load().commands[0].count, 1);
});

test('answerRedemption emits the AI reply and fulfills on success', async () => {
  const out: string[] = [];
  let fulfilled = false, refunded = false;
  await answerRedemption(
    { id: 'r', rewardId: 'rw', userInput: 'hi', userName: 'V' },
    { ask: async q => `echo:${q}`, emit: t => out.push(t), fulfill: async () => { fulfilled = true; }, refund: async () => { refunded = true; } },
  );
  assert.deepEqual(out, ['echo:hi']);
  assert.equal(fulfilled, true);
  assert.equal(refunded, false);
});

test('answerRedemption refunds and posts a fallback on AI error', async () => {
  const out: string[] = [];
  let fulfilled = false, refunded = false;
  await answerRedemption(
    { id: 'r', rewardId: 'rw', userInput: 'hi', userName: 'V' },
    { ask: async () => { throw new Error('rate limit'); }, emit: t => out.push(t), fulfill: async () => { fulfilled = true; }, refund: async () => { refunded = true; } },
  );
  assert.equal(fulfilled, false);
  assert.equal(refunded, true);
  assert.match(out.join(' '), /refunded/i);
});
