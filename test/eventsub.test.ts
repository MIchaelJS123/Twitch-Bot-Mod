import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventSubClient, WSLike, Redemption } from '../src/core/connection/eventsub.js';
import { defaultConfig } from '../src/core/types.js';

function fakeSocket(): WSLike & { emit: (o: any) => void } {
  const s: any = { sent: [] as string[], onopen: null, onmessage: null, onclose: null, onerror: null };
  s.send = (d: string) => s.sent.push(d);
  s.close = () => {};
  s.emit = (o: any) => s.onmessage?.({ data: JSON.stringify(o) });
  return s;
}

function auth() { const a = defaultConfig().auth; a.broadcasterId = 'bid'; return a; }

test('welcome message triggers an EventSub subscription for the reward', () => {
  const sock = fakeSocket();
  const subs: any[] = [];
  const helix = { subscribeEventSub: async (...args: any[]) => { subs.push(args); } };
  const c = new EventSubClient(auth(), helix as any, () => sock);
  c.connect('rw1');
  sock.onopen?.();
  sock.emit({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'sess1' } } });
  assert.equal(subs.length, 1);
  assert.equal(subs[0][3], 'sess1');           // sessionId
  assert.equal(subs[0][2].reward_id, 'rw1');   // condition
});

test('notification emits a mapped Redemption', () => {
  const sock = fakeSocket();
  const helix = { subscribeEventSub: async () => {} };
  const c = new EventSubClient(auth(), helix as any, () => sock);
  const got: Redemption[] = [];
  c.onRedemption(r => got.push(r));
  c.connect('rw1');
  sock.emit({
    metadata: { message_type: 'notification' },
    payload: { event: { id: 'red1', reward: { id: 'rw1', title: 'Ask' }, user_input: 'why sky blue', user_name: 'Viewer' } },
  });
  assert.deepEqual(got, [{ id: 'red1', rewardId: 'rw1', userInput: 'why sky blue', userName: 'Viewer' }]);
});

test('keepalive is ignored (no throw, no redemption)', () => {
  const sock = fakeSocket();
  const c = new EventSubClient(auth(), { subscribeEventSub: async () => {} } as any, () => sock);
  const got: Redemption[] = [];
  c.onRedemption(r => got.push(r));
  c.connect('rw1');
  sock.emit({ metadata: { message_type: 'session_keepalive' }, payload: {} });
  assert.equal(got.length, 0);
});

test('a failed EventSub subscription does not crash and reports status', async () => {
  const sock = fakeSocket();
  const helix = { subscribeEventSub: async () => { throw new Error('409 duplicate'); } };
  const c = new EventSubClient(auth(), helix as any, () => sock);
  const statuses: string[] = [];
  c.onStatus(s => statuses.push(s));
  c.connect('rw1');
  sock.emit({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'sess1' } } });
  await new Promise(r => setImmediate(r));
  assert.ok(statuses.includes('subscribe-failed'));
});

test('a malformed notification payload does not throw or emit', () => {
  const sock = fakeSocket();
  const c = new EventSubClient(auth(), { subscribeEventSub: async () => {} } as any, () => sock);
  const got: Redemption[] = [];
  const statuses: string[] = [];
  c.onRedemption(r => got.push(r));
  c.onStatus(s => statuses.push(s));
  c.connect('rw1');
  sock.emit({ metadata: { message_type: 'notification' }, payload: { event: { id: 'x', user_input: 'q', user_name: 'V' } } });
  assert.equal(got.length, 0);
  assert.ok(statuses.includes('bad-message'));
});
