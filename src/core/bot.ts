import { ConfigStore } from './config/store.js';
import { ChatMessage } from './types.js';
import { HelixClient, TokenProvider } from './connection/helix.js';
import { ChatClient } from './connection/chat.js';
import { Moderator } from './moderation/moderator.js';
import { Polls } from './polls/polls.js';
import { CommandRouter } from './commands/router.js';
import { buildBuiltins } from './commands/builtins.js';
import { refresh, validate } from './auth/oauth.js';
import { makeClient, ask as personaAsk, sanitizeForChat, rephrase as personaRephrase } from './ai/persona.js';
import { EventSubClient, Redemption } from './connection/eventsub.js';
import { Timers } from './timers/timers.js';
import { hasBannedWord } from './moderation/filters.js';

export type BotStatus = 'connected' | 'disconnected' | 'needs-reauth';

export async function answerRedemption(
  r: Redemption,
  deps: { ask: (q: string) => Promise<string>; emit: (t: string) => void; fulfill: () => Promise<void>; refund: () => Promise<void> },
): Promise<void> {
  try {
    deps.emit(await deps.ask(r.userInput));
    await deps.fulfill();
  } catch {
    deps.emit('Sorry, I could not answer that — your points were refunded.');
    try { await deps.refund(); } catch { /* refund also failed; nothing more we can do */ }
  }
}

export class Bot {
  private helix: HelixClient;
  private moderator: Moderator;
  private polls: Polls;
  private router: CommandRouter;
  private activePoll = { id: null as string | null };
  private chat: ChatClient | null = null;
  private eventsub: EventSubClient | null = null;
  private timers: Timers;
  private outgoing: ((text: string) => void)[] = [];
  private status: ((s: BotStatus) => void)[] = [];

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
    this.timers = new Timers({
      getConfig: () => this.store.get().timers,
      emit: t => this.emit(t),
      rephrase: async (seed, avoidLast) => {
        const cfg = this.store.get().ai;
        return personaRephrase(seed, cfg, avoidLast, makeClient(cfg.apiKey));
      },
    });
    this.onOutgoing(t => { void this.chat?.say(t); });
  }

  onOutgoing(fn: (text: string) => void): void { this.outgoing.push(fn); }
  onStatus(fn: (s: BotStatus) => void): void { this.status.push(fn); }
  private emit(text: string): void { for (const fn of this.outgoing) fn(text); }
  private emitStatus(s: BotStatus): void { for (const f of this.status) f(s); }

  async dispatch(msg: ChatMessage): Promise<void> {
    this.timers.noteChatLine();
    const cfg = this.store.get();
    try {
      const moderated = await this.moderator.handle(msg, cfg.moderation);
      if (moderated) return;
      const before = JSON.stringify(cfg.commands);
      await this.router.route(msg, cfg, t => this.emit(t));
      if (JSON.stringify(cfg.commands) !== before) this.store.save(cfg); // persist counter changes
    } catch (e) {
      const text = (e as Error).message ?? '';
      if (/Helix 401/i.test(text) || /unauthor/i.test(text)) this.emitStatus('needs-reauth');
      // Swallow so a single failed message (transient API error / auth loss) never crashes the bot;
      // auth loss is surfaced to the UI via the needs-reauth status above.
    }
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
    await this.chat.connect();

    const cfg = this.store.get();
    if (cfg.ai.enabled && cfg.ai.reward) {
      const reward = cfg.ai.reward;
      this.eventsub = new EventSubClient(cfg.auth, this.helix);
      this.eventsub.onStatus(s => this.status.forEach(f => f(s as any)));
      this.eventsub.onRedemption(r => {
        const aiCfg = this.store.get().ai;
        void answerRedemption(r, {
          ask: async q => {
            const reply = sanitizeForChat(await personaAsk(q, aiCfg, makeClient(aiCfg.apiKey)), aiCfg.maxReplyChars);
            if (hasBannedWord(reply, this.store.get().moderation.bannedWords)) {
              throw new Error('reply blocked by banned-word filter');
            }
            return reply;
          },
          emit: t => this.emit(t),
          fulfill: () => this.helix.updateRedemptionStatus(reward.id, r.id, 'FULFILLED'),
          refund: () => this.helix.updateRedemptionStatus(reward.id, r.id, 'CANCELED'),
        }).catch(() => {});
      });
      this.eventsub.connect(reward.id);
    }
    if (cfg.timers.enabled) this.timers.start();
  }

  async stop(): Promise<void> {
    await this.chat?.disconnect();
    this.chat = null;
    this.eventsub?.disconnect();
    this.eventsub = null;
    this.timers.stop();
  }
}
