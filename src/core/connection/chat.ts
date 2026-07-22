import tmi from 'tmi.js';
import { AuthConfig, ChatMessage } from '../types.js';

export class ChatClient {
  private client: tmi.Client;
  private messageHandlers: ((m: ChatMessage) => void)[] = [];
  private statusHandlers: ((s: 'connected' | 'disconnected') => void)[] = [];

  constructor(private auth: AuthConfig) {
    this.client = new tmi.Client({
      options: { skipUpdatingEmotesets: true },
      connection: { reconnect: true, secure: true },
      identity: { username: auth.login, password: `oauth:${auth.accessToken}` },
      channels: [auth.login],
    });

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      const m: ChatMessage = {
        channel: channel.replace('#', ''),
        username: (tags.username ?? '').toLowerCase(),
        displayName: tags['display-name'] ?? tags.username ?? '',
        userId: tags['user-id'] ?? '',
        messageId: tags.id ?? '',
        message,
        isMod: tags.mod === true || tags.badges?.broadcaster === '1',
        isBroadcaster: tags.badges?.broadcaster === '1',
        isSubscriber: tags.subscriber === true,
      };
      for (const fn of this.messageHandlers) fn(m);
    });

    this.client.on('connected', () => this.statusHandlers.forEach(f => f('connected')));
    this.client.on('disconnected', () => this.statusHandlers.forEach(f => f('disconnected')));
  }

  onMessage(fn: (m: ChatMessage) => void): void { this.messageHandlers.push(fn); }
  onStatus(fn: (s: 'connected' | 'disconnected') => void): void { this.statusHandlers.push(fn); }
  async connect(): Promise<void> { await this.client.connect(); }
  async say(text: string): Promise<void> { await this.client.say(this.auth.login, text); }
  async disconnect(): Promise<void> { await this.client.disconnect(); }
}
