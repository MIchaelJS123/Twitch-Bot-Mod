import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Polls } from '../src/core/polls/polls.js';

test('start validates at least two choices', async () => {
  const p = new Polls({} as any);
  await assert.rejects(() => p.start('Q', ['only one'], 60), /at least 2/);
});

test('formatResults renders votes and a winner', () => {
  const p = new Polls({} as any);
  const out = p.formatResults({ id: 'p', title: 'Best?', status: 'COMPLETED',
    choices: [{ title: 'A', votes: 3 }, { title: 'B', votes: 7 }] });
  assert.match(out, /Best\?/);
  assert.match(out, /B.*7/);
});

test('start delegates to helix.createPoll', async () => {
  let called: any = null;
  const helix = { createPoll: async (t: string, c: string[], d: number) => { called = { t, c, d }; return { id: 'x', title: t, status: 'ACTIVE', choices: [] }; } } as any;
  await new Polls(helix).start('Q', ['A', 'B'], 90);
  assert.deepEqual(called, { t: 'Q', c: ['A', 'B'], d: 90 });
});
