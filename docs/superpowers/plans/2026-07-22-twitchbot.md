# TwitchBot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop Twitch bot (Electron) for the owner's own channel with configurable chat moderation, custom commands, and native Twitch polls, managed from a dashboard.

**Architecture:** A UI-agnostic TypeScript **bot core** (`src/core/`) that runs headless, wrapped by an **Electron shell** (`src/app/`) and a **vanilla dashboard** (`src/ui/`). Incoming chat flows through a moderation pipeline then a command router. Config lives in one JSON file that both the core and dashboard share in-process.

**Tech Stack:** Node.js 24 · TypeScript · `tmi.js` (chat) · native `fetch` (Helix REST) · Electron + electron-builder · Node built-in `node:test`/`node:assert` run via `tsx` (no test framework, no axios, no UI framework).

## Global Constraints

- **Runtime:** Node.js ≥ 18 (dev machine is v24). Uses global `fetch` — do NOT add axios/node-fetch.
- **Tests:** `node:test` + `node:assert/strict` only, executed with `tsx`. No Jest/Vitest/Mocha, no fixtures beyond inline sample messages.
- **Core purity:** nothing in `src/core/` may `import` from `electron`. The core must run from a plain Node script.
- **Module system:** ESM (`"type": "module"` in package.json). Use `.js` extensions in relative imports (TS ESM requirement).
- **Secrets:** `config.json` holds tokens and is git-ignored (already in `.gitignore`). Never commit a real token.
- **Account model:** the owner's single account is both broadcaster and bot; one OAuth token, all scopes.
- **Scopes:** `chat:read chat:edit channel:manage:polls channel:read:polls moderator:manage:banned_users moderator:manage:chat_messages`.
- **Native polls** require Affiliate/Partner (already true) — no chat-poll fallback.

---

### Task 1: Project scaffold + toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/core/version.ts`, `test/version.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getVersion(): string` in `src/core/version.ts`; a working `npm test` command.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "twitchbot",
  "version": "0.1.0",
  "type": "module",
  "description": "Twitch moderation + polls bot (desktop)",
  "main": "dist/app/main.js",
  "scripts": {
    "test": "node --import tsx --test test/**/*.test.ts",
    "build": "tsc",
    "start:core": "tsx src/core/headless.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/tmi.js": "^1.8.6",
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  },
  "dependencies": {
    "tmi.js": "^1.8.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write the failing test** — `test/version.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersion } from '../src/core/version.js';

test('getVersion returns the package version string', () => {
  assert.equal(getVersion(), '0.1.0');
});
```

- [ ] **Step 4: Install deps and run the test to verify it fails**

Run: `npm install && npm test`
Expected: FAIL — cannot find module `../src/core/version.js`.

- [ ] **Step 5: Create `src/core/version.ts`**

```ts
export function getVersion(): string {
  return '0.1.0';
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json src/core/version.ts test/version.test.ts
git commit -m "chore: scaffold TypeScript project with node:test toolchain"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/core/types.ts`, `test/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the type definitions every later task imports. No runtime logic except `defaultConfig()`.

- [ ] **Step 1: Write the failing test** — `test/types.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/core/types.js';

test('defaultConfig has moderation disabled and no commands', () => {
  const c = defaultConfig();
  assert.equal(c.moderation.enabled, false);
  assert.deepEqual(c.commands, []);
  assert.equal(c.polls.defaultDurationSec, 120);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `defaultConfig`.

- [ ] **Step 3: Create `src/core/types.ts`**

```ts
export interface ChatMessage {
  channel: string;
  username: string;      // login (lowercase)
  displayName: string;
  userId: string;
  messageId: string;     // from tmi tags 'id'; needed to delete
  message: string;
  isMod: boolean;
  isBroadcaster: boolean;
  isSubscriber: boolean;
}

export type ModAction =
  | { type: 'delete' }
  | { type: 'timeout'; seconds: number }
  | { type: 'ban' };

export type Verdict =
  | { ok: true }
  | { ok: false; reason: string; action: ModAction };

export type Permission = 'everyone' | 'mod' | 'broadcaster';

export interface CustomCommand {
  trigger: string;          // e.g. "!hello" (lowercase, includes prefix)
  response: string;         // supports {user} and {count}
  type: 'text' | 'counter';
  count: number;            // used when type === 'counter'
  cooldownSec: number;
  permission: Permission;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  broadcasterId: string;
  login: string;            // channel + bot login (same account)
}

export interface ModerationConfig {
  enabled: boolean;
  bannedWords: string[];       // matched case-insensitively as whole words
  capsPercent: number;         // 0 disables; else % uppercase letters that triggers
  capsMinLength: number;       // ignore short messages
  maxLinks: number;            // -1 = allow all
  maxSymbolPercent: number;    // 0 disables; % non-alphanumeric that triggers
  defaultAction: ModAction;    // action applied on any violation
  permitDurationSec: number;   // how long a !permit lasts
}

export interface Config {
  auth: AuthConfig;
  moderation: ModerationConfig;
  commands: CustomCommand[];
  polls: { defaultDurationSec: number };
}

export function defaultConfig(): Config {
  return {
    auth: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', broadcasterId: '', login: '' },
    moderation: {
      enabled: false,
      bannedWords: [],
      capsPercent: 70,
      capsMinLength: 10,
      maxLinks: 1,
      maxSymbolPercent: 50,
      defaultAction: { type: 'timeout', seconds: 10 },
      permitDurationSec: 60,
    },
    commands: [],
    polls: { defaultDurationSec: 120 },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts test/types.test.ts
git commit -m "feat: add shared core types and defaultConfig"
```

---

### Task 3: Config store (load / save / subscribe / corruption recovery)

**Files:**
- Create: `src/core/config/store.ts`, `test/store.test.ts`

**Interfaces:**
- Consumes: `Config`, `defaultConfig` from `types.ts`.
- Produces:
  - `class ConfigStore { constructor(path: string); load(): Config; get(): Config; save(next: Config): void; subscribe(fn: (c: Config) => void): () => void; }`

- [ ] **Step 1: Write the failing test** — `test/store.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/core/config/store.js';

function tmpPath() {
  return join(mkdtempSync(join(tmpdir(), 'tb-')), 'config.json');
}

test('load returns defaults when file is missing', () => {
  const s = new ConfigStore(tmpPath());
  assert.equal(s.load().moderation.enabled, false);
});

test('save then load round-trips', () => {
  const p = tmpPath();
  const s = new ConfigStore(p);
  const c = s.load();
  c.polls.defaultDurationSec = 300;
  s.save(c);
  assert.equal(new ConfigStore(p).load().polls.defaultDurationSec, 300);
});

test('corrupt file backs up and returns defaults', () => {
  const p = tmpPath();
  writeFileSync(p, '{ not valid json');
  const s = new ConfigStore(p);
  assert.equal(s.load().moderation.enabled, false);
  assert.ok(existsSync(p + '.bak'));
});

test('subscribe fires on save and unsubscribe stops it', () => {
  const s = new ConfigStore(tmpPath());
  s.load();
  let calls = 0;
  const off = s.subscribe(() => { calls++; });
  s.save(s.get());
  off();
  s.save(s.get());
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `ConfigStore`.

- [ ] **Step 3: Create `src/core/config/store.ts`**

```ts
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Config, defaultConfig } from '../types.js';

export class ConfigStore {
  private current: Config = defaultConfig();
  private subscribers = new Set<(c: Config) => void>();

  constructor(private path: string) {}

  load(): Config {
    if (!existsSync(this.path)) {
      this.current = defaultConfig();
      return this.current;
    }
    try {
      const raw = readFileSync(this.path, 'utf8');
      // Merge over defaults so new fields added later are present.
      this.current = { ...defaultConfig(), ...JSON.parse(raw) } as Config;
    } catch {
      renameSync(this.path, this.path + '.bak');
      this.current = defaultConfig();
    }
    return this.current;
  }

  get(): Config {
    return this.current;
  }

  save(next: Config): void {
    this.current = next;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(next, null, 2), 'utf8');
    for (const fn of this.subscribers) fn(next);
  }

  subscribe(fn: (c: Config) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/config/store.ts test/store.test.ts
git commit -m "feat: add JSON config store with corruption recovery and subscribers"
```

---

### Task 4: Moderation filters (pure functions)

**Files:**
- Create: `src/core/moderation/filters.ts`, `test/filters.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ModerationConfig`, `Verdict` from `types.ts`.
- Produces:
  - `moderate(msg: ChatMessage, cfg: ModerationConfig): Verdict` — runs all filters, returns the first violation or `{ ok: true }`.
  - Individual filters (exported for testing): `checkBannedWords`, `checkCaps`, `checkLinks`, `checkSymbols` — each `(msg, cfg) => Verdict`.

- [ ] **Step 1: Write the failing test** — `test/filters.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moderate } from '../src/core/moderation/filters.js';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `moderate`.

- [ ] **Step 3: Create `src/core/moderation/filters.ts`**

```ts
import { ChatMessage, ModerationConfig, Verdict } from '../types.js';

function fail(reason: string, cfg: ModerationConfig): Verdict {
  return { ok: false, reason, action: cfg.defaultAction };
}

export function checkBannedWords(msg: ChatMessage, cfg: ModerationConfig): Verdict {
  const text = msg.message.toLowerCase();
  for (const word of cfg.bannedWords) {
    if (!word) continue;
    const re = new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(text)) return fail(`banned word: ${word}`, cfg);
  }
  return { ok: true };
}

export function checkCaps(msg: ChatMessage, cfg: ModerationConfig): Verdict {
  if (cfg.capsPercent <= 0) return { ok: true };
  const letters = msg.message.replace(/[^a-zA-Z]/g, '');
  if (letters.length < cfg.capsMinLength) return { ok: true };
  const caps = letters.replace(/[^A-Z]/g, '').length;
  const pct = (caps / letters.length) * 100;
  return pct >= cfg.capsPercent ? fail('excessive caps', cfg) : { ok: true };
}

export function checkLinks(msg: ChatMessage, cfg: ModerationConfig): Verdict {
  if (cfg.maxLinks < 0) return { ok: true };
  const links = msg.message.match(/https?:\/\/\S+|\b\w+\.(com|net|org|io|tv|gg)\b/gi) ?? [];
  return links.length > cfg.maxLinks ? fail('too many links', cfg) : { ok: true };
}

export function checkSymbols(msg: ChatMessage, cfg: ModerationConfig): Verdict {
  if (cfg.maxSymbolPercent <= 0) return { ok: true };
  const chars = msg.message.replace(/\s/g, '');
  if (chars.length < 6) return { ok: true };
  const symbols = chars.replace(/[a-zA-Z0-9]/g, '').length;
  const pct = (symbols / chars.length) * 100;
  return pct >= cfg.maxSymbolPercent ? fail('symbol spam', cfg) : { ok: true };
}

const FILTERS = [checkBannedWords, checkCaps, checkLinks, checkSymbols];

export function moderate(msg: ChatMessage, cfg: ModerationConfig): Verdict {
  for (const filter of FILTERS) {
    const v = filter(msg, cfg);
    if (!v.ok) return v;
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (8 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/moderation/filters.ts test/filters.test.ts
git commit -m "feat: add moderation filters (banned words, caps, links, symbols)"
```

---

### Task 5: Helix client

**Files:**
- Create: `src/core/connection/helix.ts`, `test/helix.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (takes primitives + a token provider).
- Produces:
  - `interface Poll { id: string; title: string; status: string; choices: { title: string; votes: number }[]; }`
  - `interface TokenProvider { getToken(): string; getClientId(): string; getBroadcasterId(): string; onUnauthorized(): Promise<boolean>; }`
  - `class HelixClient` with: `deleteMessage(messageId)`, `timeoutUser(userId, seconds, reason?)`, `banUser(userId, reason?)`, `createPoll(title, choices, durationSec)`, `getPoll(id)`, `endPoll(id, status)`. Constructor: `new HelixClient(tp: TokenProvider, fetchImpl?: typeof fetch)`.

- [ ] **Step 1: Write the failing test** — `test/helix.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `HelixClient`.

- [ ] **Step 3: Create `src/core/connection/helix.ts`**

```ts
export interface Poll {
  id: string;
  title: string;
  status: string;
  choices: { title: string; votes: number }[];
}

export interface TokenProvider {
  getToken(): string;
  getClientId(): string;
  getBroadcasterId(): string;
  onUnauthorized(): Promise<boolean>; // refresh token; return true if retry should happen
}

const BASE = 'https://api.twitch.tv/helix';

export class HelixClient {
  constructor(private tp: TokenProvider, private fetchImpl: typeof fetch = fetch) {}

  private async request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        'Client-Id': this.tp.getClientId(),
        'Authorization': `Bearer ${this.tp.getToken()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401 && retry && (await this.tp.onUnauthorized())) {
      return this.request(url, init, false);
    }
    if (!res.ok && res.status !== 401) {
      throw new Error(`Helix ${res.status}: ${await res.text()}`);
    }
    return res;
  }

  private bid() { return this.tp.getBroadcasterId(); }

  async deleteMessage(messageId: string): Promise<void> {
    const url = `${BASE}/moderation/chat?broadcaster_id=${this.bid()}&moderator_id=${this.bid()}&message_id=${messageId}`;
    await this.request(url, { method: 'DELETE' });
  }

  async timeoutUser(userId: string, seconds: number, reason = ''): Promise<void> {
    const url = `${BASE}/moderation/bans?broadcaster_id=${this.bid()}&moderator_id=${this.bid()}`;
    await this.request(url, { method: 'POST', body: JSON.stringify({ data: { user_id: userId, duration: seconds, reason } }) });
  }

  async banUser(userId: string, reason = ''): Promise<void> {
    const url = `${BASE}/moderation/bans?broadcaster_id=${this.bid()}&moderator_id=${this.bid()}`;
    await this.request(url, { method: 'POST', body: JSON.stringify({ data: { user_id: userId, reason } }) });
  }

  async createPoll(title: string, choices: string[], durationSec: number): Promise<Poll> {
    const url = `${BASE}/polls`;
    const res = await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ broadcaster_id: this.bid(), title, choices: choices.map(c => ({ title: c })), duration: durationSec }),
    });
    return (await res.json()).data[0];
  }

  async getPoll(id: string): Promise<Poll> {
    const res = await this.request(`${BASE}/polls?broadcaster_id=${this.bid()}&id=${id}`);
    return (await res.json()).data[0];
  }

  async endPoll(id: string, status: 'TERMINATED' | 'ARCHIVED'): Promise<Poll> {
    const res = await this.request(`${BASE}/polls`, {
      method: 'PATCH',
      body: JSON.stringify({ broadcaster_id: this.bid(), id, status }),
    });
    return (await res.json()).data[0];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/connection/helix.ts test/helix.test.ts
git commit -m "feat: add Helix client for moderation actions and polls"
```

---

### Task 6: Moderation actions (verdict → Helix)

**Files:**
- Create: `src/core/moderation/moderator.ts`, `test/moderator.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ModerationConfig` from types; `moderate` from filters; `HelixClient` from helix.
- Produces:
  - `class Moderator { constructor(helix: HelixClient); permit(username: string, seconds: number): void; handle(msg: ChatMessage, cfg: ModerationConfig): Promise<boolean>; }` — returns `true` if it acted (message was moderated).

- [ ] **Step 1: Write the failing test** — `test/moderator.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `Moderator`.

- [ ] **Step 3: Create `src/core/moderation/moderator.ts`**

```ts
import { ChatMessage, ModerationConfig, ModAction } from '../types.js';
import { moderate } from './filters.js';
import { HelixClient } from '../connection/helix.js';

export class Moderator {
  private permits = new Map<string, number>(); // username -> expiry epoch ms

  constructor(private helix: HelixClient) {}

  permit(username: string, seconds: number): void {
    this.permits.set(username.toLowerCase(), Date.now() + seconds * 1000);
  }

  private isPermitted(username: string): boolean {
    const exp = this.permits.get(username.toLowerCase());
    if (exp && exp > Date.now()) { this.permits.delete(username.toLowerCase()); return true; }
    return false;
  }

  async handle(msg: ChatMessage, cfg: ModerationConfig): Promise<boolean> {
    if (!cfg.enabled) return false;
    if (msg.isMod || msg.isBroadcaster) return false;
    if (this.isPermitted(msg.username)) return false;

    const verdict = moderate(msg, cfg);
    if (verdict.ok) return false;

    await this.apply(msg, verdict.action);
    return true;
  }

  private async apply(msg: ChatMessage, action: ModAction): Promise<void> {
    switch (action.type) {
      case 'delete': await this.helix.deleteMessage(msg.messageId); break;
      case 'timeout': await this.helix.timeoutUser(msg.userId, action.seconds, 'auto-mod'); break;
      case 'ban': await this.helix.banUser(msg.userId, 'auto-mod'); break;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/moderation/moderator.ts test/moderator.test.ts
git commit -m "feat: add moderator that applies verdicts via Helix with exemptions"
```

---

### Task 7: Polls module

**Files:**
- Create: `src/core/polls/polls.ts`, `test/polls.test.ts`

**Interfaces:**
- Consumes: `HelixClient`, `Poll` from helix.
- Produces:
  - `class Polls { constructor(helix: HelixClient); start(title: string, choices: string[], durationSec: number): Promise<Poll>; status(id: string): Promise<Poll>; end(id: string): Promise<Poll>; formatResults(poll: Poll): string; }`

- [ ] **Step 1: Write the failing test** — `test/polls.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Polls } from '../src/core/polls/polls.js';

test('start validates at least two choices', async () => {
  const p = new Polls({} as any);
  await assert.rejects(() => p.start('Q', ['only one'], 60), /at least 2/);
});

test('formatResults renders votes and a winner', () => {
  const p = new Polls({} as any);
  const out = p.formatResults({ id: 'p', title: 'Best?', status: 'COMPLETED',
    choices: [{ title: 'A', votes: 3 }, { title: 'B', votes: 7 }] });
  assert.match(out, /Best\?/);
  assert.match(out, /B.*7/);
});

test('start delegates to helix.createPoll', async () => {
  let called: any = null;
  const helix = { createPoll: async (t: string, c: string[], d: number) => { called = { t, c, d }; return { id: 'x', title: t, status: 'ACTIVE', choices: [] }; } } as any;
  await new Polls(helix).start('Q', ['A', 'B'], 90);
  assert.deepEqual(called, { t: 'Q', c: ['A', 'B'], d: 90 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `Polls`.

- [ ] **Step 3: Create `src/core/polls/polls.ts`**

```ts
import { HelixClient, Poll } from '../connection/helix.js';

export class Polls {
  constructor(private helix: HelixClient) {}

  async start(title: string, choices: string[], durationSec: number): Promise<Poll> {
    if (choices.length < 2) throw new Error('a poll needs at least 2 choices');
    if (choices.length > 5) throw new Error('Twitch polls allow at most 5 choices');
    return this.helix.createPoll(title, choices, durationSec);
  }

  status(id: string): Promise<Poll> {
    return this.helix.getPoll(id);
  }

  end(id: string): Promise<Poll> {
    return this.helix.endPoll(id, 'TERMINATED');
  }

  formatResults(poll: Poll): string {
    const total = poll.choices.reduce((n, c) => n + c.votes, 0) || 1;
    const winner = poll.choices.reduce((a, b) => (b.votes > a.votes ? b : a));
    const lines = poll.choices
      .map(c => `${c.title}: ${c.votes} (${Math.round((c.votes / total) * 100)}%)`)
      .join(' | ');
    return `📊 ${poll.title} — ${lines}. Winner: ${winner.title}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/polls/polls.ts test/polls.test.ts
git commit -m "feat: add native Twitch polls module"
```

---

### Task 8: Command router + custom commands

**Files:**
- Create: `src/core/commands/router.ts`, `test/router.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `Config`, `CustomCommand`, `Permission` from types.
- Produces:
  - `type BuiltinHandler = (ctx: CommandContext) => Promise<void> | void;`
  - `interface CommandContext { msg: ChatMessage; args: string[]; config: Config; reply: (text: string) => void; }`
  - `class CommandRouter { constructor(builtins: Record<string, { permission: Permission; handler: BuiltinHandler }>); route(msg: ChatMessage, config: Config, reply: (t: string) => void): Promise<boolean>; }`
  - Router handles: prefix check (`!`), permission gate, cooldowns, custom-command `{user}`/`{count}` substitution and counter increment (mutates `config.commands` in place; caller persists).

- [ ] **Step 1: Write the failing test** — `test/router.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `CommandRouter`.

- [ ] **Step 3: Create `src/core/commands/router.ts`**

```ts
import { ChatMessage, Config, Permission } from '../types.js';

export interface CommandContext {
  msg: ChatMessage;
  args: string[];
  config: Config;
  reply: (text: string) => void;
}

export type BuiltinHandler = (ctx: CommandContext) => Promise<void> | void;

function allowed(perm: Permission, msg: ChatMessage): boolean {
  if (perm === 'everyone') return true;
  if (perm === 'mod') return msg.isMod || msg.isBroadcaster;
  return msg.isBroadcaster;
}

export class CommandRouter {
  private lastRun = new Map<string, number>(); // trigger -> epoch ms

  constructor(private builtins: Record<string, { permission: Permission; handler: BuiltinHandler }>) {}

  async route(msg: ChatMessage, config: Config, reply: (t: string) => void): Promise<boolean> {
    const text = msg.message.trim();
    if (!text.startsWith('!')) return false;
    const [word, ...args] = text.split(/\s+/);
    const name = word.slice(1).toLowerCase();

    const builtin = this.builtins[name];
    if (builtin) {
      if (!allowed(builtin.permission, msg)) return false;
      await builtin.handler({ msg, args, config, reply });
      return true;
    }

    const cmd = config.commands.find(c => c.trigger.toLowerCase() === word.toLowerCase());
    if (!cmd) return false;
    if (!allowed(cmd.permission, msg)) return false;

    const now = Date.now();
    const last = this.lastRun.get(cmd.trigger) ?? 0;
    if (cmd.cooldownSec > 0 && now - last < cmd.cooldownSec * 1000) return false;
    this.lastRun.set(cmd.trigger, now);

    if (cmd.type === 'counter') cmd.count += 1;
    reply(cmd.response.replace(/\{user\}/g, msg.displayName).replace(/\{count\}/g, String(cmd.count)));
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (6 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/commands/router.ts test/router.test.ts
git commit -m "feat: add command router with custom commands, permissions, cooldowns"
```

---

### Task 9: Built-in commands (poll + mod actions)

**Files:**
- Create: `src/core/commands/builtins.ts`, `test/builtins.test.ts`

**Interfaces:**
- Consumes: `Polls`, `Moderator`, `CommandContext`, `Permission`, `Config`.
- Produces:
  - `function buildBuiltins(deps: { polls: Polls; moderator: Moderator; activePoll: { id: string | null }; save: () => void }): Record<string, { permission: Permission; handler: BuiltinHandler }>`
  - Commands: `!poll "Question" choice1 | choice2 | ...`, `!endpoll`, `!permit <user>`.
  - Syntax: everything after `!poll` is split on `|`; the first segment is the question, the rest are choices.

- [ ] **Step 1: Write the failing test** — `test/builtins.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `buildBuiltins`.

- [ ] **Step 3: Create `src/core/commands/builtins.ts`**

```ts
import { Permission } from '../types.js';
import { BuiltinHandler } from './router.js';
import { Polls } from '../polls/polls.js';
import { Moderator } from '../moderation/moderator.js';

interface Deps {
  polls: Polls;
  moderator: Moderator;
  activePoll: { id: string | null };
  save: () => void;
}

export function buildBuiltins(deps: Deps): Record<string, { permission: Permission; handler: BuiltinHandler }> {
  return {
    poll: {
      permission: 'mod',
      handler: async ctx => {
        const parts = ctx.args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length < 3) { ctx.reply('Usage: !poll Question | choice1 | choice2'); return; }
        const [title, ...choices] = parts;
        try {
          const poll = await deps.polls.start(title, choices, ctx.config.polls.defaultDurationSec);
          deps.activePoll.id = poll.id;
          ctx.reply(`📊 Poll started: ${title} — vote on stream!`);
        } catch (e) {
          ctx.reply(`Couldn't start poll: ${(e as Error).message}`);
        }
      },
    },
    endpoll: {
      permission: 'mod',
      handler: async ctx => {
        if (!deps.activePoll.id) { ctx.reply('No active poll.'); return; }
        try {
          const poll = await deps.polls.end(deps.activePoll.id);
          deps.activePoll.id = null;
          ctx.reply(deps.polls.formatResults(poll));
        } catch (e) {
          ctx.reply(`Couldn't end poll: ${(e as Error).message}`);
        }
      },
    },
    permit: {
      permission: 'mod',
      handler: ctx => {
        const user = ctx.args[0];
        if (!user) { ctx.reply('Usage: !permit <user>'); return; }
        deps.moderator.permit(user, ctx.config.moderation.permitDurationSec);
        ctx.reply(`${user} may post links for ${ctx.config.moderation.permitDurationSec}s.`);
      },
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/commands/builtins.ts test/builtins.test.ts
git commit -m "feat: add built-in poll and permit commands"
```

---

### Task 10: OAuth (authorization-code flow + refresh)

**Files:**
- Create: `src/core/auth/oauth.ts`, `test/oauth.test.ts`

**Interfaces:**
- Consumes: `AuthConfig` from types.
- Produces:
  - `const SCOPES: string[]`
  - `function authorizeUrl(clientId: string, redirectUri: string): string`
  - `async function exchangeCode(clientId, clientSecret, code, redirectUri, fetchImpl?): Promise<{ accessToken: string; refreshToken: string }>`
  - `async function refresh(clientId, clientSecret, refreshToken, fetchImpl?): Promise<{ accessToken: string; refreshToken: string }>`
  - `async function validate(accessToken, fetchImpl?): Promise<{ login: string; userId: string }>` (calls Twitch validate endpoint to get broadcaster id + login)

- [ ] **Step 1: Write the failing test** — `test/oauth.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `authorizeUrl`.

- [ ] **Step 3: Create `src/core/auth/oauth.ts`**

```ts
export const SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:manage:polls',
  'channel:read:polls',
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages',
];

const AUTH = 'https://id.twitch.tv/oauth2';

export function authorizeUrl(clientId: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
  });
  return `${AUTH}/authorize?${p.toString()}`;
}

async function tokenRequest(body: URLSearchParams, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token request failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { accessToken: j.access_token as string, refreshToken: j.refresh_token as string };
}

export function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri,
  }), fetchImpl);
}

export function refresh(clientId: string, clientSecret: string, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
  }), fetchImpl);
}

export async function validate(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ login: string; userId: string }> {
  const res = await fetchImpl(`${AUTH}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
  if (!res.ok) throw new Error(`Validate failed ${res.status}`);
  const j = await res.json();
  return { login: j.login, userId: j.user_id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/oauth.ts test/oauth.test.ts
git commit -m "feat: add Twitch OAuth authorize/exchange/refresh/validate"
```

---

### Task 11: Chat connection (tmi.js wrapper)

**Files:**
- Create: `src/core/connection/chat.ts`
- Test: manual (tmi.js is an external socket; no unit test — see verification step)

**Interfaces:**
- Consumes: `ChatMessage`, `AuthConfig`.
- Produces:
  - `class ChatClient { constructor(auth: AuthConfig); onMessage(fn: (m: ChatMessage) => void): void; connect(): Promise<void>; say(text: string): Promise<void>; disconnect(): Promise<void>; onStatus(fn: (s: 'connected' | 'disconnected') => void): void; }`
  - Maps tmi.js userstate tags → `ChatMessage` (`id`→messageId, `user-id`→userId, `mod`, badges broadcaster/subscriber).

- [ ] **Step 1: Create `src/core/connection/chat.ts`**

```ts
import tmi from 'tmi.js';
import { AuthConfig, ChatMessage } from '../types.js';

export class ChatClient {
  private client: tmi.Client;
  private messageHandlers: ((m: ChatMessage) => void)[] = [];
  private statusHandlers: ((s: 'connected' | 'disconnected') => void)[] = [];

  constructor(private auth: AuthConfig) {
    this.client = new tmi.Client({
      options: { skipUpdatingEmotesets: true },
      connection: { reconnect: true, secure: true },
      identity: { username: auth.login, password: `oauth:${auth.accessToken}` },
      channels: [auth.login],
    });

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      const m: ChatMessage = {
        channel: channel.replace('#', ''),
        username: (tags.username ?? '').toLowerCase(),
        displayName: tags['display-name'] ?? tags.username ?? '',
        userId: tags['user-id'] ?? '',
        messageId: tags.id ?? '',
        message,
        isMod: tags.mod === true || tags.badges?.broadcaster === '1',
        isBroadcaster: tags.badges?.broadcaster === '1',
        isSubscriber: tags.subscriber === true,
      };
      for (const fn of this.messageHandlers) fn(m);
    });

    this.client.on('connected', () => this.statusHandlers.forEach(f => f('connected')));
    this.client.on('disconnected', () => this.statusHandlers.forEach(f => f('disconnected')));
  }

  onMessage(fn: (m: ChatMessage) => void): void { this.messageHandlers.push(fn); }
  onStatus(fn: (s: 'connected' | 'disconnected') => void): void { this.statusHandlers.push(fn); }
  async connect(): Promise<void> { await this.client.connect(); }
  async say(text: string): Promise<void> { await this.client.say(this.auth.login, text); }
  async disconnect(): Promise<void> { await this.client.disconnect(); }
}
```

- [ ] **Step 2: Type-check compiles**

Run: `npm run build`
Expected: no TypeScript errors (produces `dist/`).

- [ ] **Step 3: Commit**

```bash
git add src/core/connection/chat.ts
git commit -m "feat: add tmi.js chat client mapping tags to ChatMessage"
```

---

### Task 12: Bot wiring + headless entry point

**Files:**
- Create: `src/core/bot.ts`, `src/core/headless.ts`, `test/bot.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `class Bot { constructor(store: ConfigStore); async start(): Promise<void>; async stop(): Promise<void>; async dispatch(msg: ChatMessage): Promise<void>; onOutgoing(fn: (text: string) => void): void; }`
  - `dispatch(msg)` is the ONE entry point (chat + future voice both call it): moderation first, then command routing. Persists config after counter/poll mutations via `store.save`.
  - `src/core/headless.ts` — runnable via `tsx src/core/headless.ts`: loads `./config.json`, starts the bot, logs status.

- [ ] **Step 1: Write the failing test** — `test/bot.test.ts` (tests `dispatch` wiring with a stubbed chat/helix)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/core/config/store.js';
import { Bot } from '../src/core/bot.js';
import { ChatMessage } from '../src/core/types.js';

function store() {
  const p = join(mkdtempSync(join(tmpdir(), 'tb-')), 'config.json');
  const s = new ConfigStore(p);
  const c = s.load();
  c.commands = [{ trigger: '!hi', response: 'hey {user}', type: 'text', count: 0, cooldownSec: 0, permission: 'everyone' }];
  s.save(c);
  return s;
}

function msg(text: string): ChatMessage {
  return { channel: 'c', username: 'v', displayName: 'V', userId: '1', messageId: 'm',
    message: text, isMod: false, isBroadcaster: false, isSubscriber: false };
}

test('dispatch routes a custom command to outgoing', async () => {
  const bot = new Bot(store());
  const out: string[] = [];
  bot.onOutgoing(t => out.push(t));
  await bot.dispatch(msg('!hi'));
  assert.deepEqual(out, ['hey V']);
});

test('dispatch persists a counter increment', async () => {
  const s = store();
  const c = s.get(); c.commands[0] = { trigger: '!d', response: '{count}', type: 'counter', count: 0, cooldownSec: 0, permission: 'everyone' };
  s.save(c);
  const bot = new Bot(s);
  bot.onOutgoing(() => {});
  await bot.dispatch(msg('!d'));
  assert.equal(new ConfigStore((s as any).path).load().commands[0].count, 1);
});
```

> Note: `Bot` must accept moderation/helix dependencies it can run without a live socket. For this test, moderation is disabled by default config, so `dispatch` never calls Helix. The Bot builds its Helix/Chat clients lazily in `start()`, not in the constructor, so `dispatch` is testable offline.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `Bot`.

- [ ] **Step 3: Create `src/core/bot.ts`**

```ts
import { ConfigStore } from './config/store.js';
import { ChatMessage } from './types.js';
import { HelixClient, TokenProvider } from './connection/helix.js';
import { ChatClient } from './connection/chat.js';
import { Moderator } from './moderation/moderator.js';
import { Polls } from './polls/polls.js';
import { CommandRouter } from './commands/router.js';
import { buildBuiltins } from './commands/builtins.js';
import { refresh, validate } from './auth/oauth.js';

export class Bot {
  private helix: HelixClient;
  private moderator: Moderator;
  private polls: Polls;
  private router: CommandRouter;
  private activePoll = { id: null as string | null };
  private chat: ChatClient | null = null;
  private outgoing: ((text: string) => void)[] = [];
  private status: ((s: 'connected' | 'disconnected') => void)[] = [];

  constructor(private store: ConfigStore) {
    const tp: TokenProvider = {
      getToken: () => this.store.get().auth.accessToken,
      getClientId: () => this.store.get().auth.clientId,
      getBroadcasterId: () => this.store.get().auth.broadcasterId,
      onUnauthorized: async () => {
        const a = this.store.get().auth;
        if (!a.refreshToken) return false;
        try {
          const t = await refresh(a.clientId, a.clientSecret, a.refreshToken);
          const next = this.store.get();
          next.auth.accessToken = t.accessToken;
          next.auth.refreshToken = t.refreshToken;
          this.store.save(next);
          return true;
        } catch { return false; }
      },
    };
    this.helix = new HelixClient(tp);
    this.moderator = new Moderator(this.helix);
    this.polls = new Polls(this.helix);
    this.router = new CommandRouter(
      buildBuiltins({ polls: this.polls, moderator: this.moderator, activePoll: this.activePoll, save: () => this.store.save(this.store.get()) }),
    );
  }

  onOutgoing(fn: (text: string) => void): void { this.outgoing.push(fn); }
  onStatus(fn: (s: 'connected' | 'disconnected') => void): void { this.status.push(fn); }
  private emit(text: string): void { for (const fn of this.outgoing) fn(text); }

  async dispatch(msg: ChatMessage): Promise<void> {
    const cfg = this.store.get();
    const moderated = await this.moderator.handle(msg, cfg.moderation);
    if (moderated) return;
    const before = JSON.stringify(cfg.commands);
    await this.router.route(msg, cfg, t => this.emit(t));
    if (JSON.stringify(cfg.commands) !== before) this.store.save(cfg); // persist counter changes
  }

  async start(): Promise<void> {
    const auth = this.store.get().auth;
    if (!auth.accessToken) throw new Error('Not authorized — complete OAuth first.');
    // Backfill broadcaster id/login if missing.
    if (!auth.broadcasterId) {
      const v = await validate(auth.accessToken);
      const next = this.store.get();
      next.auth.broadcasterId = v.userId;
      next.auth.login = v.login;
      this.store.save(next);
    }
    this.chat = new ChatClient(this.store.get().auth);
    this.chat.onMessage(m => { void this.dispatch(m); });
    this.chat.onStatus(s => this.status.forEach(f => f(s)));
    this.onOutgoing(t => { void this.chat?.say(t); });
    await this.chat.connect();
  }

  async stop(): Promise<void> {
    await this.chat?.disconnect();
    this.chat = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 new tests). All prior tests still pass.

- [ ] **Step 5: Create `src/core/headless.ts`**

```ts
import { join } from 'node:path';
import { ConfigStore } from './config/store.js';
import { Bot } from './bot.js';

const store = new ConfigStore(join(process.cwd(), 'config.json'));
store.load();

const bot = new Bot(store);
bot.onStatus(s => console.log(`[chat] ${s}`));
bot.start()
  .then(() => console.log('Bot started. Press Ctrl+C to stop.'))
  .catch(e => { console.error('Failed to start:', e.message); process.exit(1); });

process.on('SIGINT', () => { void bot.stop().then(() => process.exit(0)); });
```

- [ ] **Step 6: Commit**

```bash
git add src/core/bot.ts src/core/headless.ts test/bot.test.ts
git commit -m "feat: wire bot pipeline with single dispatch entry point + headless runner"
```

---

### Task 13: Electron shell (main process, window, tray, IPC)

**Files:**
- Create: `src/app/main.ts`, `src/app/preload.ts`
- Test: manual (Electron GUI)

**Interfaces:**
- Consumes: `ConfigStore`, `Bot`, `authorizeUrl`, `exchangeCode`, `validate` from core.
- Produces: an Electron app that loads `src/ui/index.html`, exposes an IPC API to the renderer via `preload.ts`, and runs a localhost server to catch the OAuth redirect.
- IPC channels (renderer → main): `config:get`, `config:save`, `bot:start`, `bot:stop`, `auth:begin` (opens Twitch consent, resolves when tokens stored), `bot:status` (main → renderer event).

- [ ] **Step 1: Create `src/app/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Config } from '../core/types.js';

contextBridge.exposeInMainWorld('api', {
  getConfig: (): Promise<Config> => ipcRenderer.invoke('config:get'),
  saveConfig: (c: Config): Promise<void> => ipcRenderer.invoke('config:save', c),
  startBot: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('bot:start'),
  stopBot: (): Promise<void> => ipcRenderer.invoke('bot:stop'),
  beginAuth: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:begin'),
  onStatus: (fn: (s: string) => void) => ipcRenderer.on('bot:status', (_e, s) => fn(s)),
});
```

- [ ] **Step 2: Create `src/app/main.ts`**

```ts
import { app, BrowserWindow, Tray, Menu, ipcMain, shell } from 'electron';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from '../core/config/store.js';
import { Bot } from '../core/bot.js';
import { authorizeUrl, exchangeCode, validate } from '../core/auth/oauth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REDIRECT = 'http://localhost:5123/callback';

const store = new ConfigStore(join(app.getPath('userData'), 'config.json'));
store.load();
let bot: Bot | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 900, height: 700,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(join(__dirname, '../ui/index.html'));
  win.on('close', e => { if (!(app as any).quitting) { e.preventDefault(); win?.hide(); } });
}

function createTray() {
  tray = new Tray(join(__dirname, '../ui/icon.png'));
  tray.setToolTip('TwitchBot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => win?.show() },
    { label: 'Quit', click: () => { (app as any).quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => win?.show());
}

// One-time OAuth: open consent in the system browser, catch the redirect locally.
function beginAuth(): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    const auth = store.get().auth;
    if (!auth.clientId || !auth.clientSecret) { resolve({ ok: false, error: 'Enter client ID and secret first.' }); return; }
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, REDIRECT);
      const code = url.searchParams.get('code');
      if (!code) { res.end('Missing code'); return; }
      try {
        const t = await exchangeCode(auth.clientId, auth.clientSecret, code, REDIRECT);
        const v = await validate(t.accessToken);
        const next = store.get();
        next.auth = { ...next.auth, accessToken: t.accessToken, refreshToken: t.refreshToken, broadcasterId: v.userId, login: v.login };
        store.save(next);
        res.end('Authorized! You can close this tab and return to TwitchBot.');
        server.close();
        resolve({ ok: true });
      } catch (e) {
        res.end('Auth failed: ' + (e as Error).message);
        server.close();
        resolve({ ok: false, error: (e as Error).message });
      }
    });
    server.listen(5123, () => shell.openExternal(authorizeUrl(auth.clientId, REDIRECT)));
  });
}

ipcMain.handle('config:get', () => store.get());
ipcMain.handle('config:save', (_e, c) => { store.save(c); });
ipcMain.handle('auth:begin', () => beginAuth());
ipcMain.handle('bot:start', async () => {
  try {
    bot = new Bot(store);
    bot.onStatus(s => win?.webContents.send('bot:status', s));
    await bot.start();
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
});
ipcMain.handle('bot:stop', async () => { await bot?.stop(); bot = null; });

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true }); // start on boot
  createWindow();
  createTray();
});
app.on('window-all-closed', () => { /* keep running in tray */ });
```

- [ ] **Step 3: Type-check compiles**

Run: `npm run build`
Expected: no TypeScript errors. (Add `"module": "ES2022"` already set; Electron supports ESM in current versions.)

- [ ] **Step 4: Commit**

```bash
git add src/app/main.ts src/app/preload.ts
git commit -m "feat: add Electron main process with tray, IPC, and OAuth redirect catcher"
```

---

### Task 14: Dashboard UI

**Files:**
- Create: `src/ui/index.html`, `src/ui/app.js`, `src/ui/styles.css`, `src/ui/icon.png`
- Test: manual (see verification)

**Interfaces:**
- Consumes: the `window.api` bridge from `preload.ts`.
- Produces: a single-page dashboard with four sections — **Setup** (client id/secret + Authorize + Start/Stop), **Moderation** (toggle + thresholds + banned words), **Commands** (list/add/remove custom commands), **Polls** (start a poll form). Vanilla DOM, no framework.

- [ ] **Step 1: Create `src/ui/index.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf8" />
  <link rel="stylesheet" href="styles.css" />
  <title>TwitchBot</title>
</head>
<body>
  <header><h1>TwitchBot</h1><span id="status" class="status">stopped</span></header>

  <section>
    <h2>Setup</h2>
    <label>Client ID <input id="clientId" /></label>
    <label>Client Secret <input id="clientSecret" type="password" /></label>
    <button id="authorize">Authorize with Twitch</button>
    <button id="start">Start Bot</button>
    <button id="stop">Stop Bot</button>
  </section>

  <section>
    <h2>Moderation</h2>
    <label><input type="checkbox" id="modEnabled" /> Enabled</label>
    <label>Caps % <input id="capsPercent" type="number" /></label>
    <label>Max links <input id="maxLinks" type="number" /></label>
    <label>Symbol % <input id="maxSymbolPercent" type="number" /></label>
    <label>Banned words (comma-separated)<br /><textarea id="bannedWords"></textarea></label>
  </section>

  <section>
    <h2>Custom Commands</h2>
    <table id="cmdTable"><thead><tr><th>Trigger</th><th>Response</th><th>Type</th><th></th></tr></thead><tbody></tbody></table>
    <div>
      <input id="cTrigger" placeholder="!hello" />
      <input id="cResponse" placeholder="hi {user}" />
      <select id="cType"><option value="text">text</option><option value="counter">counter</option></select>
      <button id="addCmd">Add</button>
    </div>
  </section>

  <section>
    <h2>Poll (native)</h2>
    <input id="pollTitle" placeholder="Question" />
    <input id="pollChoices" placeholder="Choice A | Choice B | Choice C" />
    <input id="pollDuration" type="number" value="120" />
    <button id="startPoll">Start Poll</button>
    <p class="hint">Polls also start from chat: <code>!poll Question | A | B</code></p>
  </section>

  <button id="save" class="save">Save Settings</button>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/ui/app.js`**

```js
const api = window.api;
let config;

function $(id) { return document.getElementById(id); }

function renderCommands() {
  const body = $('cmdTable').querySelector('tbody');
  body.innerHTML = '';
  config.commands.forEach((c, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.trigger}</td><td>${c.response}</td><td>${c.type}</td>`;
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => { config.commands.splice(i, 1); renderCommands(); };
    td.appendChild(del); tr.appendChild(td); body.appendChild(tr);
  });
}

function load() {
  $('clientId').value = config.auth.clientId;
  $('clientSecret').value = config.auth.clientSecret;
  $('modEnabled').checked = config.moderation.enabled;
  $('capsPercent').value = config.moderation.capsPercent;
  $('maxLinks').value = config.moderation.maxLinks;
  $('maxSymbolPercent').value = config.moderation.maxSymbolPercent;
  $('bannedWords').value = config.moderation.bannedWords.join(', ');
  renderCommands();
}

function collect() {
  config.auth.clientId = $('clientId').value.trim();
  config.auth.clientSecret = $('clientSecret').value.trim();
  config.moderation.enabled = $('modEnabled').checked;
  config.moderation.capsPercent = Number($('capsPercent').value);
  config.moderation.maxLinks = Number($('maxLinks').value);
  config.moderation.maxSymbolPercent = Number($('maxSymbolPercent').value);
  config.moderation.bannedWords = $('bannedWords').value.split(',').map(s => s.trim()).filter(Boolean);
}

$('addCmd').onclick = () => {
  const trigger = $('cTrigger').value.trim();
  if (!trigger.startsWith('!')) { alert('Trigger must start with !'); return; }
  config.commands.push({ trigger, response: $('cResponse').value, type: $('cType').value, count: 0, cooldownSec: 5, permission: 'everyone' });
  $('cTrigger').value = ''; $('cResponse').value = '';
  renderCommands();
};

$('save').onclick = async () => { collect(); await api.saveConfig(config); $('save').textContent = 'Saved!'; setTimeout(() => $('save').textContent = 'Save Settings', 1200); };
$('authorize').onclick = async () => { collect(); await api.saveConfig(config); const r = await api.beginAuth(); if (!r.ok) alert(r.error); else { config = await api.getConfig(); alert('Authorized as ' + config.auth.login); } };
$('start').onclick = async () => { const r = await api.startBot(); if (!r.ok) alert(r.error); };
$('stop').onclick = async () => { await api.stopBot(); };
$('startPoll').onclick = async () => {
  collect(); await api.saveConfig(config);
  // Polls run through the bot; easiest path is the chat command, but we can also expose an IPC later.
  alert('Use the !poll command in chat, or add a poll IPC in a later iteration.');
};

api.onStatus(s => { $('status').textContent = s; });

(async () => { config = await api.getConfig(); load(); })();
```

> Note: starting a poll from the dashboard button is intentionally deferred to a chat command for now (the bot owns the Helix client). Wiring a `poll:start` IPC is a small follow-up; the `!poll` command already covers the need. *(ponytail: don't duplicate the poll path in IPC until the button is actually wanted.)*

- [ ] **Step 3: Create `src/ui/styles.css`**

```css
body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; background: #18181b; color: #efeff1; }
header { display: flex; align-items: center; gap: 1rem; }
h1 { color: #a970ff; }
.status { padding: .2rem .6rem; border-radius: 4px; background: #333; }
section { border: 1px solid #333; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
label { display: block; margin: .5rem 0; }
input, textarea, select { background: #1f1f23; color: #efeff1; border: 1px solid #444; border-radius: 4px; padding: .4rem; }
button { background: #a970ff; color: white; border: none; border-radius: 4px; padding: .5rem 1rem; cursor: pointer; margin: .2rem; }
button:hover { background: #9146ff; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .3rem; border-bottom: 1px solid #333; }
.save { position: sticky; bottom: 1rem; font-size: 1.1rem; }
.hint { color: #999; font-size: .9rem; }
```

- [ ] **Step 4: Add an icon** — place any 256×256 PNG at `src/ui/icon.png` (tray + window icon). A plain placeholder is fine for now.

- [ ] **Step 5: Make `tsc` copy UI assets** — TypeScript won't copy `.html/.css/.js/.png`. Add a copy step to the build script in `package.json`:

```json
"build": "tsc && node -e \"const {cpSync}=require('node:fs');cpSync('src/ui','dist/ui',{recursive:true})\""
```

- [ ] **Step 6: Manual verification — run the app**

Run: `npm start`
Expected:
- The TwitchBot window opens with the four sections.
- Enter a Client ID/Secret (from a Twitch app you registered with redirect `http://localhost:5123/callback`), click **Authorize** → browser opens Twitch consent → after allowing, the app shows "Authorized as <login>".
- Click **Start Bot** → status flips to `connected`.
- In your channel chat, type a custom command you added → the bot replies.
- Type `!poll Best game? | Zelda | Mario` as broadcaster → a native poll appears on your channel.

- [ ] **Step 7: Commit**

```bash
git add src/ui/ package.json
git commit -m "feat: add dashboard UI (setup, moderation, commands, polls)"
```

---

### Task 15: Packaging (electron-builder → installable .exe)

**Files:**
- Modify: `package.json` (add `build` config block for electron-builder)
- Create: `.gitignore` entry for `release/` (build output)

**Interfaces:**
- Consumes: the compiled `dist/`.
- Produces: a Windows installer under `release/`.

- [ ] **Step 1: Add electron-builder config to `package.json`**

```json
"build": {
  "appId": "com.yourname.twitchbot",
  "productName": "TwitchBot",
  "files": ["dist/**/*", "package.json"],
  "directories": { "output": "release" },
  "win": { "target": "nsis" }
}
```

> Note: the `"build"` **script** and the `"build"` **config key** are different fields; keep both. The script compiles; the config drives electron-builder.

- [ ] **Step 2: Ignore build output** — add to `.gitignore`:

```
release/
```

- [ ] **Step 3: Produce the installer**

Run: `npm run dist`
Expected: an NSIS installer `.exe` appears in `release/`. Installing it and launching creates the tray app that starts on boot.

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: add electron-builder packaging config"
```

---

## Self-Review

**Spec coverage:**
- Chat read/send → Task 11 (`ChatClient`). ✓
- Moderation filters (banned words, caps, links, symbols) → Task 4. ✓
- Moderation actions + exemptions + `!permit` → Tasks 6, 9. ✓
- Custom commands (text/counter/cooldown/permission) → Task 8. ✓
- Built-in commands + native polls → Tasks 7, 9. ✓
- Config store (JSON, corruption recovery, subscribers) → Task 3. ✓
- OAuth flow + refresh + scopes → Task 10, wired in Tasks 12–13. ✓
- One dispatch entry point (voice door) → Task 12 (`Bot.dispatch`). ✓
- Electron shell (window, tray, autostart, IPC) → Task 13. ✓
- Dashboard (setup/moderation/commands/polls) → Task 14. ✓
- Headless-capable core (server door) → Task 12 (`headless.ts`), core never imports electron. ✓
- Packaging → Task 15. ✓
- Error handling: 401 refresh (Task 5/12), config corruption (Task 3), poll/Helix errors surfaced (Tasks 9, 13), chat auto-reconnect (Task 11). ✓

**Deferred (matches spec's "not now"):** multi-tenant (config layer is the only seam), voice-in (routes through `dispatch`), dashboard poll button (chat `!poll` covers it). No task builds these — correct.

**Type consistency:** `ChatMessage`, `Verdict`, `ModAction`, `Config`, `CustomCommand`, `TokenProvider`, `Poll`, `CommandContext`, `BuiltinHandler` are defined once (Tasks 2, 5, 8) and referenced with the same signatures throughout. `moderate`, `Moderator.handle`, `CommandRouter.route`, `Bot.dispatch`, `HelixClient.*`, `buildBuiltins` names are consistent across producer/consumer blocks.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the two "Note" callouts document deliberate deferrals, not missing work.
