import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForChat, ask, rephrase, MessagesClient } from '../src/core/ai/persona.js';
import { defaultConfig } from '../src/core/types.js';

function fakeClient(text: string) {
  const calls: any[] = [];
  const client: MessagesClient = {
    messages: { create: async (p: any) => { calls.push(p); return { content: [{ type: 'text', text }] }; } },
  };
  return { calls, client };
}

test('sanitizeForChat collapses newlines, trims, and keeps a URL intact', () => {
  const out = sanitizeForChat('  check this\n\nhttps://youtu.be/abc  ', 200);
  assert.equal(out, 'check this https://youtu.be/abc');
});

test('sanitizeForChat hard-caps length', () => {
  assert.equal(sanitizeForChat('abcdefgh', 5), 'abcde');
});

test('ask sends persona as system, question as user, max_tokens 150', async () => {
  const cfg = defaultConfig().ai; cfg.persona = 'be a goblin'; cfg.model = 'claude-haiku-4-5';
  const { calls, client } = fakeClient('grumble grumble');
  const out = await ask('what time is it', cfg, client);
  assert.equal(out, 'grumble grumble');
  assert.equal(calls[0].system, 'be a goblin');
  assert.equal(calls[0].model, 'claude-haiku-4-5');
  assert.equal(calls[0].max_tokens, 150);
  assert.equal(calls[0].messages[0].content, 'what time is it');
  assert.equal(calls[0].thinking, undefined);
});

test('rephrase instructs URL preservation and wires avoidLast', async () => {
  const cfg = defaultConfig().ai;
  const { calls, client } = fakeClient('New vid up: https://x.com/v');
  await rephrase('NEW VIDEO https://x.com/v', cfg, 'old wording', client);
  assert.match(calls[0].system, /URLs? exactly/i);
  assert.match(calls[0].messages[0].content, /Avoid repeating/);
  assert.match(calls[0].messages[0].content, /NEW VIDEO/);
});

test('ask rejects when the client throws', async () => {
  const cfg = defaultConfig().ai;
  const client: MessagesClient = { messages: { create: async () => { throw new Error('401'); } } };
  await assert.rejects(() => ask('hi', cfg, client), /401/);
});
