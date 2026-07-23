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
