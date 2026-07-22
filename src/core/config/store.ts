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
