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
  return oneLine.length > maxChars ? oneLine.slice(0, maxChars).trimEnd() : oneLine;
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

const REPHRASE_SYSTEM =
  "You rewrite a streamer's announcement into one short, fresh Twitch chat message (under 200 characters). " +
  'Copy any URLs exactly and unchanged. Vary the wording each time. Output only the message — no quotes, no preamble.';

export function rephrase(seed: string, cfg: AIConfig, avoidLast: string | undefined, client: MessagesClient): Promise<string> {
  const system = cfg.persona ? `${REPHRASE_SYSTEM}\nVoice: ${cfg.persona}` : REPHRASE_SYSTEM;
  const user = avoidLast ? `${seed}\n\nAvoid repeating this exact wording: ${avoidLast}` : seed;
  return complete(client, cfg.model, system, user, cfg.maxReplyChars);
}
