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
    this.lastPost = 0;
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
