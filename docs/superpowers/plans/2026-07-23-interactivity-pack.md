# Interactivity Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI personality bot (triggered by a Channel Points redemption), a quotes system, and rotating timed messages (optionally AI-rephrased) to the existing TwitchBot.

**Architecture:** New units bolt onto the existing core: an `ai/persona.ts` Claude wrapper, a `connection/eventsub.ts` WebSocket client for redemptions, Helix methods for reward/redemption management, a `timers/timers.ts` runner, quote built-in commands, and three dashboard tabs. Everything routes through the existing `dispatch()`/config/chat plumbing. All new features default OFF.

**Tech Stack:** Node.js 24 · TypeScript (ESM) · `@anthropic-ai/sdk` (Claude, model `claude-haiku-4-5`) · Twitch EventSub WebSocket · native `fetch` (Helix) · Node built-in `node:test`.

## Global Constraints

- **ESM** with `.js` extensions on relative imports (TS requirement). `"type": "module"`.
- **Tests:** `node:test` + `node:assert/strict` via `tsx` only. No Jest/Vitest.
- **Core purity:** nothing under `src/core/` imports `electron`.
- **Native `fetch`** for all Helix calls — no axios/node-fetch.
- **Claude:** default model `claude-haiku-4-5`; `max_tokens` = 150; **no `thinking` param**; use the official `@anthropic-ai/sdk` (never raw HTTP).
- **Only one new runtime dependency:** `@anthropic-ai/sdk`. EventSub uses the Node 22+ global `WebSocket` (do NOT add `ws`).
- **New OAuth scope:** `channel:manage:redemptions` (added to the existing `SCOPES`).
- **Reward ownership:** the bot creates the reward with `is_user_input_required: true` (Twitch only lets an app manage redemptions for rewards it created).
- **Rephrase must preserve URLs verbatim** — the system prompt mandates it.
- **All new features default OFF** so an un-configured install equals the base bot.
- **Injectable clients:** persona takes a `MessagesClient`, EventSub takes a socket factory, so both are unit-testable offline.

---

### Task 1: Config types for AI, quotes, timers

**Files:**
- Modify: `src/core/types.ts`
- Test: `test/types.test.ts` (extend)

**Interfaces:**
- Consumes: existing `Config`, `defaultConfig`.
- Produces: `AIConfig`, `Quote`, `TimerConfig`; `Config` gains `ai`, `quotes`, `timers`; `defaultConfig()` returns them (all OFF).

- [ ] **Step 1: Add the failing test** — append to `test/types.test.ts`

```ts
test('defaultConfig has AI, quotes, timers off by default', () => {
  const c = defaultConfig();
  assert.equal(c.ai.enabled, false);
  assert.equal(c.ai.model, 'claude-haiku-4-5');
  assert.equal(c.ai.reward, null);
  assert.deepEqual(c.quotes, []);
  assert.equal(c.timers.enabled, false);
  assert.equal(c.timers.nextIndex, 0);
  assert.equal(c.timers.aiRephrase, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `c.ai` is undefined.

- [ ] **Step 3: Add the interfaces to `src/core/types.ts`** (after the existing `ModerationConfig`/`CustomCommand` interfaces, before `Config`)

```ts
export interface AIConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  persona: string;
  maxReplyChars: number;
  cooldownSec: number;
  reward: { id: string; title: string; cost: number } | null;
}

export interface Quote {
  id: number;
  text: string;
  addedBy: string;
  addedAt: string;
}

export interface TimerConfig {
  enabled: boolean;
  intervalMinutes: number;
  minChatLines: number;
  aiRephrase: boolean;
  messages: string[];
  nextIndex: number;
}
```

- [ ] **Step 4: Extend the `Config` interface** in `src/core/types.ts` — add three fields to the existing interface:

```ts
  ai: AIConfig;
  quotes: Quote[];
  timers: TimerConfig;
```

- [ ] **Step 5: Extend `defaultConfig()`** in `src/core/types.ts` — add three properties to the returned object (after `polls`):

```ts
    ai: {
      enabled: false,
      apiKey: '',
      model: 'claude-haiku-4-5',
      persona: 'You are a witty Twitch chat bot. Keep answers short, fun, and friendly.',
      maxReplyChars: 200,
      cooldownSec: 10,
      reward: null,
    },
    quotes: [],
    timers: {
      enabled: false,
      intervalMinutes: 10,
      minChatLines: 5,
      aiRephrase: false,
      messages: [],
      nextIndex: 0,
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all prior + the new test).

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts test/types.test.ts
git commit -m "feat: add AI, quotes, timers config types and defaults"
```

---

### Task 2: AI module (`ai/persona.ts`)

**Files:**
- Modify: `package.json` (add `@anthropic-ai/sdk`)
- Create: `src/core/ai/persona.ts`, `test/persona.test.ts`

**Interfaces:**
- Consumes: `AIConfig` from types.
- Produces:
  - `interface MessagesClient { messages: { create(params: any): Promise<{ content: Array<{ type: string; text?: string }> }> } }`
  - `function makeClient(apiKey: string): MessagesClient`
  - `function sanitizeForChat(text: string, maxChars: number): string`
  - `function ask(question: string, cfg: AIConfig, client: MessagesClient): Promise<string>`
  - `function rephrase(seed: string, cfg: AIConfig, avoidLast: string | undefined, client: MessagesClient): Promise<string>`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/sdk`
Expected: adds `@anthropic-ai/sdk` to `dependencies`.

- [ ] **Step 2: Write the failing test** — `test/persona.test.ts`

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `../src/core/ai/persona.js`.

- [ ] **Step 4: Create `src/core/ai/persona.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { AIConfig } from '../types.js';

export interface MessagesClient {
  messages: {
    create(params: any): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export function makeClient(apiKey: string): MessagesClient {
  return new Anthropic({ apiKey }) as unknown as MessagesClient;
}

export function sanitizeForChat(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxChars ? oneLine.slice(0, maxChars).trimEnd() : oneLine;
}

async function complete(client: MessagesClient, model: string, system: string, user: string, maxChars: number): Promise<string> {
  const res = await client.messages.create({
    model,
    max_tokens: 150,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.find(b => b.type === 'text')?.text ?? '';
  return sanitizeForChat(text, maxChars);
}

export function ask(question: string, cfg: AIConfig, client: MessagesClient): Promise<string> {
  return complete(client, cfg.model, cfg.persona, question, cfg.maxReplyChars);
}

const REPHRASE_SYSTEM =
  "You rewrite a streamer's announcement into one short, fresh Twitch chat message (under 200 characters). " +
  'Copy any URLs exactly and unchanged. Vary the wording each time. Output only the message — no quotes, no preamble.';

export function rephrase(seed: string, cfg: AIConfig, avoidLast: string | undefined, client: MessagesClient): Promise<string> {
  const system = cfg.persona ? `${REPHRASE_SYSTEM}\nVoice: ${cfg.persona}` : REPHRASE_SYSTEM;
  const user = avoidLast ? `${seed}\n\nAvoid repeating this exact wording: ${avoidLast}` : seed;
  return complete(client, cfg.model, system, user, cfg.maxReplyChars);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (5 new tests).

- [ ] **Step 6: Type-check compiles**

Run: `npm run build`
Expected: clean tsc.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/core/ai/persona.ts test/persona.test.ts
git commit -m "feat: add Claude persona module (ask + rephrase) with injectable client"
```

---

### Task 3: OAuth scope for redemptions

**Files:**
- Modify: `src/core/auth/oauth.ts`
- Test: `test/oauth.test.ts` (extend)

**Interfaces:**
- Consumes/Produces: `SCOPES` gains `channel:manage:redemptions`.

- [ ] **Step 1: Add the failing test** — append to `test/oauth.test.ts`

```ts
test('SCOPES includes channel:manage:redemptions', () => {
  assert.ok(SCOPES.includes('channel:manage:redemptions'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — scope not present.

- [ ] **Step 3: Add the scope** in `src/core/auth/oauth.ts` — add one entry to the `SCOPES` array:

```ts
  'channel:manage:redemptions',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (the `authorizeUrl` scope test and the new one).

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/oauth.ts test/oauth.test.ts
git commit -m "feat: request channel:manage:redemptions scope"
```

---

### Task 4: Helix reward + redemption + EventSub methods

**Files:**
- Modify: `src/core/connection/helix.ts`
- Test: `test/helix.test.ts` (extend)

**Interfaces:**
- Consumes: existing `HelixClient`, `TokenProvider`.
- Produces on `HelixClient`:
  - `createCustomReward(title: string, cost: number, prompt: string): Promise<{ id: string }>`
  - `updateRedemptionStatus(rewardId: string, redemptionId: string, status: 'FULFILLED' | 'CANCELED'): Promise<void>`
  - `subscribeEventSub(type: string, version: string, condition: Record<string, string>, sessionId: string): Promise<void>`

- [ ] **Step 1: Write the failing test** — append to `test/helix.test.ts`

```ts
test('createCustomReward posts title, cost, and requires user input', async () => {
  const r = recorder(200, { data: [{ id: 'rw1' }] });
  const h = new HelixClient(fakeTp(), r.impl);
  const reward = await h.createCustomReward('Ask the Bot', 500, 'Type your question');
  assert.equal(reward.id, 'rw1');
  assert.match(r.calls[0].url, /channel_points\/custom_rewards\?broadcaster_id=bid/);
  const body = JSON.parse(r.calls[0].init.body as string);
  assert.equal(body.title, 'Ask the Bot');
  assert.equal(body.cost, 500);
  assert.equal(body.is_user_input_required, true);
});

test('updateRedemptionStatus PATCHes the redemption with status', async () => {
  const r = recorder(200, { data: [{}] });
  const h = new HelixClient(fakeTp(), r.impl);
  await h.updateRedemptionStatus('rw1', 'red1', 'FULFILLED');
  assert.equal(r.calls[0].init.method, 'PATCH');
  assert.match(r.calls[0].url, /reward_id=rw1/);
  assert.match(r.calls[0].url, /&id=red1/);
  assert.equal(JSON.parse(r.calls[0].init.body as string).status, 'FULFILLED');
});

test('subscribeEventSub posts a websocket-transport subscription', async () => {
  const r = recorder(200, { data: [{}] });
  const h = new HelixClient(fakeTp(), r.impl);
  await h.subscribeEventSub('channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: 'bid', reward_id: 'rw1' }, 'sess1');
  const body = JSON.parse(r.calls[0].init.body as string);
  assert.equal(body.type, 'channel.channel_points_custom_reward_redemption.add');
  assert.equal(body.transport.method, 'websocket');
  assert.equal(body.transport.session_id, 'sess1');
  assert.equal(body.condition.reward_id, 'rw1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — methods not defined.

- [ ] **Step 3: Add the methods** to the `HelixClient` class in `src/core/connection/helix.ts` (after `endPoll`)

```ts
  async createCustomReward(title: string, cost: number, prompt: string): Promise<{ id: string }> {
    const url = `${BASE}/channel_points/custom_rewards?broadcaster_id=${this.bid()}`;
    const res = await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ title, cost, prompt, is_user_input_required: true }),
    });
    return (await res.json()).data[0];
  }

  async updateRedemptionStatus(rewardId: string, redemptionId: string, status: 'FULFILLED' | 'CANCELED'): Promise<void> {
    const url = `${BASE}/channel_points/custom_rewards/redemptions?broadcaster_id=${this.bid()}&reward_id=${rewardId}&id=${redemptionId}`;
    await this.request(url, { method: 'PATCH', body: JSON.stringify({ status }) });
  }

  async subscribeEventSub(type: string, version: string, condition: Record<string, string>, sessionId: string): Promise<void> {
    const url = `${BASE}/eventsub/subscriptions`;
    await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ type, version, condition, transport: { method: 'websocket', session_id: sessionId } }),
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/connection/helix.ts test/helix.test.ts
git commit -m "feat: add Helix reward, redemption-status, and EventSub-subscribe methods"
```

---

### Task 5: EventSub WebSocket client

**Files:**
- Create: `src/core/connection/eventsub.ts`, `test/eventsub.test.ts`

**Interfaces:**
- Consumes: `AuthConfig`; `HelixClient` (only `subscribeEventSub` is used).
- Produces:
  - `interface Redemption { id: string; rewardId: string; userInput: string; userName: string; }`
  - `class EventSubClient { constructor(auth: AuthConfig, helix: Pick<HelixClient, 'subscribeEventSub'>, wsFactory?: (url: string) => WSLike); onRedemption(fn: (r: Redemption) => void): void; onStatus(fn: (s: string) => void): void; connect(rewardId: string): void; disconnect(): void; }`
  - `type WSLike = { send(d: string): void; close(): void; onopen: (() => void) | null; onmessage: ((ev: { data: any }) => void) | null; onclose: (() => void) | null; onerror: ((e: any) => void) | null; }`

- [ ] **Step 1: Write the failing test** — `test/eventsub.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `../src/core/connection/eventsub.js`.

- [ ] **Step 3: Create `src/core/connection/eventsub.ts`**

```ts
import { AuthConfig } from '../types.js';
import { HelixClient } from './helix.js';

export interface Redemption {
  id: string;
  rewardId: string;
  userInput: string;
  userName: string;
}

export type WSLike = {
  send(d: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

const WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';

export class EventSubClient {
  private ws: WSLike | null = null;
  private rewardId = '';
  private redemptionHandlers: ((r: Redemption) => void)[] = [];
  private statusHandlers: ((s: string) => void)[] = [];

  constructor(
    private auth: AuthConfig,
    private helix: Pick<HelixClient, 'subscribeEventSub'>,
    private wsFactory: (url: string) => WSLike = (url) => new WebSocket(url) as unknown as WSLike,
  ) {}

  onRedemption(fn: (r: Redemption) => void): void { this.redemptionHandlers.push(fn); }
  onStatus(fn: (s: string) => void): void { this.statusHandlers.push(fn); }
  private status(s: string): void { for (const fn of this.statusHandlers) fn(s); }

  connect(rewardId: string): void {
    this.rewardId = rewardId;
    this.open(WS_URL);
  }

  private open(url: string): void {
    const ws = this.wsFactory(url);
    this.ws = ws;
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onclose = () => this.status('disconnected');
    ws.onerror = () => this.status('error');
    ws.onopen = () => this.status('connected');
  }

  private handle(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    switch (msg.metadata?.message_type) {
      case 'session_welcome':
        void this.helix.subscribeEventSub(
          REDEMPTION_TYPE, '1',
          { broadcaster_user_id: this.auth.broadcasterId, reward_id: this.rewardId },
          msg.payload.session.id,
        );
        break;
      case 'session_keepalive':
        break;
      case 'notification': {
        const e = msg.payload.event;
        for (const fn of this.redemptionHandlers) {
          fn({ id: e.id, rewardId: e.reward.id, userInput: e.user_input, userName: e.user_name });
        }
        break;
      }
      case 'session_reconnect':
        this.open(msg.payload.session.reconnect_url);
        break;
      case 'revocation':
        this.status('revoked');
        break;
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 new).

- [ ] **Step 5: Type-check compiles**

Run: `npm run build`
Expected: clean tsc (Node 24 global `WebSocket` type is available via `@types/node`).

- [ ] **Step 6: Commit**

```bash
git add src/core/connection/eventsub.ts test/eventsub.test.ts
git commit -m "feat: add EventSub WebSocket client for channel-point redemptions"
```

---

### Task 6: Quote commands

**Files:**
- Modify: `src/core/commands/builtins.ts`
- Test: `test/builtins.test.ts` (extend)

**Interfaces:**
- Consumes: existing `buildBuiltins` deps (`{ polls, moderator, activePoll, save }`), `Quote` from types.
- Produces: `addquote` (mod), `quote` (everyone), `delquote` (mod) entries in the builtins map. Handlers mutate `ctx.config.quotes` and call `deps.save()`.

- [ ] **Step 1: Write the failing test** — append to `test/builtins.test.ts`

```ts
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
```

> Note: the existing `ctx(text)` helper in this file builds a broadcaster context with `config = defaultConfig()` (which now has `quotes: []`) and `args` parsed from the text. Reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `b['addquote']` is undefined.

- [ ] **Step 3: Add the quote commands** to the returned map in `buildBuiltins` in `src/core/commands/builtins.ts`

```ts
    addquote: {
      permission: 'mod',
      handler: ctx => {
        const text = ctx.args.join(' ').trim();
        if (!text) { ctx.reply('Usage: !addquote <text>'); return; }
        const id = (ctx.config.quotes.at(-1)?.id ?? 0) + 1;
        ctx.config.quotes.push({ id, text, addedBy: ctx.msg.displayName, addedAt: new Date().toISOString() });
        deps.save();
        ctx.reply(`Quote #${id} added.`);
      },
    },
    quote: {
      permission: 'everyone',
      handler: ctx => {
        const quotes = ctx.config.quotes;
        if (quotes.length === 0) { ctx.reply('There are no quotes yet.'); return; }
        let q;
        if (ctx.args[0]) {
          q = quotes.find(x => x.id === Number(ctx.args[0]));
          if (!q) { ctx.reply(`No quote #${ctx.args[0]}.`); return; }
        } else {
          q = quotes[Math.floor(Math.random() * quotes.length)];
        }
        ctx.reply(`#${q.id}: ${q.text}`);
      },
    },
    delquote: {
      permission: 'mod',
      handler: ctx => {
        const id = Number(ctx.args[0]);
        const i = ctx.config.quotes.findIndex(x => x.id === id);
        if (i < 0) { ctx.reply(`No quote #${ctx.args[0]}.`); return; }
        ctx.config.quotes.splice(i, 1);
        deps.save();
        ctx.reply(`Quote #${id} deleted.`);
      },
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/commands/builtins.ts test/builtins.test.ts
git commit -m "feat: add quote commands (addquote/quote/delquote)"
```

---

### Task 7: Timers runner (`timers/timers.ts`)

**Files:**
- Create: `src/core/timers/timers.ts`, `test/timers.test.ts`

**Interfaces:**
- Consumes: `TimerConfig` from types.
- Produces:
  - `function nextMessage(messages: string[], index: number): { text: string; nextIndex: number }`
  - `class Timers { constructor(deps: { getConfig: () => TimerConfig; emit: (t: string) => void; rephrase?: (seed: string, avoidLast?: string) => Promise<string>; now?: () => number }); noteChatLine(): void; tick(): Promise<void>; start(): void; stop(): void; }`
  - `tick()` is the unit-testable core (start() just schedules `tick` on an interval).

- [ ] **Step 1: Write the failing test** — `test/timers.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMessage, Timers } from '../src/core/timers/timers.js';
import { defaultConfig, TimerConfig } from '../src/core/types.js';

test('nextMessage rotates and wraps', () => {
  assert.deepEqual(nextMessage(['a', 'b'], 0), { text: 'a', nextIndex: 1 });
  assert.deepEqual(nextMessage(['a', 'b'], 1), { text: 'b', nextIndex: 0 });
});

function cfg(over: Partial<TimerConfig> = {}): TimerConfig {
  return { ...defaultConfig().timers, enabled: true, intervalMinutes: 10, minChatLines: 2, messages: ['one', 'two'], ...over };
}

test('tick does nothing until interval AND min chat lines are met', async () => {
  let clock = 0;
  const c = cfg();
  const out: string[] = [];
  const t = new Timers({ getConfig: () => c, emit: x => out.push(x), now: () => clock });
  await t.tick();                       // t=0, no chat lines
  clock = 11 * 60_000;                  // interval elapsed, but 0 chat lines
  await t.tick();
  assert.deepEqual(out, []);
  t.noteChatLine(); t.noteChatLine();   // meet min lines
  await t.tick();
  assert.deepEqual(out, ['one']);
  assert.equal(c.nextIndex, 1);
});

test('tick with aiRephrase uses rephrase, falling back to seed on error', async () => {
  let clock = 100 * 60_000;
  const c = cfg({ aiRephrase: true, minChatLines: 0 });
  const out: string[] = [];
  const rephrase = async (seed: string) => { if (seed === 'one') return 'ONE!!'; throw new Error('down'); };
  const t = new Timers({ getConfig: () => c, emit: x => out.push(x), rephrase, now: () => clock });
  await t.tick();                       // index 0 -> 'one' -> 'ONE!!'
  clock += 100 * 60_000;
  await t.tick();                       // index 1 -> 'two' -> rephrase throws -> raw 'two'
  assert.deepEqual(out, ['ONE!!', 'two']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `../src/core/timers/timers.js`.

- [ ] **Step 3: Create `src/core/timers/timers.ts`**

```ts
import { TimerConfig } from '../types.js';

export function nextMessage(messages: string[], index: number): { text: string; nextIndex: number } {
  const i = index % messages.length;
  return { text: messages[i], nextIndex: (i + 1) % messages.length };
}

interface Deps {
  getConfig: () => TimerConfig;
  emit: (t: string) => void;
  rephrase?: (seed: string, avoidLast?: string) => Promise<string>;
  now?: () => number;
}

export class Timers {
  private lastPost = 0;
  private chatLines = 0;
  private lastRendered?: string;
  private handle: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: Deps) {
    this.lastPost = this.now();
  }

  private now(): number { return this.deps.now ? this.deps.now() : Date.now(); }

  noteChatLine(): void { this.chatLines += 1; }

  async tick(): Promise<void> {
    const cfg = this.deps.getConfig();
    if (!cfg.enabled || cfg.messages.length === 0) return;
    if (this.now() - this.lastPost < cfg.intervalMinutes * 60_000) return;
    if (this.chatLines < cfg.minChatLines) return;

    const { text: seed, nextIndex } = nextMessage(cfg.messages, cfg.nextIndex);
    cfg.nextIndex = nextIndex;

    let out = seed;
    if (cfg.aiRephrase && this.deps.rephrase) {
      try { out = await this.deps.rephrase(seed, this.lastRendered); } catch { out = seed; }
    }

    this.lastRendered = out;
    this.lastPost = this.now();
    this.chatLines = 0;
    this.deps.emit(out);
  }

  start(): void {
    if (this.handle) return;
    this.lastPost = this.now();
    this.handle = setInterval(() => { void this.tick(); }, 15_000);
  }

  stop(): void {
    if (this.handle) { clearInterval(this.handle); this.handle = null; }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (3 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/timers/timers.ts test/timers.test.ts
git commit -m "feat: add rotating timer runner with optional AI rephrase"
```

---

### Task 8: Bot wiring (redemption handler + timers + chat-line counting)

**Files:**
- Modify: `src/core/bot.ts`
- Test: `test/bot.test.ts` (extend)

**Interfaces:**
- Consumes: `persona` (`ask`, `sanitizeForChat`, `makeClient`), `EventSubClient`, `Timers`, `Redemption`, Helix redemption methods.
- Produces:
  - Exported `answerRedemption(r: Redemption, deps: { ask: (q: string) => Promise<string>; emit: (t: string) => void; fulfill: () => Promise<void>; refund: () => Promise<void> }): Promise<void>`
  - `Bot` builds `ai` client / `eventsub` / `timers` in the constructor; `dispatch` calls `timers.noteChatLine()`; `start()` connects EventSub (when `ai.enabled && ai.reward`) and starts timers (when `timers.enabled`); `stop()` tears them down.

- [ ] **Step 1: Write the failing test** — append to `test/bot.test.ts`

```ts
import { answerRedemption } from '../src/core/bot.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `answerRedemption` not exported.

- [ ] **Step 3: Add imports and the `answerRedemption` function** to `src/core/bot.ts` (add imports at top, and the exported function near the top-level, outside the class)

```ts
import { makeClient, ask as personaAsk, sanitizeForChat } from './ai/persona.js';
import { EventSubClient, Redemption } from './connection/eventsub.js';
import { Timers } from './timers/timers.js';
import { rephrase as personaRephrase } from './ai/persona.js';

export async function answerRedemption(
  r: Redemption,
  deps: { ask: (q: string) => Promise<string>; emit: (t: string) => void; fulfill: () => Promise<void>; refund: () => Promise<void> },
): Promise<void> {
  try {
    deps.emit(await deps.ask(r.userInput));
    await deps.fulfill();
  } catch {
    deps.emit('Sorry, I could not answer that — your points were refunded.');
    await deps.refund();
  }
}
```

- [ ] **Step 4: Wire the members into the `Bot` class** in `src/core/bot.ts`

Add fields (near the other private fields):

```ts
  private eventsub: EventSubClient | null = null;
  private timers: Timers;
```

In the constructor (after `this.router = ...`), build timers (AI client is built lazily in `start()` from the current config):

```ts
    this.timers = new Timers({
      getConfig: () => this.store.get().timers,
      emit: t => this.emit(t),
      rephrase: async (seed, avoidLast) => {
        const cfg = this.store.get().ai;
        return personaRephrase(seed, cfg, avoidLast, makeClient(cfg.apiKey));
      },
    });
```

In `dispatch(msg)`, add `this.timers.noteChatLine();` as the **first** line inside the method (before the moderation/try block), so every incoming message counts.

In `start()`, after `await this.chat.connect();`, add:

```ts
    const cfg = this.store.get();
    if (cfg.ai.enabled && cfg.ai.reward) {
      const reward = cfg.ai.reward;
      this.eventsub = new EventSubClient(cfg.auth, this.helix);
      this.eventsub.onStatus(s => this.status.forEach(f => f(s as any)));
      this.eventsub.onRedemption(r => {
        const aiCfg = this.store.get().ai;
        const client = makeClient(aiCfg.apiKey);
        void answerRedemption(r, {
          ask: async q => sanitizeForChat(await personaAsk(q, aiCfg, client), aiCfg.maxReplyChars),
          emit: t => this.emit(t),
          fulfill: () => this.helix.updateRedemptionStatus(reward.id, r.id, 'FULFILLED'),
          refund: () => this.helix.updateRedemptionStatus(reward.id, r.id, 'CANCELED'),
        });
      });
      this.eventsub.connect(reward.id);
    }
    if (cfg.timers.enabled) this.timers.start();
```

In `stop()`, before/after `this.chat?.disconnect()`, add:

```ts
    this.eventsub?.disconnect();
    this.eventsub = null;
    this.timers.stop();
```

> Note: `personaAsk`'s result is already `sanitizeForChat`-ed inside `ask`, and re-applied here after the (broadcaster-exempt) post — belt-and-suspenders on length. Banned-word screening of AI output is inherent to the broadcaster exemption plus the persona instruction; deeper output moderation is a follow-up, not built here.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (2 new; existing bot tests still green).

- [ ] **Step 6: Type-check compiles**

Run: `npm run build`
Expected: clean tsc.

- [ ] **Step 7: Commit**

```bash
git add src/core/bot.ts test/bot.test.ts
git commit -m "feat: wire redemption AI handler, timers, and chat-line counting into the bot"
```

---

### Task 9: Dashboard tabs (Persona, Quotes, Timers) + reward IPC

**Files:**
- Modify: `src/ui/index.html`, `src/ui/app.js`, `src/app/preload.ts`, `src/app/main.ts`
- Test: manual (Electron GUI)

**Interfaces:**
- Consumes: `window.api` (existing), Helix `createCustomReward`, config `ai`/`quotes`/`timers`.
- Produces: three new dashboard sections; a new IPC `reward:create` (renderer → main) returning `{ ok: boolean; error?: string; reward?: { id: string; title: string; cost: number } }`.

- [ ] **Step 1: Add the three sections to `src/ui/index.html`** (before the sticky Save button)

```html
  <section>
    <h2>Bot Personality (AI)</h2>
    <label><input type="checkbox" id="aiEnabled" /> Enabled</label>
    <label>Anthropic API Key <input id="aiApiKey" type="password" /></label>
    <label>Model
      <select id="aiModel">
        <option value="claude-haiku-4-5">Haiku 4.5 (cheapest)</option>
        <option value="claude-sonnet-5">Sonnet 5</option>
        <option value="claude-opus-4-8">Opus 4.8</option>
      </select>
    </label>
    <label>Persona / rules<br /><textarea id="aiPersona"></textarea></label>
    <label>Max reply chars <input id="aiMaxChars" type="number" /></label>
    <h3>Channel-point reward</h3>
    <input id="rewardName" placeholder="Ask the Bot" />
    <input id="rewardCost" type="number" placeholder="500" />
    <button id="createReward">Create Reward</button>
    <span id="rewardStatus"></span>
  </section>

  <section>
    <h2>Quotes</h2>
    <table id="quoteTable"><thead><tr><th>#</th><th>Quote</th><th></th></tr></thead><tbody></tbody></table>
    <input id="qText" placeholder="a memorable moment" />
    <button id="addQuote">Add</button>
  </section>

  <section>
    <h2>Timers</h2>
    <label><input type="checkbox" id="timersEnabled" /> Enabled</label>
    <label>Interval (minutes) <input id="timerInterval" type="number" /></label>
    <label>Min chat lines between posts <input id="timerMinLines" type="number" /></label>
    <label><input type="checkbox" id="timerRephrase" /> Rephrase with AI (unique each time)</label>
    <label>Messages (one per line)<br /><textarea id="timerMessages"></textarea></label>
  </section>
```

- [ ] **Step 2: Extend `src/app/preload.ts`** — add one method to the exposed `api`:

```ts
  createReward: (name: string, cost: number): Promise<{ ok: boolean; error?: string; reward?: { id: string; title: string; cost: number } }> => ipcRenderer.invoke('reward:create', name, cost),
```

- [ ] **Step 3: Add the IPC handler to `src/app/main.ts`** (with the other `ipcMain.handle` calls). Reuse the token provider the `Bot` already builds by constructing a `HelixClient` here:

```ts
import { HelixClient } from '../core/connection/helix.js';
import { refresh as refreshToken } from '../core/auth/oauth.js';

ipcMain.handle('reward:create', async (_e, name: string, cost: number) => {
  const a = store.get().auth;
  if (!a.accessToken || !a.broadcasterId) return { ok: false, error: 'Authorize first.' };
  const helix = new HelixClient({
    getToken: () => store.get().auth.accessToken,
    getClientId: () => store.get().auth.clientId,
    getBroadcasterId: () => store.get().auth.broadcasterId,
    onUnauthorized: async () => {
      try {
        const t = await refreshToken(a.clientId, a.clientSecret, a.refreshToken);
        const next = store.get(); next.auth.accessToken = t.accessToken; next.auth.refreshToken = t.refreshToken; store.save(next);
        return true;
      } catch { return false; }
    },
  });
  try {
    const reward = await helix.createCustomReward(name, Number(cost), 'Type your question for the bot');
    const next = store.get();
    next.ai.reward = { id: reward.id, title: name, cost: Number(cost) };
    store.save(next);
    return { ok: true, reward: next.ai.reward };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});
```

- [ ] **Step 4: Extend `src/ui/app.js`** — add to `load()`, `collect()`, and wire the new controls. Append inside the existing functions and at the bottom:

In `load()`:
```js
  $('aiEnabled').checked = config.ai.enabled;
  $('aiApiKey').value = config.ai.apiKey;
  $('aiModel').value = config.ai.model;
  $('aiPersona').value = config.ai.persona;
  $('aiMaxChars').value = config.ai.maxReplyChars;
  $('rewardStatus').textContent = config.ai.reward ? `Reward: ${config.ai.reward.title} (${config.ai.reward.cost})` : 'No reward yet';
  $('timersEnabled').checked = config.timers.enabled;
  $('timerInterval').value = config.timers.intervalMinutes;
  $('timerMinLines').value = config.timers.minChatLines;
  $('timerRephrase').checked = config.timers.aiRephrase;
  $('timerMessages').value = config.timers.messages.join('\n');
  renderQuotes();
```

In `collect()`:
```js
  config.ai.enabled = $('aiEnabled').checked;
  config.ai.apiKey = $('aiApiKey').value.trim();
  config.ai.model = $('aiModel').value;
  config.ai.persona = $('aiPersona').value;
  config.ai.maxReplyChars = Number($('aiMaxChars').value);
  config.timers.enabled = $('timersEnabled').checked;
  config.timers.intervalMinutes = Number($('timerInterval').value);
  config.timers.minChatLines = Number($('timerMinLines').value);
  config.timers.aiRephrase = $('timerRephrase').checked;
  config.timers.messages = $('timerMessages').value.split('\n').map(s => s.trim()).filter(Boolean);
```

Add near the bottom (helpers + handlers):
```js
function renderQuotes() {
  const body = $('quoteTable').querySelector('tbody');
  body.innerHTML = '';
  config.quotes.forEach((q, i) => {
    const tr = document.createElement('tr');
    const idTd = document.createElement('td'); idTd.textContent = q.id;
    const txtTd = document.createElement('td'); txtTd.textContent = q.text;
    const btnTd = document.createElement('td');
    const del = document.createElement('button'); del.textContent = 'x';
    del.onclick = () => { config.quotes.splice(i, 1); renderQuotes(); };
    btnTd.appendChild(del);
    tr.append(idTd, txtTd, btnTd); body.appendChild(tr);
  });
}

$('addQuote').onclick = () => {
  const text = $('qText').value.trim();
  if (!text) return;
  const id = (config.quotes.at(-1)?.id ?? 0) + 1;
  config.quotes.push({ id, text, addedBy: 'dashboard', addedAt: new Date().toISOString() });
  $('qText').value = '';
  renderQuotes();
};

$('createReward').onclick = async () => {
  collect(); await api.saveConfig(config);
  const r = await api.createReward($('rewardName').value.trim(), Number($('rewardCost').value));
  if (!r.ok) { $('rewardStatus').textContent = 'Error: ' + r.error; return; }
  config = await api.getConfig();
  $('rewardStatus').textContent = `Reward: ${r.reward.title} (${r.reward.cost})`;
};
```

- [ ] **Step 5: Type-check + build**

Run: `npm run build`
Expected: clean tsc; `dist/ui` regenerated with the updated `index.html`/`app.js`.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass (UI adds none).

- [ ] **Step 7: Manual verification**

Run: `npm start`
Expected:
- The window shows the three new sections.
- **Re-authorize** (the consent screen now lists "Manage Channel Points redemptions").
- Paste the Anthropic API key, set reward name + cost, click **Create Reward** → status shows the reward; it appears in your Twitch Channel Points.
- Enable AI, **Start Bot**. Redeem the reward on your channel with a question → the bot replies in chat and the redemption is marked Fulfilled.
- Add a couple of timer messages, enable timers with a short interval and low min-lines, chat a few lines → a timer message posts (AI-rephrased if that toggle is on).
- `!addquote hello` then `!quote` → the quote comes back.

- [ ] **Step 8: Commit**

```bash
git add src/ui/index.html src/ui/app.js src/app/preload.ts src/app/main.ts
git commit -m "feat: add Persona, Quotes, and Timers dashboard tabs + create-reward IPC"
```

---

## Self-Review

**Spec coverage:**
- AI persona via Claude SDK → Task 2 (`ask`/`rephrase`, model `claude-haiku-4-5`, max_tokens 150, no thinking). ✓
- Channel-point trigger via EventSub → Task 5 (`EventSubClient`), wired in Task 8. ✓
- Bot creates & manages the reward → Task 4 (`createCustomReward` with `is_user_input_required`, `updateRedemptionStatus`) + Task 9 (create-reward IPC/UI). ✓
- Auto Fulfilled / Canceled(refund) → Task 8 (`answerRedemption` fulfill/refund paths). ✓
- New scope `channel:manage:redemptions` → Task 3. ✓
- Quotes (add/quote/delquote + tab) → Task 6, Task 9. ✓
- Rotating timers + min-lines gate + AI rephrase + URL preservation → Task 7 (`Timers`, rephrase fallback), Task 2 (rephrase URL prompt), Task 9 (Timers tab). ✓
- Config additions, all default OFF → Task 1. ✓
- Dashboard Persona/Quotes/Timers tabs → Task 9. ✓
- New dependency `@anthropic-ai/sdk` only → Task 2. ✓
- Error handling (AI error → refund + fallback; timer rephrase failure → raw seed; reward-create errors surfaced) → Tasks 8, 7, 9. ✓
- Injectable clients for offline tests (persona `MessagesClient`, eventsub `wsFactory`, helix recorder fetch) → Tasks 2, 5, 4. ✓

**Deferred (matches spec):** `!ask` chat trigger — not built; the shared `personaAsk`/`answerRedemption` seam makes it a later one-liner. Correct.

**Type consistency:** `AIConfig`, `Quote`, `TimerConfig`, `MessagesClient`, `Redemption`, `WSLike`, `nextMessage`, `answerRedemption`, `createCustomReward`, `updateRedemptionStatus`, `subscribeEventSub` are defined once and referenced with identical signatures across tasks. `timers.nextIndex` (not `_nextIndex`) is used consistently. The reward object shape `{ id, title, cost }` matches between Helix result mapping, config, and IPC.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the two "Note" callouts document deliberate scope decisions, not missing work.
