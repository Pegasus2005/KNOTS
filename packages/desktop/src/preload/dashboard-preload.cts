import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('knots', {
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  workspace: () => ipcRenderer.invoke('workspace:get'),
  saveKnot: (input: unknown) => ipcRenderer.invoke('knots:save', input),
  addSample: () => ipcRenderer.invoke('knots:sample'),
  addStrand: (input: unknown) => ipcRenderer.invoke('strands:add', input),
  testStrand: (id: string) => ipcRenderer.invoke('strands:test', id),
  removeStrand: (id: string) => ipcRenderer.invoke('strands:remove', id),
  preview: (name: string) => ipcRenderer.invoke('runs:preview', name),
  startRun: (input: unknown) => ipcRenderer.invoke('runs:start', input),
  cancelRun: (id: string) => ipcRenderer.invoke('runs:cancel', id),
  onRunEvent: (handler: (data: unknown) => void) => {
    ipcRenderer.on('run:event', (_event, data) => handler(data));
  },
  getRoles: () => ipcRenderer.invoke('swarm:get-roles'),
  setRole: (role: string, binding: unknown) => ipcRenderer.invoke('swarm:set-role', role, binding),
  saveKey: (provider: string, key: string) => ipcRenderer.invoke('swarm:save-key', provider, key),
  getKey: (provider: string) => ipcRenderer.invoke('swarm:get-key', provider),
  runSwarm: (prompt: string) => ipcRenderer.invoke('swarm:run', prompt),
  getWorkspace: () => ipcRenderer.invoke('swarm:get-workspace'),
  setWorkspace: (dir: string) => ipcRenderer.invoke('swarm:set-workspace', dir),
  onSwarmEvent: (handler: (data: unknown) => void) => {
    ipcRenderer.on('swarm:event', (_event, data) => handler(data));
  },
});
