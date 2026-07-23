import { contextBridge, ipcRenderer } from 'electron';
import type { Config } from '../core/types.js';

contextBridge.exposeInMainWorld('api', {
  getConfig: (): Promise<Config> => ipcRenderer.invoke('config:get'),
  saveConfig: (c: Config): Promise<void> => ipcRenderer.invoke('config:save', c),
  startBot: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('bot:start'),
  stopBot: (): Promise<void> => ipcRenderer.invoke('bot:stop'),
  beginAuth: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('auth:begin'),
  onStatus: (fn: (s: string) => void) => ipcRenderer.on('bot:status', (_e, s) => fn(s)),
  createReward: (name: string, cost: number): Promise<{ ok: boolean; error?: string; reward?: { id: string; title: string; cost: number } }> => ipcRenderer.invoke('reward:create', name, cost),
});
