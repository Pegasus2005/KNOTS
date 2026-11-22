import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('knots', {
  pauseRun: (id: string) => ipcRenderer.invoke('runs:pause', id),
  resumeRun: (id: string, grants?: unknown, reply?: string) =>
    ipcRenderer.invoke('runs:resume', id, grants, reply),
  reconcileAction: (runId: string, id: string, mode: string, grants?: unknown) =>
    ipcRenderer.invoke('actions:reconcile', runId, id, mode, grants),
  stopWorker: () => ipcRenderer.invoke('worker:stop'),
  enableWorker: () => ipcRenderer.invoke('worker:enable'),
  teachingList: () => ipcRenderer.invoke('teaching:list'),
  teachingCreate: (input: unknown) => ipcRenderer.invoke('teaching:create', input),
  teachingEvaluate: (id: string, examples: string[], strandId: string) =>
    ipcRenderer.invoke('teaching:evaluate', id, examples, strandId),
  teachingAssess: (id: string, assessment: string) =>
    ipcRenderer.invoke('teaching:assess', id, assessment),
  teachingDecide: (id: string, action: string) => ipcRenderer.invoke('teaching:decide', id, action),
  decideAction: (id: string, approve: boolean) => ipcRenderer.invoke('actions:decide', id, approve),
  cancelPlan: () => ipcRenderer.invoke('tasks:cancel-plan'),
  planTask: (prompt: string) => ipcRenderer.invoke('tasks:plan', prompt),
  setStrandRouting: (id: string, routing: unknown) =>
    ipcRenderer.invoke('strands:routing', id, routing),
  setDefaultStrand: (id: string) => ipcRenderer.invoke('strands:default', id),
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
});
