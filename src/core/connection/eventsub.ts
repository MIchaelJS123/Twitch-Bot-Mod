import { AuthConfig } from '../types.js';
import { HelixClient } from './helix.js';

export interface Redemption {
  id: string;
  rewardId: string;
  userInput: string;
  userName: string;
}

export type WSLike = {
  send(d: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

const WS_URL = 'wss://eventsub.wss.twitch.tv/ws';
const REDEMPTION_TYPE = 'channel.channel_points_custom_reward_redemption.add';

export class EventSubClient {
  private ws: WSLike | null = null;
  private rewardId = '';
  private redemptionHandlers: ((r: Redemption) => void)[] = [];
  private statusHandlers: ((s: string) => void)[] = [];

  constructor(
    private auth: AuthConfig,
    private helix: Pick<HelixClient, 'subscribeEventSub'>,
    private wsFactory: (url: string) => WSLike = (url) => new WebSocket(url) as unknown as WSLike,
  ) {}

  onRedemption(fn: (r: Redemption) => void): void { this.redemptionHandlers.push(fn); }
  onStatus(fn: (s: string) => void): void { this.statusHandlers.push(fn); }
  private status(s: string): void { for (const fn of this.statusHandlers) fn(s); }

  connect(rewardId: string): void {
    this.rewardId = rewardId;
    this.open(WS_URL);
  }

  private open(url: string): void {
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; this.ws.close(); }
    const ws = this.wsFactory(url);
    this.ws = ws;
    ws.onmessage = (ev) => this.handle(String(ev.data));
    ws.onclose = () => this.status('disconnected');
    ws.onerror = () => this.status('error');
    ws.onopen = () => this.status('connected');
  }

  private handle(raw: string): void {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      switch (msg.metadata?.message_type) {
        case 'session_welcome':
          this.helix.subscribeEventSub(
            REDEMPTION_TYPE, '1',
            { broadcaster_user_id: this.auth.broadcasterId, reward_id: this.rewardId },
            msg.payload.session.id,
          ).catch(() => this.status('subscribe-failed'));
          break;
        case 'session_keepalive':
          break;
        case 'notification': {
          const e = msg.payload.event;
          for (const fn of this.redemptionHandlers) {
            fn({ id: e.id, rewardId: e.reward.id, userInput: e.user_input, userName: e.user_name });
          }
          break;
        }
        case 'session_reconnect':
          this.open(msg.payload.session.reconnect_url);
          break;
        case 'revocation':
          this.status('revoked');
          break;
      }
    } catch {
      this.status('bad-message');
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
