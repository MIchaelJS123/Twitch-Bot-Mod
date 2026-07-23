import { app, BrowserWindow, Tray, Menu, ipcMain, shell } from 'electron';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from '../core/config/store.js';
import { Bot } from '../core/bot.js';
import { authorizeUrl, exchangeCode, validate, refresh as refreshToken } from '../core/auth/oauth.js';
import { HelixClient } from '../core/connection/helix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REDIRECT = 'http://localhost:5123/callback';

const store = new ConfigStore(join(app.getPath('userData'), 'config.json'));
store.load();
let bot: Bot | null = null;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 900, height: 700,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(join(__dirname, '../ui/index.html'));
  win.on('close', e => { if (!(app as any).quitting) { e.preventDefault(); win?.hide(); } });
}

function createTray() {
  tray = new Tray(join(__dirname, '../ui/icon.png'));
  tray.setToolTip('TwitchBot');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => win?.show() },
    { label: 'Quit', click: () => { (app as any).quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => win?.show());
}

// One-time OAuth: open consent in the system browser, catch the redirect locally.
function beginAuth(): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    const auth = store.get().auth;
    if (!auth.clientId || !auth.clientSecret) { resolve({ ok: false, error: 'Enter client ID and secret first.' }); return; }
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, REDIRECT);
      if (url.pathname !== '/callback') { res.statusCode = 204; res.end(); return; }
      const code = url.searchParams.get('code');
      if (!code) {
        const error = url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'Missing code';
        res.end('Authorization was cancelled or failed. You can close this tab.');
        server.close();
        resolve({ ok: false, error });
        return;
      }
      try {
        const t = await exchangeCode(auth.clientId, auth.clientSecret, code, REDIRECT);
        const v = await validate(t.accessToken);
        const next = store.get();
        next.auth = { ...next.auth, accessToken: t.accessToken, refreshToken: t.refreshToken, broadcasterId: v.userId, login: v.login };
        store.save(next);
        res.end('Authorized! You can close this tab and return to TwitchBot.');
        server.close();
        resolve({ ok: true });
      } catch (e) {
        res.end('Auth failed: ' + (e as Error).message);
        server.close();
        resolve({ ok: false, error: (e as Error).message });
      }
    });
    server.on('error', err => resolve({ ok: false, error: (err as Error).message }));
    server.listen(5123, () => shell.openExternal(authorizeUrl(auth.clientId, REDIRECT)));
  });
}

ipcMain.handle('config:get', () => store.get());
ipcMain.handle('config:save', (_e, c) => { store.save(c); });
ipcMain.handle('auth:begin', () => beginAuth());
ipcMain.handle('bot:start', async () => {
  if (bot) return { ok: true };
  try {
    bot = new Bot(store);
    bot.onStatus(s => win?.webContents.send('bot:status', s));
    await bot.start();
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
});
ipcMain.handle('bot:stop', async () => { try { await bot?.stop(); } finally { bot = null; } });
ipcMain.handle('reward:create', async (_e, name: string, cost: number) => {
  const a = store.get().auth;
  if (!a.accessToken || !a.broadcasterId) return { ok: false, error: 'Authorize first.' };
  const helix = new HelixClient({
    getToken: () => store.get().auth.accessToken,
    getClientId: () => store.get().auth.clientId,
    getBroadcasterId: () => store.get().auth.broadcasterId,
    onUnauthorized: async () => {
      try {
        const t = await refreshToken(a.clientId, a.clientSecret, a.refreshToken);
        const next = store.get(); next.auth.accessToken = t.accessToken; next.auth.refreshToken = t.refreshToken; store.save(next);
        return true;
      } catch { return false; }
    },
  });
  try {
    const reward = await helix.createCustomReward(name, Number(cost), 'Type your question for the bot');
    const next = store.get();
    next.ai.reward = { id: reward.id, title: name, cost: Number(cost) };
    store.save(next);
    return { ok: true, reward: next.ai.reward };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
});

app.whenReady().then(() => {
  app.setLoginItemSettings({ openAtLogin: true }); // start on boot
  createWindow();
  createTray();
});
app.on('window-all-closed', () => { /* keep running in tray */ });
