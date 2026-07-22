import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HelixClient, TokenProvider } from '../src/core/connection/helix.js';

function fakeTp(): TokenProvider {
  return {
    getToken: () => 'tok', getClientId: () => 'cid', getBroadcasterId: () => 'bid',
    onUnauthorized: async () => false,
  };
}

// Records the last request and returns a canned response.
function recorder(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('banUser POSTs to the moderation endpoint with the user id', async () => {
  const r = recorder(200, { data: [{}] });
  const h = new HelixClient(fakeTp(), r.impl);
  await h.banUser('42', 'spam');
  assert.match(r.calls[0].url, /helix\/moderation\/bans\?broadcaster_id=bid&moderator_id=bid/);
  assert.equal(r.calls[0].init.method, 'POST');
  const sent = JSON.parse(r.calls[0].init.body as string);
  assert.equal(sent.data.user_id, '42');
});

test('timeoutUser includes duration', async () => {
  const r = recorder(200, { data: [{}] });
  const h = new HelixClient(fakeTp(), r.impl);
  await h.timeoutUser('42', 30);
  const sent = JSON.parse(r.calls[0].init.body as string);
  assert.equal(sent.data.duration, 30);
});

test('createPoll maps title and choices', async () => {
  const r = recorder(200, { data: [{ id: 'p1', title: 'Q', status: 'ACTIVE',
    choices: [{ title: 'A', votes: 0 }, { title: 'B', votes: 0 }] }] });
  const h = new HelixClient(fakeTp(), r.impl);
  const poll = await h.createPoll('Q', ['A', 'B'], 120);
  assert.equal(poll.id, 'p1');
  const sent = JSON.parse(r.calls[0].init.body as string);
  assert.deepEqual(sent.choices, [{ title: 'A' }, { title: 'B' }]);
  assert.equal(sent.duration, 120);
});

test('401 triggers onUnauthorized and retries once', async () => {
  let refreshed = false;
  const tp: TokenProvider = { ...fakeTp(), onUnauthorized: async () => { refreshed = true; return true; } };
  let call = 0;
  const impl = (async () => {
    call++;
    return new Response('{}', { status: call === 1 ? 401 : 200 });
  }) as unknown as typeof fetch;
  const h = new HelixClient(tp, impl);
  await h.deleteMessage('m1');
  assert.equal(refreshed, true);
  assert.equal(call, 2);
});

test('unrecoverable 401 (no refresh) throws', async () => {
  const tp = { ...fakeTp(), onUnauthorized: async () => false };
  const r = recorder(401, { error: 'Unauthorized', status: 401, message: 'invalid token' });
  const h = new HelixClient(tp, r.impl);
  await assert.rejects(() => h.banUser('42'), /Helix 401/);
});

test('second 401 after a refresh still throws', async () => {
  let refreshed = false;
  const tp = { ...fakeTp(), onUnauthorized: async () => { refreshed = true; return true; } };
  const r = recorder(401, { error: 'Unauthorized' }); // always 401
  const h = new HelixClient(tp, r.impl);
  await assert.rejects(() => h.deleteMessage('m1'), /Helix 401/);
  assert.equal(refreshed, true);
});
