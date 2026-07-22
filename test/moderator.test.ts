import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Moderator } from '../src/core/moderation/moderator.js';
import { defaultConfig, ChatMessage } from '../src/core/types.js';

function msg(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    channel: 'c', username: 'viewer', displayName: 'V', userId: '1', messageId: 'm1',
    message: 'nope', isMod: false, isBroadcaster: false, isSubscriber: false, ...over,
  };
}

function fakeHelix() {
  const acts: string[] = [];
  return {
    acts,
    client: {
      deleteMessage: async () => { acts.push('delete'); },
      timeoutUser: async (_u: string, s: number) => { acts.push('timeout:' + s); },
      banUser: async () => { acts.push('ban'); },
    } as any,
  };
}

function modCfg() {
  const m = defaultConfig().moderation;
  m.enabled = true; m.bannedWords = ['nope']; m.defaultAction = { type: 'timeout', seconds: 10 };
  return m;
}

test('violation triggers the configured action', async () => {
  const h = fakeHelix();
  const acted = await new Moderator(h.client).handle(msg(), modCfg());
  assert.equal(acted, true);
  assert.deepEqual(h.acts, ['timeout:10']);
});

test('moderators are exempt', async () => {
  const h = fakeHelix();
  const acted = await new Moderator(h.client).handle(msg({ isMod: true }), modCfg());
  assert.equal(acted, false);
  assert.deepEqual(h.acts, []);
});

test('disabled moderation does nothing', async () => {
  const h = fakeHelix();
  const cfg = modCfg(); cfg.enabled = false;
  assert.equal(await new Moderator(h.client).handle(msg(), cfg), false);
});

test('permitted user is skipped once', async () => {
  const h = fakeHelix();
  const m = new Moderator(h.client);
  m.permit('viewer', 60);
  assert.equal(await m.handle(msg(), modCfg()), false);
});
