import { ChatMessage, ModerationConfig, Verdict } from '../types.js';

function fail(reason: string, cfg: ModerationConfig): Verdict {
  return { ok: false, reason, action: cfg.defaultAction };
}

export function hasBannedWord(text: string, bannedWords: string[]): boolean {
  const lower = text.toLowerCase();
  for (const word of bannedWords) {
    if (!word) continue;
    const re = new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(lower)) return true;
  }
  return false;
}

export function checkBannedWords(msg: ChatMessage, cfg: ModerationConfig): Verdict {
  return hasBannedWord(msg.message, cfg.bannedWords) ? fail('banned word', cfg) : { ok: true };
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
