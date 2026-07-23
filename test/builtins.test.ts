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

test('!addquote stores a quote and persists', async () => {
  let saved = 0;
  const b = buildBuiltins({ polls: {} as any, moderator: {} as any, activePoll: { id: null }, save: () => { saved++; } });
  const { c } = ctx('!addquote stream went great today');
  await b['addquote'].handler(c);
  assert.equal(c.config.quotes.length, 1);
  assert.equal(c.config.quotes[0].text, 'stream went great today');
  assert.equal(saved, 1);
});

test('!quote <id> returns that quote', async () => {
  const b = buildBuiltins({ polls: {} as any, moderator: {} as any, activePoll: { id: null }, save: () => {} });
  const { c, replies } = ctx('!quote 1');
  c.config.quotes = [{ id: 1, text: 'hello world', addedBy: 'S', addedAt: 'now' }];
  await b['quote'].handler({ ...c, args: ['1'] });
  assert.match(replies.join(' '), /hello world/);
});

test('!delquote removes by id', async () => {
  const b = buildBuiltins({ polls: {} as any, moderator: {} as any, activePoll: { id: null }, save: () => {} });
  const { c } = ctx('!delquote 1');
  c.config.quotes = [{ id: 1, text: 'x', addedBy: 'S', addedAt: 'now' }];
  await b['delquote'].handler({ ...c, args: ['1'] });
  assert.equal(c.config.quotes.length, 0);
});

test('!quote on empty list replies gracefully', async () => {
  const b = buildBuiltins({ polls: {} as any, moderator: {} as any, activePoll: { id: null }, save: () => {} });
  const { c, replies } = ctx('!quote');
  await b['quote'].handler(c);
  assert.match(replies.join(' '), /no quotes/i);
});
