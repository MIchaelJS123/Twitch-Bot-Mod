import { join } from 'node:path';
import { ConfigStore } from './config/store.js';
import { Bot } from './bot.js';

const store = new ConfigStore(join(process.cwd(), 'config.json'));
store.load();

const bot = new Bot(store);
bot.onStatus(s => console.log(`[chat] ${s}`));
bot.start()
  .then(() => console.log('Bot started. Press Ctrl+C to stop.'))
  .catch(e => { console.error('Failed to start:', e.message); process.exit(1); });

process.on('SIGINT', () => { void bot.stop().then(() => process.exit(0)); });
