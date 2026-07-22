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
    this.onOutgoing(t => { void this.chat?.say(t); });
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
    await this.chat.connect();
  }

  async stop(): Promise<void> {
    await this.chat?.disconnect();
    this.chat = null;
  }
}
