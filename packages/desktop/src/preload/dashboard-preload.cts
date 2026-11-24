import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('knots', {
  saveMcpServer: (input: unknown) => ipcRenderer.invoke('mcp:save', input),
  removeMcpServer: (name: string) => ipcRenderer.invoke('mcp:remove', name),
  inspectMcpServer: (name: string) => ipcRenderer.invoke('mcp:inspect', name),
  decideMcpAction: (id: string, approve: boolean) => ipcRenderer.invoke('mcp:decide', id, approve),
  reconcileMcpAction: (runId: string, id: string, result: string) =>
    ipcRenderer.invoke('mcp:reconcile', runId, id, result),
  listKnowledge: (name: string) => ipcRenderer.invoke('knowledge:list', name),
  attachKnowledge: (name: string) => ipcRenderer.invoke('knowledge:attach', name),
  detachKnowledge: (name: string, ref: string) => ipcRenderer.invoke('knowledge:detach', name, ref),
  exportKnot: (name: string) => ipcRenderer.invoke('knots:export', name),
  previewImport: () => ipcRenderer.invoke('knots:import-preview'),
  importKnot: (token: string, name: string) => ipcRenderer.invoke('knots:import', token, name),
  createPlan: (goal: string, privacy: string) => ipcRenderer.invoke('plans:create', goal, privacy),
  editPlan: (id: string, definition: unknown) => ipcRenderer.invoke('plans:edit', id, definition),
  approvePlan: (id: string, grants?: unknown) => ipcRenderer.invoke('plans:approve', id, grants),
  resumePlan: (id: string, grants?: unknown) => ipcRenderer.invoke('plans:resume', id, grants),
  pausePlan: (id: string) => ipcRenderer.invoke('plans:pause', id),
  cancelTaskPlan: (id: string) => ipcRenderer.invoke('plans:cancel', id),
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
