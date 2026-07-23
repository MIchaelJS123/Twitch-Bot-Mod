# Interactivity Pack — Design Spec

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation plan
**Builds on:** `2026-07-22-twitchbot-design.md` (the base bot)

## Purpose

Add three interactivity features to the existing TwitchBot, reusing its command
router, config store, `dispatch()` seam, and dashboard — no architecture change:

1. **AI personality bot** triggered by a **Channel Points redemption** — a viewer
   redeems a reward, types a question, and the bot answers in a streamer-defined
   persona using the Claude API.
2. **Quotes system** — capture and recall memorable stream moments.
3. **Rotating timed messages** — periodic chat posts (socials/plugs), optionally
   **rewritten uniquely each time** by the same AI module.

## Scope

### In scope (build now)

- Claude API integration (official Anthropic SDK) with a configurable persona.
- Twitch **EventSub over WebSocket** to receive Channel Point redemptions.
- Bot **creates and manages** the channel-point reward (Twitch requires the app
  to own a reward to update its redemptions).
- Auto-mark each redemption **Fulfilled** on success, **Canceled/refunded** on
  Claude error.
- Quote commands + a Quotes dashboard tab.
- Rotating timers with an optional AI-rephrase mode + a Timers dashboard tab.
- A Persona dashboard tab (API key, model, persona, reward setup).
- New OAuth scope `channel:manage:redemptions` (one re-authorization).

### Out of scope (deferred — seam left open)

- `!ask` chat-command trigger for the AI. The AI call is a single shared
  function; wiring a chat command to it later is trivial. Not built now — the
  channel-point redemption is the chosen trigger.
- Multi-tenant / voice — unchanged from the base spec.

## Prerequisites (owner setup, one-time)

- An **Anthropic API key** (console.anthropic.com) — usage bills to the owner.
  Haiku 4.5 keeps this near-free (~$0.0008/reply).
- **Re-authorize** the Twitch app to grant `channel:manage:redemptions`.
- In the Persona tab: paste the API key, set the reward **name + cost**, click
  **Create Reward** (the app creates it on the channel, set to require viewer
  text input).

## Architecture

New units, each with one responsibility and a well-defined interface:

```
src/core/
  ai/
    persona.ts        Claude API wrapper: ask() + rephrase() (+ output sanitize)
  connection/
    eventsub.ts       Twitch EventSub WebSocket client (redemption events)
    helix.ts          + createCustomReward, updateRedemptionStatus, subscribeEventSub
  timers/
    timers.ts         rotating timer: interval + chat-line gate + rotation
  commands/
    builtins.ts       + quote commands (!addquote / !quote / !delquote)
  bot.ts              wire AI redemption handler, timers; count chat lines
  types.ts            + ai / quotes / timers config
src/app/main.ts       + IPC: reward:create, reauth uses new scope
src/ui/               + Persona, Quotes, Timers tabs
```

## Components

### AI module — `ai/persona.ts`

Wraps the official `@anthropic-ai/sdk`. Two public functions share one internal
completion helper so both the redemption reply and the timer rephrase go through
the same code path (the "single AI function" seam).

- `sanitizeForChat(text: string, maxChars: number): string` — pure: collapse
  newlines to spaces, trim, hard-cap to `maxChars`. Unit-tested (must not break
  a trailing URL).
- `complete(opts: { apiKey; model; system; user; maxTokens; client? }): Promise<string>`
  — calls `client.messages.create` (client injectable for tests), extracts the
  first `text` block, returns `sanitizeForChat(...)`. Surfaces Anthropic typed
  errors (`AuthenticationError`, `RateLimitError`, `APIError`) to the caller.
- `ask(question: string, cfg: AIConfig, client?): Promise<string>` — system =
  `cfg.persona`; user = the viewer's question; `maxTokens ≈ 150`.
- `rephrase(seed: string, cfg: AIConfig, avoidLast?: string, client?): Promise<string>`
  — system = a fixed "rewrite this streamer announcement into a short, fresh chat
  line; **copy any URLs exactly unchanged**; output only the message" prompt,
  plus `cfg.persona` for voice; user = the seed (+ "Avoid repeating: <avoidLast>"
  when provided).

Model: default `claude-haiku-4-5` (configurable). No `thinking` (cheapest path
on Haiku). `max_tokens` low (≈150) to bound cost and keep replies chat-sized.

### EventSub client — `connection/eventsub.ts`

WebSocket client for Twitch EventSub. Responsibilities: connect to
`wss://eventsub.wss.twitch.tv/ws`, capture the `session_welcome` session id, ask
Helix to create the redemption subscription bound to that session, and emit
redemption events.

- `class EventSubClient { constructor(auth: AuthConfig, helix: HelixClient); onRedemption(fn: (r: Redemption) => void): void; onStatus(fn: (s: string) => void): void; connect(rewardId: string): Promise<void>; disconnect(): void; }`
- `interface Redemption { id: string; rewardId: string; userInput: string; userName: string; }`
- Message handling (unit-tested against a fake socket): `session_welcome` →
  store `session.id`, subscribe; `session_keepalive` → no-op; `notification` →
  map payload → `Redemption`, emit; `session_reconnect` → reconnect to the new
  URL; `revocation` → emit status.
- Uses the user (broadcaster) token; the subscription condition is
  `{ broadcaster_user_id, reward_id }`.

### Helix additions — `connection/helix.ts`

Thin methods over existing `request()` (tested with the recorder fetch like the
current Helix tests):

- `createCustomReward(title: string, cost: number, prompt: string): Promise<{ id: string }>`
  — `POST /channel_points/custom_rewards?broadcaster_id=…` with
  `{ title, cost, is_user_input_required: true, prompt }`.
- `updateRedemptionStatus(rewardId: string, redemptionId: string, status: 'FULFILLED' | 'CANCELED'): Promise<void>`
  — `PATCH /channel_points/custom_rewards/redemptions?broadcaster_id=…&reward_id=…&id=…`
  with `{ status }`. (`CANCELED` refunds the points.)
- `subscribeEventSub(type: string, version: string, condition: object, sessionId: string): Promise<void>`
  — `POST /eventsub/subscriptions` with transport
  `{ method: 'websocket', session_id }`.

### Quotes — in `commands/builtins.ts` + `config.quotes`

Built-in commands over a `quotes` array in config:

- `!addquote <text>` (mod) → push `{ id, text, addedBy, addedAt }`, reply with id.
- `!quote` → random quote; `!quote <id>` → that quote; empty list handled.
- `!delquote <id>` (mod) → remove by id.
- Rotation/format logic is pure and unit-tested; the router persists config on
  change (existing mechanism).

### Timers — `timers/timers.ts`

- `class Timers { constructor(deps: { getConfig: () => TimerConfig; emit: (text: string) => void; rephrase?: (seed: string, avoidLast?: string) => Promise<string> }); noteChatLine(): void; start(): void; stop(): void; }`
- Uses a single interval tick (e.g. every 15s). On tick: if `enabled`, and
  `elapsed ≥ intervalMinutes`, and `chatLinesSinceLast ≥ minChatLines`, then pick
  the next message and post it.
- **Rotation** is sequential over `messages` via `nextIndex` (each appearance is
  a different entry) — pure `nextMessage(messages, index)` helper, unit-tested.
- If `aiRephrase` and a `rephrase` fn is provided, the seed is rewritten (passing
  the last rendered line as `avoidLast`); on rephrase failure, post the **raw
  seed**. If `aiRephrase` is off, always post the raw seed.
- Resets the chat-line counter and timestamp after posting.

### Bot wiring — `bot.ts`

- Build `ai` (persona fns bound to `config.ai`), `eventsub`, `timers`.
- `handleRedemption(r: Redemption)`: `ask(r.userInput)` → run reply through the
  moderation banned-word filter + `sanitizeForChat` → `emit(reply)` →
  `helix.updateRedemptionStatus(rewardId, r.id, 'FULFILLED')`. On any error:
  `updateRedemptionStatus(..., 'CANCELED')` and emit a short "couldn't answer,
  points refunded" line. This is the single AI function a future `!ask` reuses.
- `dispatch(msg)` also calls `timers.noteChatLine()` so timers can gate on chat
  activity.
- `start()`: if `ai.enabled && ai.reward` → `eventsub.connect(reward.id)` and
  wire `onRedemption → handleRedemption`. If `timers.enabled` → `timers.start()`.
- `stop()`: `eventsub.disconnect()`, `timers.stop()`.

### Auth — `auth/oauth.ts`

Add `channel:manage:redemptions` to `SCOPES`. Because the token gains a scope,
the owner re-runs the existing authorize flow once.

### Dashboard — `src/ui/`

Three sections/tabs added to the existing renderer, all driven by the current
`window.api` config get/save plus one new IPC:

- **Persona:** enabled · API key · model dropdown · persona textarea · max reply
  chars · cooldown · reward **name + cost + "Create Reward"** button · status.
- **Quotes:** list with delete; add box.
- **Timers:** enabled · interval (min) · min chat lines · **Rephrase with AI**
  toggle · editable message list (add/remove).

New IPC channel `reward:create` (renderer → main): main calls
`helix.createCustomReward(name, cost, prompt)`, stores `config.ai.reward`, returns
`{ ok, error? }` (surfaces duplicate-title and auth errors).

## Config additions (`types.ts` + `defaultConfig()`)

```ts
export interface AIConfig {
  enabled: boolean;
  apiKey: string;
  model: string;          // default 'claude-haiku-4-5'
  persona: string;        // system prompt
  maxReplyChars: number;  // default 200
  cooldownSec: number;    // per-user, default 10
  reward: { id: string; title: string; cost: number } | null;
}

export interface Quote { id: number; text: string; addedBy: string; addedAt: string; }

export interface TimerConfig {
  enabled: boolean;
  intervalMinutes: number;   // default 10
  minChatLines: number;      // default 5
  aiRephrase: boolean;       // default false
  messages: string[];
  nextIndex: number;         // rotation cursor
}

// Config gains: ai: AIConfig; quotes: Quote[]; timers: TimerConfig;
```

Defaults keep every new feature **off** (`ai.enabled=false`, `timers.enabled=false`,
`quotes=[]`) so an un-configured install behaves exactly like the base bot. The
config store's per-section default merge (base spec) covers the new sections.

## Data flow

**Redemption → reply:**
```
viewer redeems reward (types question)
  → Twitch EventSub WS → notification
  → EventSubClient.onRedemption(r)
  → Bot.handleRedemption: persona.ask(r.userInput, config.ai)
      → moderation banned-word filter + sanitizeForChat
      → chat.say(reply)
      → helix.updateRedemptionStatus(reward.id, r.id, 'FULFILLED')
  → (on error) updateRedemptionStatus(..., 'CANCELED') + "refunded" reply
```

**Timer tick → post:**
```
interval tick → gates (enabled, elapsed, minChatLines) pass
  → nextMessage(messages, nextIndex)
  → if aiRephrase: persona.rephrase(seed, avoidLast=lastRendered)  (fallback: seed)
  → chat.say(text); reset counter + timestamp; advance nextIndex
```

## Error handling

- **Anthropic auth/invalid key:** `AuthenticationError` → redemption canceled +
  "AI not configured" surfaced; dashboard shows the error on `!ask`/redemption.
- **Anthropic rate limit / 5xx:** `RateLimitError`/`APIError` → redemption
  refunded (`CANCELED`) + short "try again" chat line; not fatal.
- **EventSub disconnect:** handle `session_reconnect` and socket close with a
  bounded reconnect/backoff; surface connection status to the dashboard.
- **Reward creation duplicate title / perms:** Helix error surfaced to the
  dashboard; owner renames or fixes scope.
- **Timer AI rephrase failure:** fall back to the raw seed (never blocks a post).
- **`ai.enabled` but no key/reward:** dashboard shows a "finish setup" state; the
  bot skips the EventSub connect rather than crashing.
- **URL integrity:** the rephrase prompt mandates verbatim URLs; the bot posts as
  broadcaster, which is exempt from moderation, so its own links are never
  filtered.

## Testing

Node's built-in `node:test` + `node:assert/strict` (no framework), matching the
base project. Focus on logic that breaks silently:

- **persona.ts** — `sanitizeForChat` (newline collapse, cap, URL preserved);
  `complete`/`ask`/`rephrase` with an **injected fake client** asserting the
  request params (model, max_tokens, system = persona, avoidLast wiring) and text
  extraction; error path surfaces typed errors.
- **timers.ts** — `nextMessage` rotation wraps correctly; the gate logic (elapsed
  + minChatLines) with a stubbed clock/emit; rephrase-failure falls back to seed.
- **quotes** — add / random / by-id / delete / empty-list, via the router.
- **eventsub.ts** — message handling against a fake socket: welcome→subscribe,
  notification→redemption emit, reconnect handling.
- **helix additions** — request URL/body construction with the recorder fetch
  (createCustomReward body has `is_user_input_required: true`;
  updateRedemptionStatus PATCHes the right query + status; subscribeEventSub
  transport shape).

EventSub live socket and Electron/dashboard remain manual-verification (as in the
base spec); their pure logic is unit-tested as above.

## Dependencies

- Add `@anthropic-ai/sdk` (official Claude client — required over raw HTTP per
  the Anthropic API guidance).
- EventSub uses the platform WebSocket (`ws` may be needed under Node; Node 22+
  has a global `WebSocket` — prefer the global, add `ws` only if the runtime
  lacks it). Native `fetch` continues for all Helix calls.
