import { Permission } from '../types.js';
import { BuiltinHandler } from './router.js';
import { Polls } from '../polls/polls.js';
import { Moderator } from '../moderation/moderator.js';

interface Deps {
  polls: Polls;
  moderator: Moderator;
  activePoll: { id: string | null };
  save: () => void;
}

export function buildBuiltins(deps: Deps): Record<string, { permission: Permission; handler: BuiltinHandler }> {
  return {
    poll: {
      permission: 'mod',
      handler: async ctx => {
        const parts = ctx.args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
        if (parts.length < 3) { ctx.reply('Usage: !poll Question | choice1 | choice2'); return; }
        const [title, ...choices] = parts;
        try {
          const poll = await deps.polls.start(title, choices, ctx.config.polls.defaultDurationSec);
          deps.activePoll.id = poll.id;
          ctx.reply(`📊 Poll started: ${title} — vote on stream!`);
        } catch (e) {
          ctx.reply(`Couldn't start poll: ${(e as Error).message}`);
        }
      },
    },
    endpoll: {
      permission: 'mod',
      handler: async ctx => {
        if (!deps.activePoll.id) { ctx.reply('No active poll.'); return; }
        try {
          const poll = await deps.polls.end(deps.activePoll.id);
          deps.activePoll.id = null;
          ctx.reply(deps.polls.formatResults(poll));
        } catch (e) {
          ctx.reply(`Couldn't end poll: ${(e as Error).message}`);
        }
      },
    },
    permit: {
      permission: 'mod',
      handler: ctx => {
        const user = ctx.args[0];
        if (!user) { ctx.reply('Usage: !permit <user>'); return; }
        deps.moderator.permit(user, ctx.config.moderation.permitDurationSec);
        ctx.reply(`${user} may post links for ${ctx.config.moderation.permitDurationSec}s.`);
      },
    },
  };
}
