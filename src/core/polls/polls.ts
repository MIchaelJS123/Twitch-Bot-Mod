import { HelixClient, Poll } from '../connection/helix.js';

export class Polls {
  constructor(private helix: HelixClient) {}

  async start(title: string, choices: string[], durationSec: number): Promise<Poll> {
    if (choices.length < 2) throw new Error('a poll needs at least 2 choices');
    if (choices.length > 5) throw new Error('Twitch polls allow at most 5 choices');
    return this.helix.createPoll(title, choices, durationSec);
  }

  status(id: string): Promise<Poll> {
    return this.helix.getPoll(id);
  }

  end(id: string): Promise<Poll> {
    return this.helix.endPoll(id, 'TERMINATED');
  }

  formatResults(poll: Poll): string {
    const total = poll.choices.reduce((n, c) => n + c.votes, 0) || 1;
    const winner = poll.choices.reduce((a, b) => (b.votes > a.votes ? b : a));
    const lines = poll.choices
      .map(c => `${c.title}: ${c.votes} (${Math.round((c.votes / total) * 100)}%)`)
      .join(' | ');
    return `📊 ${poll.title} — ${lines}. Winner: ${winner.title}`;
  }
}
