import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandRouter } from '../src/core/commands/router.js';
import { defaultConfig, ChatMessage, Config } from '../src/core/types.js';

function msg(text: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return { channel: 'c', username: 'viewer', displayName: 'V', userId: '1', messageId: 'm',
    message: text, isMod: false, isBroadcaster: false, isSubscriber: false, ...over };
}

function cfgWith(cmds: Config['commands']): Config {
  const c = defaultConfig(); c.commands = cmds; return c;
}

test('non-command message is ignored', async () => {
  const replies: string[] = [];
  const handled = await new CommandRouter({}).route(msg('just chatting'), defaultConfig(), t => replies.push(t));
  assert.equal(handled, false);
});

test('custom text command replies with {user} substituted', async () => {
  const replies: string[] = [];
  const cfg = cfgWith([{ trigger: '!hi', response: 'hello {user}', type: 'text', count: 0, cooldownSec: 0, permission: 'everyone' }]);
  await new CommandRouter({}).route(msg('!hi'), cfg, t => replies.push(t));
  assert.deepEqual(replies, ['hello V']);
});

test('counter command increments and substitutes {count}', async () => {
  const replies: string[] = [];
  const cfg = cfgWith([{ trigger: '!deaths', response: 'deaths: {count}', type: 'counter', count: 4, cooldownSec: 0, permission: 'everyone' }]);
  await new CommandRouter({}).route(msg('!deaths'), cfg, t => replies.push(t));
  assert.deepEqual(replies, ['deaths: 5']);
  assert.equal(cfg.commands[0].count, 5);
});

test('mod-only command blocked for non-mods', async () => {
  const replies: string[] = [];
  const cfg = cfgWith([{ trigger: '!secret', response: 'x', type: 'text', count: 0, cooldownSec: 0, permission: 'mod' }]);
  const handled = await new CommandRouter({}).route(msg('!secret'), cfg, t => replies.push(t));
  assert.equal(handled, false);
  assert.deepEqual(replies, []);
});

test('cooldown suppresses a second call', async () => {
  const replies: string[] = [];
  const cfg = cfgWith([{ trigger: '!hi', response: 'hey', type: 'text', count: 0, cooldownSec: 60, permission: 'everyone' }]);
  const r = new CommandRouter({});
  await r.route(msg('!hi'), cfg, t => replies.push(t));
  await r.route(msg('!hi'), cfg, t => replies.push(t));
  assert.deepEqual(replies, ['hey']);
});

test('builtin command runs with parsed args', async () => {
  const seen: string[] = [];
  const router = new CommandRouter({ poll: { permission: 'mod', handler: ctx => { seen.push(...ctx.args); } } });
  await router.route(msg('!poll a b c', { isMod: true }), defaultConfig(), () => {});
  assert.deepEqual(seen, ['a', 'b', 'c']);
});
