import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moderate, hasBannedWord } from '../src/core/moderation/filters.js';
import { defaultConfig, ChatMessage } from '../src/core/types.js';

function msg(text: string): ChatMessage {
  return {
    channel: 'chan', username: 'viewer', displayName: 'Viewer', userId: '1',
    messageId: 'm1', message: text, isMod: false, isBroadcaster: false, isSubscriber: false,
  };
}

const mod = () => defaultConfig().moderation;

test('clean message passes', () => {
  assert.deepEqual(moderate(msg('hello everyone how are you'), mod()), { ok: true });
});

test('banned word is caught case-insensitively', () => {
  const cfg = mod(); cfg.bannedWords = ['badword'];
  const v = moderate(msg('this is BadWord here'), cfg);
  assert.equal(v.ok, false);
});

test('banned word only matches whole words', () => {
  const cfg = mod(); cfg.bannedWords = ['ass'];
  assert.deepEqual(moderate(msg('i saw a bass in the lake'), cfg), { ok: true });
});

test('excessive caps caught above threshold and length', () => {
  const cfg = mod(); cfg.capsPercent = 70; cfg.capsMinLength = 10;
  const v = moderate(msg('STOP SHOUTING RIGHT NOW'), cfg);
  assert.equal(v.ok, false);
});

test('short caps message is ignored', () => {
  const cfg = mod(); cfg.capsPercent = 70; cfg.capsMinLength = 10;
  assert.deepEqual(moderate(msg('OK GG'), cfg), { ok: true });
});

test('too many links caught', () => {
  const cfg = mod(); cfg.maxLinks = 1;
  const v = moderate(msg('http://a.com and http://b.com'), cfg);
  assert.equal(v.ok, false);
});

test('maxLinks -1 allows all links', () => {
  const cfg = mod(); cfg.maxLinks = -1;
  assert.deepEqual(moderate(msg('http://a.com http://b.com http://c.com'), cfg), { ok: true });
});

test('violation carries the default action', () => {
  const cfg = mod(); cfg.bannedWords = ['nope']; cfg.defaultAction = { type: 'ban' };
  const v = moderate(msg('nope'), cfg);
  assert.equal(v.ok, false);
  if (!v.ok) assert.deepEqual(v.action, { type: 'ban' });
});

test('excessive symbols caught above threshold', () => {
  const cfg = mod(); cfg.maxSymbolPercent = 50;
  const v = moderate(msg('@#$%^&*!!!! ~~~~'), cfg);
  assert.equal(v.ok, false);
});

test('normal text is not symbol spam', () => {
  const cfg = mod(); cfg.maxSymbolPercent = 50;
  assert.deepEqual(moderate(msg('hello there friends'), cfg), { ok: true });
});

test('maxSymbolPercent 0 disables symbol filter', () => {
  const cfg = mod(); cfg.maxSymbolPercent = 0;
  assert.deepEqual(moderate(msg('@#$%^&*~~~~####'), cfg), { ok: true });
});

test('first matching filter wins (banned word before caps)', () => {
  const cfg = mod(); cfg.bannedWords = ['stop']; cfg.capsPercent = 70; cfg.capsMinLength = 5;
  const v = moderate(msg('STOP SHOUTING NOW'), cfg);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.reason, /banned word/);
});

test('hasBannedWord matches whole words case-insensitively', () => {
  assert.equal(hasBannedWord('this is BadWord here', ['badword']), true);
  assert.equal(hasBannedWord('i saw a bass in the lake', ['ass']), false);
  assert.equal(hasBannedWord('all clear', []), false);
});
