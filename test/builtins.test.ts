import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBuiltins } from '../src/core/commands/builtins.js';
import { defaultConfig, ChatMessage } from '../src/core/types.js';

function ctx(text: string) {
  const msg: ChatMessage = { channel: 'c', username: 'streamer', displayName: 'S', userId: '9',
    messageId: 'm', message: text, isMod: false, isBroadcaster: true, isSubscriber: false };
  const replies: string[] = [];
  const args = text.trim().split(/\s+/).slice(1);
  return { c: { msg, args, config: defaultConfig(), reply: (t: string) => replies.push(t) }, replies };
}

test('!poll starts a poll and stores its id', async () => {
  let started: any = null;
  const active = { id: null as string | null };
  const polls = { start: async (t: string, ch: string[], d: number) => { started = { t, ch, d }; return { id: 'p1', title: t, status: 'ACTIVE', choices: [] }; } } as any;
  const b = buildBuiltins({ polls, moderator: {} as any, activePoll: active, save: () => {} });
  const { c } = ctx('!poll Best game? | Zelda | Mario | Metroid');
  await b['poll'].handler(c);
  assert.equal(started.t, 'Best game?');
  assert.deepEqual(started.ch, ['Zelda', 'Mario', 'Metroid']);
  assert.equal(active.id, 'p1');
});

test('!permit calls moderator.permit', async () => {
  let permitted = '';
  const mod = { permit: (u: string) => { permitted = u; } } as any;
  const b = buildBuiltins({ polls: {} as any, moderator: mod, activePoll: { id: null }, save: () => {} });
  const { c } = ctx('!permit SomeViewer');
  await b['permit'].handler(c);
  assert.equal(permitted, 'SomeViewer');
});
