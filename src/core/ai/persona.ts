import Anthropic from '@anthropic-ai/sdk';
import { AIConfig } from '../types.js';

export interface MessagesClient {
  messages: {
    create(params: any): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export function makeClient(apiKey: string): MessagesClient {
  return new Anthropic({ apiKey }) as unknown as MessagesClient;
}

export function sanitizeForChat(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxChars) return oneLine;
  const cut = oneLine.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

async function complete(client: MessagesClient, model: string, system: string, user: string, maxChars: number): Promise<string> {
  const res = await client.messages.create({
    model,
    max_tokens: 150,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.find(b => b.type === 'text')?.text ?? '';
  return sanitizeForChat(text, maxChars);
}

export function ask(question: string, cfg: AIConfig, client: MessagesClient): Promise<string> {
  return complete(client, cfg.model, cfg.persona, question, cfg.maxReplyChars);
}

function rephraseSystem(maxChars: number): string {
  return "You rewrite a streamer's announcement into one short, fresh Twitch chat message " +
    `(under ${maxChars} characters). ` +
    'Copy any URLs exactly and unchanged. Vary the wording each time. Output only the message — no quotes, no preamble.';
}

export function rephrase(seed: string, cfg: AIConfig, avoidLast: string | undefined, client: MessagesClient): Promise<string> {
  const base = rephraseSystem(cfg.maxReplyChars);
  const system = cfg.persona ? `${base}\nVoice: ${cfg.persona}` : base;
  const user = avoidLast ? `${seed}\n\nAvoid repeating this exact wording: ${avoidLast}` : seed;
  return complete(client, cfg.model, system, user, cfg.maxReplyChars);
}
