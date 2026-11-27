import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('knots', {
  playbooksList: () => ipcRenderer.invoke('playbooks:list'),
  playbooksSave: (input: unknown) => ipcRenderer.invoke('playbooks:save', input),
  playbooksEnable: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('playbooks:enable', id, enabled),
  playbooksForget: (id: string) => ipcRenderer.invoke('playbooks:forget', id),
  playbooksFixture: (id: string, input: unknown) =>
    ipcRenderer.invoke('playbooks:fixture', id, input),
  playbooksExport: (ids: string[], reviewed: boolean) =>
    ipcRenderer.invoke('playbooks:export', ids, reviewed),
  playbooksImport: (name: string, bundle: unknown, reviewed: boolean) =>
    ipcRenderer.invoke('playbooks:import', name, bundle, reviewed),
  labPropose: (input: unknown) => ipcRenderer.invoke('lab:propose', input),
  labCompareProposal: (input: unknown) => ipcRenderer.invoke('lab:compare-proposal', input),
  labDecideProposal: (id: string, action: string) =>
    ipcRenderer.invoke('lab:decide-proposal', id, action),
  labDefer: (id: string, deferred: boolean) => ipcRenderer.invoke('lab:defer', id, deferred),
  labList: () => ipcRenderer.invoke('lab:list'),
  labSaveSuite: (input: unknown) => ipcRenderer.invoke('lab:save-suite', input),
  labEvaluate: (input: unknown) => ipcRenderer.invoke('lab:evaluate', input),
  labEnqueue: (id: string) => ipcRenderer.invoke('lab:enqueue', id),
  labCancel: (id: string) => ipcRenderer.invoke('lab:cancel', id),
  labAssess: (id: string, key: string, assessment: string) =>
    ipcRenderer.invoke('lab:assess', id, key, assessment),
  creationList: () => ipcRenderer.invoke('creation:list'),
  creationCreate: (problem: string, privacy: string) =>
    ipcRenderer.invoke('creation:create', problem, privacy),
  creationGenerate: (id: string, clarification: string) =>
    ipcRenderer.invoke('creation:generate', id, clarification),
  creationEdit: (id: string, review: unknown) => ipcRenderer.invoke('creation:edit', id, review),
  creationSave: (id: string, reuse?: string) => ipcRenderer.invoke('creation:save', id, reuse),
  creationRun: (id: string, access: unknown) => ipcRenderer.invoke('creation:run', id, access),
  ready: (success: boolean) => ipcRenderer.send('surface:ready', success),
  surfaceStatus: () => ipcRenderer.invoke('surface:status'),
  getConversation: (id: string) => ipcRenderer.invoke('conversations:get', id),
  renameConversation: (id: string, title: string) =>
    ipcRenderer.invoke('conversations:rename', id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  getRun: (id: string) => ipcRenderer.invoke('runs:get', id),
  showDashboard: (runId?: string) => ipcRenderer.invoke('surface:dashboard', runId),
  hideGlassbar: () => ipcRenderer.invoke('surface:hide'),
  onSelectRun: (handler: (id: string) => void) => {
    const listener = (_event: unknown, id: string) => handler(id);
    ipcRenderer.on('surface:select-run', listener);
    return () => ipcRenderer.removeListener('surface:select-run', listener);
  },
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
  listPlanMessages: (planId: string) => ipcRenderer.invoke('plans:messages', planId),
  postPlanMessage: (input: unknown) => ipcRenderer.invoke('plans:message', input),
  listMemories: () => ipcRenderer.invoke('memory:list'),
  addMemory: (input: unknown) => ipcRenderer.invoke('memory:add', input),
  removeMemory: (id: string) => ipcRenderer.invoke('memory:remove', id),
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
