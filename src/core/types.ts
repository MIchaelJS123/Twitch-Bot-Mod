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
