import { ChatMessage, ModerationConfig, ModAction } from '../types.js';
import { moderate } from './filters.js';
import { HelixClient } from '../connection/helix.js';

export class Moderator {
  private permits = new Map<string, number>(); // username -> expiry epoch ms

  constructor(private helix: HelixClient) {}

  permit(username: string, seconds: number): void {
    this.permits.set(username.toLowerCase(), Date.now() + seconds * 1000);
  }

  private isPermitted(username: string): boolean {
    const exp = this.permits.get(username.toLowerCase());
    if (exp && exp > Date.now()) { this.permits.delete(username.toLowerCase()); return true; }
    return false;
  }

  async handle(msg: ChatMessage, cfg: ModerationConfig): Promise<boolean> {
    if (!cfg.enabled) return false;
    if (msg.isMod || msg.isBroadcaster) return false;
    if (this.isPermitted(msg.username)) return false;

    const verdict = moderate(msg, cfg);
    if (verdict.ok) return false;

    await this.apply(msg, verdict.action);
    return true;
  }

  private async apply(msg: ChatMessage, action: ModAction): Promise<void> {
    switch (action.type) {
      case 'delete': await this.helix.deleteMessage(msg.messageId); break;
      case 'timeout': await this.helix.timeoutUser(msg.userId, action.seconds, 'auto-mod'); break;
      case 'ban': await this.helix.banUser(msg.userId, 'auto-mod'); break;
    }
  }
}
