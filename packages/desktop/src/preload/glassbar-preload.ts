/**
 * Glass bar preload — exposes a minimal KNOTS API to the glass bar renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

type IpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const knots = {
  listKnots: (): Promise<IpcResult> => ipcRenderer.invoke('knots:list'),
  listStrands: (): Promise<IpcResult> => ipcRenderer.invoke('strands:list'),
  startRun: (input: Record<string, unknown>): Promise<IpcResult> => ipcRenderer.invoke('runs:start', input),
  cancelRun: (runId: string): Promise<IpcResult> => ipcRenderer.invoke('runs:cancel', runId),
  killAll: (): Promise<IpcResult> => ipcRenderer.invoke('app:kill-all'),
  hide: (): Promise<IpcResult> => ipcRenderer.invoke('glassbar:hide'),

  onRunChunk: (handler: (data: unknown) => void) => {
    ipcRenderer.on('run:chunk', (_event, data) => handler(data));
  },
  onRunComplete: (handler: (data: unknown) => void) => {
    ipcRenderer.on('run:complete', (_event, data) => handler(data));
  },
  onRunError: (handler: (data: unknown) => void) => {
    ipcRenderer.on('run:error', (_event, data) => handler(data));
  },
  onKillAll: (handler: (data: unknown) => void) => {
    ipcRenderer.on('kill-all', (_event, data) => handler(data));
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld('knots', knots);
