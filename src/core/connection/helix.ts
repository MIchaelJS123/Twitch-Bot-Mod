export interface Poll {
  id: string;
  title: string;
  status: string;
  choices: { title: string; votes: number }[];
}

export interface TokenProvider {
  getToken(): string;
  getClientId(): string;
  getBroadcasterId(): string;
  onUnauthorized(): Promise<boolean>; // refresh token; return true if retry should happen
}

const BASE = 'https://api.twitch.tv/helix';

export class HelixClient {
  constructor(private tp: TokenProvider, private fetchImpl: typeof fetch = fetch) {}

  private async request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        'Client-Id': this.tp.getClientId(),
        'Authorization': `Bearer ${this.tp.getToken()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401 && retry && (await this.tp.onUnauthorized())) {
      return this.request(url, init, false);
    }
    if (!res.ok) {
      throw new Error(`Helix ${res.status}: ${await res.text()}`);
    }
    return res;
  }

  private bid() { return this.tp.getBroadcasterId(); }

  async deleteMessage(messageId: string): Promise<void> {
    const url = `${BASE}/moderation/chat?broadcaster_id=${this.bid()}&moderator_id=${this.bid()}&message_id=${messageId}`;
    await this.request(url, { method: 'DELETE' });
  }

  async timeoutUser(userId: string, seconds: number, reason = ''): Promise<void> {
    const url = `${BASE}/moderation/bans?broadcaster_id=${this.bid()}&moderator_id=${this.bid()}`;
    await this.request(url, { method: 'POST', body: JSON.stringify({ data: { user_id: userId, duration: seconds, reason } }) });
  }

  async banUser(userId: string, reason = ''): Promise<void> {
    const url = `${BASE}/moderation/bans?broadcaster_id=${this.bid()}&moderator_id=${this.bid()}`;
    await this.request(url, { method: 'POST', body: JSON.stringify({ data: { user_id: userId, reason } }) });
  }

  async createPoll(title: string, choices: string[], durationSec: number): Promise<Poll> {
    const url = `${BASE}/polls`;
    const res = await this.request(url, {
      method: 'POST',
      body: JSON.stringify({ broadcaster_id: this.bid(), title, choices: choices.map(c => ({ title: c })), duration: durationSec }),
    });
    return (await res.json()).data[0];
  }

  async getPoll(id: string): Promise<Poll> {
    const res = await this.request(`${BASE}/polls?broadcaster_id=${this.bid()}&id=${id}`);
    return (await res.json()).data[0];
  }

  async endPoll(id: string, status: 'TERMINATED' | 'ARCHIVED'): Promise<Poll> {
    const res = await this.request(`${BASE}/polls`, {
      method: 'PATCH',
      body: JSON.stringify({ broadcaster_id: this.bid(), id, status }),
    });
    return (await res.json()).data[0];
  }
}
