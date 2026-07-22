import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeUrl, exchangeCode, validate, SCOPES } from '../src/core/auth/oauth.js';

test('authorizeUrl includes client id, redirect and all scopes', () => {
  const url = authorizeUrl('cid', 'http://localhost:5173/callback');
  assert.match(url, /client_id=cid/);
  assert.match(url, /response_type=code/);
  for (const s of SCOPES) assert.ok(url.includes(encodeURIComponent(s)));
});

test('exchangeCode posts and returns tokens', async () => {
  const impl = (async () => new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r' }), { status: 200 })) as unknown as typeof fetch;
  const t = await exchangeCode('cid', 'sec', 'code', 'http://localhost/cb', impl);
  assert.deepEqual(t, { accessToken: 'a', refreshToken: 'r' });
});

test('validate returns login and user id', async () => {
  const impl = (async () => new Response(JSON.stringify({ login: 'streamer', user_id: '123' }), { status: 200 })) as unknown as typeof fetch;
  const v = await validate('tok', impl);
  assert.deepEqual(v, { login: 'streamer', userId: '123' });
});
