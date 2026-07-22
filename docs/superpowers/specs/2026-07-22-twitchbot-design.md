# TwitchBot — Design Spec

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan

## Purpose

A Twitch-integrated chat bot for the owner's own channel: automated chat
moderation with customization, native Twitch polls, and general chat
interaction (custom commands). Packaged as a Windows **desktop application**
(Electron) with a dashboard for configuration.

The channel is Affiliate/Partner, so **native Twitch polls** are used (no
chat-poll fallback needed).

## Scope

### In scope (build now)

- Single-channel bot for the owner's own Twitch account.
- Chat connection: read messages, send replies (via `tmi.js`).
- Moderation pipeline with configurable filters and actions.
- Custom commands (text replies, counters, cooldowns) + built-in commands.
- Native Twitch polls (start, show live results, end) via the Helix API.
- Electron desktop app: window, system-tray icon, start-on-boot.
- Dashboard UI to manage commands, moderation rules, and polls.
- One-time OAuth flow to authorize the owner's account; token stored locally.
- JSON config store shared in-process by bot core and dashboard.

### Out of scope (deferred — doors left open, not built)

- **Multi-tenant / selling to other streamers.** Deferred. The config layer is
  the only seam that must change (JSON → SQLite + per-channel config) when a
  second channel actually exists. No DB, no per-channel abstraction until then.
- **Voice-in (speak → bot acts).** Deferred. The bot exposes **one command
  dispatch entry point**; a future speech-to-text module calls the same entry
  point. No speech code now.
- Native poll fallback (chat-counted polls) — not needed, channel is Affiliate.

## Architecture

One Node.js + TypeScript project. The **bot core is UI-agnostic plain TS** (no
Electron imports) so it can also run headless on a server later. Electron is a
wrapper around that core.

```
src/
  core/                 plain TS, no Electron; headless-capable
    connection/
      chat.ts           tmi.js client: connect, on-message, send
      helix.ts          Helix REST client: moderation actions + polls
    moderation/
      filters.ts        pure functions: message -> verdict
      moderator.ts      applies verdict -> action via helix
    commands/
      router.ts         parse message -> command; run built-in or custom
      builtins.ts       !poll, mod actions, etc.
      custom.ts         user-defined commands (text/counter/cooldown)
    polls/
      polls.ts          native Twitch polls via Helix
    config/
      store.ts          load/save/watch JSON config; single source of truth
    bot.ts              wires modules; ONE dispatch(entry) point
    auth/
      oauth.ts          OAuth authorization-code flow; token storage/refresh
  app/                  Electron main process: window, tray, autostart, IPC
  ui/                   dashboard renderer: commands, rules, polls views
```

### Message pipeline

```
incoming chat message
   -> moderation filters  (banned words, caps%, links, symbol spam)
      -> if violation: action (delete / timeout / ban) via Helix, stop
   -> command router      (built-in or custom command)
      -> reply via chat
```

Moderators and the broadcaster are exempt from moderation filters.

### Command dispatch entry point

`bot.ts` exposes a single `dispatch(command, context)` function. Chat messages
route through it; the future voice module will call the same function. This is
the one seam that keeps voice-in cheap to add.

## Components

### Connection

- **chat.ts** — wraps `tmi.js`. Responsibilities: connect with OAuth token,
  emit incoming messages to the pipeline, send outgoing messages. Depends on:
  config (channel name, token).
- **helix.ts** — thin Helix REST client. Responsibilities: timeout/ban/unban a
  user, delete a message, create/end/get polls. Depends on: OAuth token,
  broadcaster ID. Handles token-expired → refresh via auth.

### Moderation

- **filters.ts** — pure functions, each takes a message and returns a verdict
  (`ok` or a violation with reason). Filters: banned words, caps percentage,
  max links, symbol/emote spam. Configurable thresholds. Independently testable
  (no I/O).
- **moderator.ts** — maps a violation verdict to an action (delete / timeout /
  ban) and calls helix. Honors `!permit <user>` allowlist and mod/broadcaster
  exemption.

### Commands

- **router.ts** — parses a message into a command + args; dispatches to a
  built-in or custom command; enforces per-command cooldowns and permission
  level (everyone / mod / broadcaster).
- **builtins.ts** — `!poll ...` (start/end poll), mod actions (`!ban`,
  `!timeout`, `!permit`), and utility commands.
- **custom.ts** — user-defined commands stored in config: text replies with
  variables, incrementing counters, cooldowns. Add/edit/remove from chat or
  dashboard.

### Polls

- **polls.ts** — native Twitch polls via Helix: create a poll (title, choices,
  duration), fetch live status, end early. Surfaces results to the dashboard
  and (optionally) announces results in chat.

### Config store

- **store.ts** — single JSON file is the source of truth for: channel/auth
  settings, moderation rules, custom commands, poll defaults. Load on start,
  save on change, notify subscribers (bot reacts to live edits). Bot core and
  dashboard share this in one process, so no concurrency layer is needed.

### Auth

- **oauth.ts** — OAuth authorization-code flow against Twitch. The owner
  registers a Twitch app once (client ID + secret, entered in the dashboard).
  The app opens the Twitch consent page, receives the code on a localhost
  redirect, exchanges it for tokens, and stores them locally. Refreshes the
  access token when expired.
- **Account model:** the owner's single account acts as both broadcaster and
  bot. One token, all scopes.
- **Scopes:** `chat:read`, `chat:edit`, `channel:manage:polls`,
  `channel:read:polls`, `moderator:manage:banned_users`,
  `moderator:manage:chat_messages`.

### Electron shell

- **app/** — main process: creates the window, system-tray icon (show/hide,
  quit), start-on-boot toggle, and starts/stops the bot core. Bridges the UI
  (renderer) to the core via IPC.
- **ui/** — dashboard renderer: views for custom commands, moderation rules,
  and polls; plus the first-run auth setup (enter client ID/secret, authorize).

## Data flow

1. **Startup:** Electron main starts → loads config → if authorized, bot core
   connects chat + helix; else UI shows the auth setup.
2. **Incoming message:** chat.ts → moderation filters → (action or) command
   router → reply.
3. **Dashboard edit:** UI → IPC → config store save → subscribers (moderation,
   commands) pick up the change live.
4. **Poll:** UI or `!poll` → polls.ts → Helix create → live status polled →
   results shown in UI / announced in chat.

## Error handling

- **Token expired / invalid:** helix + chat detect 401 → attempt refresh → if
  refresh fails, surface "re-authorize" state in the UI; bot pauses cleanly.
- **Helix rate limits / 5xx:** retry with backoff a bounded number of times;
  log and surface a non-fatal error to the UI; never crash the app.
- **Chat disconnect:** tmi.js auto-reconnect; UI shows connection status.
- **Native poll unavailable** (e.g., a poll already running, or perms): surface
  the Helix error message to the UI / chat; do not crash.
- **Config corruption:** on load failure, back up the bad file and start from
  defaults rather than crashing; surface a warning in the UI.

## Testing

- **Moderation filters** — pure functions; unit tests over representative
  messages (clean, all-caps, links, banned words, symbol spam) asserting the
  verdict. This is the highest-value test surface.
- **Command router** — unit tests: parsing, permission levels, cooldowns.
- **Config store** — round-trip load/save; corruption → defaults; subscriber
  notification.
- **Connection / Helix / polls** — thin wrappers over external APIs; tested
  against a mocked Helix client for the action mapping (verdict → correct
  endpoint call), not against live Twitch.

No test framework beyond a lightweight runner; no fixtures beyond sample
messages. Tests focus on the logic that breaks silently (filters, router).

## Prerequisites (owner setup)

- A registered Twitch application (client ID + secret) from the Twitch
  Developer Console, with the localhost redirect URL the app uses.
- The owner's Twitch account is Affiliate/Partner (already true) for native
  polls.
