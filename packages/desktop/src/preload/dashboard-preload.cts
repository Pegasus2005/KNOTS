import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('knots', {
  workspace: () => ipcRenderer.invoke('workspace:get'),
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
});
