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
      // Merge each section over defaults so fields added in later versions are backfilled,
      // even inside nested objects (a top-level spread would drop them).
      const parsed = JSON.parse(raw) as Partial<Config>;
      const d = defaultConfig();
      this.current = {
        auth: { ...d.auth, ...parsed.auth },
        moderation: { ...d.moderation, ...parsed.moderation },
        commands: parsed.commands ?? d.commands,
        polls: { ...d.polls, ...parsed.polls },
        ai: { ...d.ai, ...parsed.ai },
        quotes: parsed.quotes ?? d.quotes,
        timers: { ...d.timers, ...parsed.timers },
      };
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
