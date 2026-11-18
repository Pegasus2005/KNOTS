/**
 * Dashboard preload — exposes KNOTS API to dashboard renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from 'electron';

type IpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const knots = {
  // ── Knots ────────────────────────────────────────────────────────────────
  listKnots: (): Promise<IpcResult> => ipcRenderer.invoke('knots:list'),
  getKnot: (name: string): Promise<IpcResult> => ipcRenderer.invoke('knots:get', name),
  createKnot: (spec: Record<string, unknown>): Promise<IpcResult> => ipcRenderer.invoke('knots:create', spec),
  validateKnot: (spec: Record<string, unknown>): Promise<IpcResult> => ipcRenderer.invoke('knots:validate', spec),

  // ── Strands ──────────────────────────────────────────────────────────────
  listStrands: (): Promise<IpcResult> => ipcRenderer.invoke('strands:list'),
  addStrand: (input: Record<string, unknown>): Promise<IpcResult> => ipcRenderer.invoke('strands:add', input),
  testStrand: (strandId: string): Promise<IpcResult> => ipcRenderer.invoke('strands:test', strandId),
  removeStrand: (strandId: string): Promise<IpcResult> => ipcRenderer.invoke('strands:remove', strandId),

  // ── Lanes ────────────────────────────────────────────────────────────────
  listLanes: (): Promise<IpcResult> => ipcRenderer.invoke('lanes:list'),
  setLane: (input: { name: string; strand_order: string[] }): Promise<IpcResult> => ipcRenderer.invoke('lanes:set', input),
  removeLane: (laneId: string): Promise<IpcResult> => ipcRenderer.invoke('lanes:remove', laneId),

  // ── Runs ─────────────────────────────────────────────────────────────────
  startRun: (input: Record<string, unknown>): Promise<IpcResult> => ipcRenderer.invoke('runs:start', input),
  cancelRun: (runId: string): Promise<IpcResult> => ipcRenderer.invoke('runs:cancel', runId),
  listRuns: (limit?: number): Promise<IpcResult> => ipcRenderer.invoke('runs:list', limit),

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: (key?: string): Promise<IpcResult> => ipcRenderer.invoke('settings:get', key),
  setSettings: (key: string, value: unknown): Promise<IpcResult> => ipcRenderer.invoke('settings:set', key, value),

  // ── App ───────────────────────────────────────────────────────────────────
  killAll: (): Promise<IpcResult> => ipcRenderer.invoke('app:kill-all'),

  // ── Event listeners ───────────────────────────────────────────────────────
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
