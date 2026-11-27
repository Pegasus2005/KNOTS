import { inheritedRunPolicies } from '../policies.js';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { callReceipts } from '../routing/router.js';
import { v4 as uuid } from 'uuid';
import type { KnotSpec, ModelMessage, Strand } from '@knots/types';
import type { KnotsCore } from '../index.js';
import { resolveDefaultStrand } from '../connections.js';
import { ModelRouter, type ProviderResolver } from '../routing/router.js';
import { conversationContext } from './conversations.js';
import { listPlanMessages } from './plans.js';
import type { KnotWorker } from './worker.js';

export interface ProvisionedAgent {
  id: string;
  name: string;
  instructions: string;
  task: string;
  expectedOutput: string;
}

export interface AutoPlanSpec {
  title: string;
  strategy: string;
  agents: ProvisionedAgent[];
}

export interface AutoTaskInput {
  prompt: string;
  strand?: Strand;
  pinnedStrandId?: string;
  conversationId?: string;
  folder?: string;
  outputFolder?: string;
  maxCostUsd?: number;
  maxCalls?: number;
  requestId?: string;
  resumeRunId?: string;
}

interface AutoCheckpoint {
  id: string;
  input: AutoTaskInput;
  conversationId: string;
  title: string;
  strandHash: string;
  status: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priorContext: { messages: ModelMessage[]; summary?: string; constraints: KnotSpec[] };
  roots: { folder?: string; outputFolder?: string };
  memoryNote?: string;
  autoPlan?: AutoPlanSpec;
  planId?: string;
  derivedPolicies?: KnotSpec[];
  soloResult?: { text: string; model: string };
  synthResult?: { text: string; model: string };
}
const runtimes = new WeakMap<
  KnotWorker,
  {
    active: Map<string, { checkpoint: AutoCheckpoint; promise: Promise<void> }>;
    grants: Set<string>;
  }
>();
const hashStrand = (strand: Strand) =>
  createHash('sha256').update(JSON.stringify(strand)).digest('hex');
function readCheckpoint(core: KnotsCore, id: string): AutoCheckpoint | undefined {
  const row = core.database
    .getDb()
    .prepare("SELECT data FROM lab_records WHERE kind='auto' AND id=?")
    .get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
function writeCheckpoint(core: KnotsCore, checkpoint: AutoCheckpoint) {
  core.database
    .getDb()
    .prepare(
      "INSERT INTO lab_records(id,kind,data) VALUES(?,'auto',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE kind='auto'",
    )
    .run(checkpoint.id, JSON.stringify(checkpoint));
}
function autoChildren(core: KnotsCore, checkpoint: AutoCheckpoint): string[] {
  return checkpoint.planId
    ? (
        core.database
          .getDb()
          .prepare(
            'SELECT run_id FROM plan_tasks WHERE plan_id=? AND run_id IS NOT NULL ORDER BY rowid',
          )
          .all(checkpoint.planId) as { run_id: string }[]
      ).map((r) => r.run_id)
    : [];
}
function runtime(core: KnotsCore, worker: KnotWorker) {
  let rt = runtimes.get(worker);
  if (rt) return rt;
  rt = { active: new Map(), grants: new Set() };
  runtimes.set(worker, rt);
  worker.registerLifecycle({
    stop: () => {
      for (const row of core.database
        .getDb()
        .prepare("SELECT id FROM lab_records WHERE kind='auto'")
        .all() as { id: string }[]) {
        const cp = readCheckpoint(core, row.id)!;
        if (['active', 'paused'].includes(cp.status)) cancelAutoChat(core, worker, row.id);
      }
    },
    shutdown: async () => {
      for (const [id, task] of rt!.active)
        if (['active', 'paused'].includes(task.checkpoint.status)) pauseAutoChat(core, worker, id);
      await Promise.all([...rt!.active.values()].map((v) => v.promise));
      rt!.grants.clear();
    },
  });
  return rt;
}
export function recoverAutoChats(core: KnotsCore, worker: KnotWorker) {
  const rt = runtime(core, worker);
  rt.grants.clear();
  for (const row of core.database
    .getDb()
    .prepare("SELECT data FROM lab_records WHERE kind='auto'")
    .all() as { data: string }[]) {
    const cp = JSON.parse(row.data) as AutoCheckpoint;
    core.database
      .getDb()
      .prepare(
        "UPDATE model_calls SET status='interrupted',error='Interrupted automatic model call; reservation retained.' WHERE run_id=? AND status='running'",
      )
      .run(cp.id);
    const run = core.runs.getById(cp.id);
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
      cp.status = run.status as AutoCheckpoint['status'];
      writeCheckpoint(core, cp);
      continue;
    }
    if (cp.status === 'active' || cp.status === 'paused') {
      cp.status = 'paused';
      writeCheckpoint(core, cp);
      if (cp.planId)
        core.database
          .getDb()
          .prepare("UPDATE task_plans SET status='auto_paused' WHERE id=?")
          .run(cp.planId);
      core.runManager.suspendRun(
        cp.id,
        'paused',
        'Recovered automatic task. Review actions, renew folders and resume explicitly.',
      );
    }
  }
}
export function autoChatStatus(core: KnotsCore, worker: KnotWorker, id: string) {
  const cp = readCheckpoint(core, id);
  if (!cp) return null;
  const children = autoChildren(core, cp),
    waiting = children
      .map((child) => ({ run: core.runs.getById(child), job: worker.status(child) }))
      .find((v) => v.run?.status === 'waiting_input');
  return {
    state: core.runs.getById(id)?.status,
    reason: core.runs.getById(id)?.error,
    folder: cp.roots.folder,
    outputFolder: cp.roots.outputFolder,
    needsAccess:
      !runtime(core, worker).grants.has(id) && Boolean(cp.roots.folder || cp.roots.outputFolder),
    question: waiting?.job?.question,
    settling: cp.status === 'paused' && runtime(core, worker).active.has(id),
    sources: [],
  };
}
export function cancelAutoChat(core: KnotsCore, worker: KnotWorker, id: string) {
  const cp = runtime(core, worker).active.get(id)?.checkpoint ?? readCheckpoint(core, id);
  if (!cp || ['completed', 'failed', 'cancelled'].includes(cp.status)) return false;
  cp.status = 'cancelled';
  writeCheckpoint(core, cp);
  if (!core.runManager.cancelRun(id))
    core.runs.update(id, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      error: 'Cancelled by user',
    });
  for (const child of autoChildren(core, cp)) worker.cancel(child);
  if (cp.planId)
    core.database
      .getDb()
      .prepare("UPDATE task_plans SET status='cancelled' WHERE id=?")
      .run(cp.planId);
  return true;
}
export function pauseAutoChat(core: KnotsCore, worker: KnotWorker, id: string) {
  const rt = runtime(core, worker),
    cp = rt.active.get(id)?.checkpoint ?? readCheckpoint(core, id);
  if (!cp || ['completed', 'failed', 'cancelled'].includes(cp.status))
    throw new Error('Choose an unfinished automatic task.');
  cp.status = 'paused';
  writeCheckpoint(core, cp);
  if (cp.planId)
    core.database
      .getDb()
      .prepare("UPDATE task_plans SET status='auto_paused' WHERE id=?")
      .run(cp.planId);
  core.runManager.suspendRun(id, 'paused', 'Automatic task paused at its saved stage.');
  for (const child of autoChildren(core, cp)) {
    const run = core.runs.getById(child);
    if (
      run &&
      !['completed', 'failed', 'cancelled', 'paused', 'waiting_input'].includes(run.status)
    )
      worker.pause(child);
  }
}
export async function resumeAutoChat(
  core: KnotsCore,
  worker: KnotWorker,
  resolve: ProviderResolver,
  id: string,
  grants?: { folder?: string; outputFolder?: string },
  reply?: string,
) {
  const rt = runtime(core, worker);
  await (rt.active.get(id)?.checkpoint.status === 'paused'
    ? rt.active.get(id)?.promise
    : undefined);
  const cp = readCheckpoint(core, id);
  if (!cp || !['active', 'paused'].includes(cp.status))
    throw new Error('Choose an unfinished automatic task.');
  if (!worker.control().enabled) throw new Error('Enable dispatch first.');
  if (!rt.grants.has(id) && Boolean(cp.roots.folder || cp.roots.outputFolder)) {
    for (const key of ['folder', 'outputFolder'] as const)
      if (cp.roots[key] && (!grants?.[key] || (await realpath(grants[key]!)) !== cp.roots[key]))
        throw new Error('Renew the original automatic-task folders.');
    rt.grants.add(id);
  }
  if (cp.planId)
    core.database
      .getDb()
      .prepare("UPDATE task_plans SET status='auto_active' WHERE id=?")
      .run(cp.planId);
  const strand = core.strands.getById(cp.input.strand!.id);
  if (!strand || hashStrand(strand) !== cp.strandHash)
    throw new Error('The connection changed; inspect this task before starting a fresh one.');
  const access = {
    folder: grants?.folder ?? cp.input.folder,
    outputFolder: grants?.outputFolder ?? cp.input.outputFolder,
  };
  for (const child of autoChildren(core, cp)) {
    const state = worker.status(child);
    if (state?.state === 'waiting_input' && reply) {
      await worker.resume(child, access, reply);
      reply = undefined;
    } else if (state?.state === 'paused') {
      await worker.resume(child, access);
    }
  }
  if (rt.active.has(id)) return;

  await startAutoChat(core, worker, resolve, { ...cp.input, ...access, strand, resumeRunId: id });
}
export function autoChatAccounting(core: KnotsCore, id: string) {
  const db = core.database.getDb();
  const group = db.prepare('SELECT group_id FROM run_groups WHERE run_id=?').get(id) as
    { group_id: string } | undefined;
  if (!group) return undefined;
  const members = db
    .prepare('SELECT run_id FROM run_groups WHERE group_id=?')
    .all(group.group_id) as { run_id: string }[];
  const calls = members.flatMap((r) => callReceipts(core, r.run_id));
  return {
    calls,
    modelCalls: calls.length,
    knownCostUsd: calls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0),
    costKnown: calls.every((c) => c.cost_usd !== null),
    tokensIn: calls.reduce((sum, c) => sum + (c.tokens_in ?? 0), 0),
    tokensOut: calls.reduce((sum, c) => sum + (c.tokens_out ?? 0), 0),
    limits: db
      .prepare('SELECT max_cost_usd,max_calls FROM call_groups WHERE id=?')
      .get(group.group_id),
  };
}

const FILLER_PREFIX =
  /^(?:please|can you|could you|would you|help me|hey|hi|hello|i want you to|i need you to|i want to)\s+/i;

/** Derive a clean, concise chat title directly from a user prompt. */
export function formatChatTitle(prompt: string): string {
  let text = prompt.replace(/\s+/g, ' ').trim();
  while (FILLER_PREFIX.test(text)) {
    text = text.replace(FILLER_PREFIX, '').trim();
  }
  const firstClause = text.split(/[.!?\n]/)[0]?.trim() || text;
  if (!firstClause) return 'New chat';
  const capitalized = firstClause[0].toUpperCase() + firstClause.slice(1);
  if (capitalized.length <= 56) return capitalized;
  const cut = capitalized.slice(0, 56);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

function parseAutoPlan(raw: string, prompt: string): AutoPlanSpec {
  const fallbackTitle = formatChatTitle(prompt);
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];

  try {
    const parsed = JSON.parse(cleaned) as Partial<AutoPlanSpec>;
    const title =
      typeof parsed.title === 'string' && parsed.title.trim().length >= 3
        ? parsed.title.replace(/\s+/g, ' ').trim().slice(0, 80)
        : fallbackTitle;
    const strategy =
      typeof parsed.strategy === 'string' && parsed.strategy.trim()
        ? parsed.strategy.trim().slice(0, 400)
        : 'Autonomous specialized execution.';
    const rawAgents = Array.isArray(parsed.agents) ? parsed.agents : [];
    const agents: ProvisionedAgent[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < Math.min(12, rawAgents.length); i++) {
      const item = rawAgents[i];
      if (!item || typeof item !== 'object') continue;
      const baseId =
        typeof item.id === 'string' && /^[a-z][a-z0-9_-]{0,30}$/.test(item.id)
          ? item.id
          : `agent-${i + 1}`;
      let id = baseId;
      let suffix = 0;
      while (seen.has(id)) id = `agent-${i + 1}-${++suffix}`;
      seen.add(id);
      const name =
        typeof item.name === 'string' && item.name.trim()
          ? item.name.trim().slice(0, 64)
          : `Specialist ${i + 1}`;
      const instructions =
        typeof item.instructions === 'string' && item.instructions.trim()
          ? item.instructions.trim().slice(0, 4000)
          : `You are ${name}. Complete your assigned part accurately and concisely.`;
      const task =
        typeof item.task === 'string' && item.task.trim()
          ? item.task.trim().slice(0, 8000)
          : prompt;
      const expectedOutput =
        typeof item.expectedOutput === 'string' && item.expectedOutput.trim()
          ? item.expectedOutput.trim().slice(0, 1000)
          : 'Clear verified response.';
      agents.push({ id, name, instructions, task, expectedOutput });
    }
    if (agents.length > 0) {
      return { title, strategy, agents };
    }
  } catch {
    // Fall back gracefully when a model replies with non-JSON text.
  }
  return {
    title: fallbackTitle,
    strategy: 'Direct single-agent response.',
    agents: [
      {
        id: 'agent-1',
        name: 'Assistant',
        instructions: 'Help the user accomplish their request thoroughly, clearly, and accurately.',
        task: prompt,
        expectedOutput: 'Clear, complete answer.',
      },
    ],
  };
}

/**
 * Automatically provision specialized parallel agents for any chat task,
 * run them concurrently on the durable KnotWorker queue with shared peer
 * messaging and cross-chat memory, and synthesize the unified answer into
 * the conversation under Recent chats.
 */
export async function startAutoChat(
  core: KnotsCore,
  worker: KnotWorker,
  resolve: ProviderResolver,
  input: AutoTaskInput,
): Promise<{
  runId: string;
  conversationId: string;
  title: string;
  strandName: string;
  model: string;
}> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Enter a message or task first.');
  if (!worker.control().enabled) {
    throw new Error('Dispatch is stopped. Enable it before starting work.');
  }

  const rt = runtime(core, worker);
  let checkpoint = input.resumeRunId ? readCheckpoint(core, input.resumeRunId) : undefined;
  if (input.resumeRunId && !checkpoint) throw new Error('Automatic checkpoint not found.');
  const strand = checkpoint?.input.strand ?? input.strand ?? resolveDefaultStrand(core);
  const db = core.database.getDb();
  const isNewConversation = !input.conversationId && !checkpoint;
  const conversationId = checkpoint?.conversationId ?? input.conversationId ?? uuid();
  const initialTitle = checkpoint?.title ?? formatChatTitle(prompt);
  if (
    input.maxCostUsd !== undefined &&
    (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd < 0 || input.maxCostUsd > 100)
  )
    throw new Error('Choose a task budget between $0 and $100.');
  if (
    !Number.isInteger(input.maxCalls ?? 60) ||
    (input.maxCalls ?? 60) < 1 ||
    (input.maxCalls ?? 60) > 160
  )
    throw new Error('Choose 1–160 model calls.');
  const roots = checkpoint?.roots ?? {
    folder: input.folder ? await realpath(input.folder) : undefined,
    outputFolder: input.outputFolder ? await realpath(input.outputFolder) : undefined,
  };
  let priorContext: AutoCheckpoint['priorContext'] = checkpoint?.priorContext ?? {
    messages: [],
    constraints: [],
  };
  let run!: ReturnType<KnotsCore['runManager']['createRun']>;
  let duplicate: AutoCheckpoint | undefined;
  db.transaction(() => {
    const binding = input.requestId
      ? (db
          .prepare('SELECT run_id FROM worker_submissions WHERE key=?')
          .get(`auto:${input.requestId}`) as { run_id: string } | undefined)
      : undefined;
    if (!checkpoint && binding) {
      duplicate = readCheckpoint(core, binding.run_id);
      return;
    }
    if (checkpoint) {
      run = core.runManager.restoreRun(checkpoint.id);
      return;
    }
    const existing = db.prepare('SELECT id FROM conversations WHERE id=?').get(conversationId);
    if (existing)
      priorContext = conversationContext(core, conversationId, 'auto', { allowKnotSwitch: true });
    else
      db.prepare('INSERT INTO conversations(id,title,knot_name) VALUES(?,?,?)').run(
        conversationId,
        initialTitle,
        'auto',
      );
    run = core.runManager.createRun({
      knotName: 'auto',
      input: prompt,
      strandId: strand.id,
      strandName: strand.name,
    });
    db.prepare('INSERT INTO run_snapshots(run_id,spec,purpose) VALUES(?,?,?)').run(
      run.runId,
      JSON.stringify({
        version: '0.1.0',
        name: 'auto',
        display_name: 'Automatic task',
        description: 'Durable specialist coordination',
        instructions: 'Coordinate task specialists',
        model_preferences: {
          privacy: priorContext.constraints.some(
            (p) => p.model_preferences?.privacy === 'local_only',
          )
            ? 'local_only'
            : 'any',
        },
      }),
      'task',
    );
    db.prepare(
      'INSERT INTO conversation_runs(conversation_id,run_id,turn) SELECT ?,?,COALESCE(MAX(turn),0)+1 FROM conversation_runs WHERE conversation_id=?',
    ).run(conversationId, run.runId, conversationId);
    db.prepare(
      "UPDATE conversations SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(conversationId);
    db.prepare('INSERT INTO call_groups(id,max_cost_usd,max_calls) VALUES(?,?,?)').run(
      run.runId,
      input.maxCostUsd ?? null,
      input.maxCalls ?? 60,
    );
    db.prepare('INSERT INTO run_groups(run_id,group_id) VALUES(?,?)').run(run.runId, run.runId);
    if (input.requestId)
      db.prepare('INSERT INTO worker_submissions(key,run_id) VALUES(?,?)').run(
        `auto:${input.requestId}`,
        run.runId,
      );
    checkpoint = {
      id: run.runId,
      input: { ...input, strand, resumeRunId: undefined },
      conversationId,
      title: initialTitle,
      strandHash: hashStrand(strand),
      status: 'active',
      priorContext,
      roots,
    };
    writeCheckpoint(core, checkpoint);
  })();
  if (duplicate && duplicate.input.prompt !== prompt)
    throw new Error('This task request ID already belongs to another prompt.');
  if (duplicate)
    return {
      runId: duplicate.id,
      conversationId: duplicate.conversationId,
      title: duplicate.title,
      strandName: strand.name,
      model: strand.model,
    };
  const cp = checkpoint!;
  cp.input = { ...cp.input, folder: input.folder, outputFolder: input.outputFolder };
  cp.status = 'active';
  writeCheckpoint(core, cp);
  rt.grants.add(cp.id);
  const runId = run!.runId;
  const record = (message: string) =>
    db.prepare('INSERT INTO run_activity(run_id,message) VALUES(?,?)').run(runId, message);
  const childRunIds: string[] = [];
  let planId: string | undefined = cp.planId;
  childRunIds.push(...autoChildren(core, cp));
  const onParentCancelled = ({ runId: cancelledId }: { runId: string }) => {
    if (cancelledId !== runId) return;
    cp.status = 'cancelled';
    writeCheckpoint(core, cp);
    for (const cid of childRunIds) worker.cancel(cid);
    if (planId) {
      db.prepare(
        "UPDATE task_plans SET status = 'cancelled' WHERE id = ? AND status = 'auto_active'",
      ).run(planId);
    }
  };
  core.runManager.on('cancelled', onParentCancelled);

  // Execute asynchronously so chat creation returns immediately and streams live progress.
  const execution = (async () => {
    try {
      core.runManager.startRun(runId);
      const router = new ModelRouter(core, resolve);
      const allowLocalMemories = priorContext.constraints.some(
        (spec) => spec.model_preferences?.privacy === 'local_only',
      );
      const memories = core.memory.retrieve(prompt, allowLocalMemories);
      const memoryNote =
        cp.memoryNote ??
        (memories.length
          ? '\n\nWorkspace memory (cross-chat context, cite [M1] etc when used):\n' +
            JSON.stringify(
              memories.map(({ citation, content, tags, privacy }) => ({
                citation,
                content,
                tags,
                privacy,
              })),
            )
          : '');
      cp.memoryNote = memoryNote;
      writeCheckpoint(core, cp);

      const plannerSpec: KnotSpec = {
        version: '0.1.0',
        name: 'auto-provisioner',
        display_name: 'Team Provisioner',
        description: 'Provision optimal specialized agents for a user request.',
        instructions:
          'Analyze the user request and assemble 1 focused agent (for simple Q&A) or multiple parallel specialized agents (scale dynamically from 2 up to 12 agents as needed for complex coding, research, analysis, or review tasks — no 4-agent cap). ' +
          'Return ONLY JSON: {"title":"Concise 3-6 word chat title","strategy":"Brief rationale","agents":[{"id":"agent-1","name":"Specialist Name","instructions":"Clear system prompt","task":"Concrete subtask","expectedOutput":"Deliverable"}]}.',
        tools: [],
        model_preferences: {
          privacy: allowLocalMemories ? 'local_only' : 'any',
          max_output_tokens: 4096,
        },
      };

      let autoPlan: AutoPlanSpec = cp.autoPlan!;
      if (!autoPlan)
        try {
          const planResult = await router.call({
            runId,
            knot: plannerSpec,
            constraints: priorContext.constraints,
            stage: 'inspect',
            pin: input.pinnedStrandId,
            system: plannerSpec.instructions,
            messages: [
              ...priorContext.messages.slice(-4),
              { role: 'user', content: prompt + memoryNote },
            ],
            signal: run.signal,
            onDelta: () => {},
            onReset: () => {},
            record,
          });
          autoPlan = parseAutoPlan(planResult.text, prompt);
        } catch (err) {
          if (
            run.signal.aborted ||
            /budget|pricing|limit/i.test(err instanceof Error ? err.message : String(err))
          )
            throw err;
          autoPlan = parseAutoPlan('', prompt);
        }

      run.signal.throwIfAborted();
      cp.autoPlan = autoPlan;
      writeCheckpoint(core, cp);
      if (isNewConversation && autoPlan.title) {
        db.prepare(
          "UPDATE conversations SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        ).run(autoPlan.title, conversationId);
      }

      const tools: KnotSpec['tools'] = [];
      if (input.folder) tools.push('list_files', 'read_file');
      if (input.outputFolder) tools.push('create_file');

      // Single-agent fast path: execute directly with live streaming on parent run.
      if (autoPlan.agents.length === 1 && !input.folder && !input.outputFolder) {
        const solo = autoPlan.agents[0];
        record(`Provisioned · 1 agent (${solo.name})`);
        const soloSpec: KnotSpec = {
          version: '0.1.0',
          name: 'auto',
          display_name: solo.name,
          description: autoPlan.strategy,
          instructions: solo.instructions,
          tools: [],
          model_preferences: {
            privacy: allowLocalMemories ? 'local_only' : 'any',
          },
        };
        if (!cp.soloResult) {
          run.output = '';
          core.runs.update(runId, { output: '' });
        }
        const result =
          cp.soloResult ??
          (await router.call({
            runId,
            knot: soloSpec,
            constraints: priorContext.constraints,
            stage: 'deliver',
            pin: input.pinnedStrandId,
            system: solo.instructions,
            messages: [...priorContext.messages, { role: 'user', content: prompt + memoryNote }],
            signal: run.signal,
            onDelta: (delta) => core.runManager.progressRun(runId, delta),
            onReset: () => {
              run.output = '';
              core.runs.update(runId, { output: '' });
            },
            record,
          }));
        cp.soloResult = result;
        writeCheckpoint(core, cp);
        core.memory.captureFromChatTurn({
          input: prompt,
          output: result.text,
          tags: [
            solo.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .slice(0, 32) || 'auto',
          ],
          privacy: allowLocalMemories ? 'local_only' : 'cloud_allowed',
          sourceRunId: runId,
          sourceConversationId: conversationId,
        });
        core.runManager.completeRun(runId, {
          output: result.text,
          modelUsed: result.model,
          tokensIn: run.tokensIn,
          tokensOut: run.tokensOut,
          cost: run.cost,
        });
        return;
      }

      // Multi-agent parallel swarm path: create durable active plan + dispatch concurrent agents.
      planId = cp.planId ?? uuid();
      const agentSpecs = autoPlan.agents.map((agent): KnotSpec => ({
        version: '0.1.0',
        name: `auto-${agent.id}`,
        display_name: agent.name,
        description: agent.expectedOutput,
        instructions: agent.instructions,
        tools,
        model_preferences: {
          privacy: allowLocalMemories ? 'local_only' : 'any',
        },
      }));

      if (!cp.planId)
        db.transaction(() => {
          db.prepare(
            "INSERT INTO task_plans (id, goal, definition, knots, privacy, status, draft_run_id) VALUES (?, ?, ?, ?, ?, 'auto_active', ?)",
          ).run(
            planId!,
            prompt,
            JSON.stringify({
              summary: autoPlan.strategy,
              tasks: autoPlan.agents.map((a) => ({
                id: a.id,
                title: a.name,
                knotName: `auto-${a.id}`,
                prompt: a.task,
                expectedOutput: a.expectedOutput,
                dependsOn: [],
              })),
            }),
            JSON.stringify(agentSpecs),
            allowLocalMemories ? 'local_only' : 'cloud_allowed',
            runId,
          );
          cp.planId = planId;
          writeCheckpoint(core, cp);
          for (const agent of autoPlan.agents) {
            db.prepare('INSERT INTO plan_tasks (plan_id, task_id, scope) VALUES (?, ?, ?)').run(
              planId!,
              agent.id,
              JSON.stringify({
                ...(input.folder ? { folder: input.folder } : {}),
                ...(input.outputFolder ? { outputFolder: input.outputFolder } : {}),
              }),
            );
          }
        })();

      record(
        `Provisioned ${autoPlan.agents.length} parallel agents · ${autoPlan.agents.map((a) => a.name).join(', ')}`,
      );

      // Enqueue all provisioned agents concurrently on the durable worker pool.
      for (let i = 0; i < autoPlan.agents.length; i++) {
        run.signal.throwIfAborted();
        const agent = autoPlan.agents[i];
        const existing = db
          .prepare('SELECT run_id FROM plan_tasks WHERE plan_id=? AND task_id=?')
          .get(planId, agent.id) as { run_id: string | null };
        if (existing?.run_id) {
          childRunIds[i] = existing.run_id;
          continue;
        }
        const spec = agentSpecs[i];
        const peers = autoPlan.agents
          .filter((other) => other.id !== agent.id)
          .map((other) => `${other.id} (${other.name})`)
          .join(', ');
        const contextNote = priorContext.summary
          ? `\nPrior conversation context:\n${priorContext.summary}`
          : '';
        const peerNote = peers
          ? `\nRunning in parallel with peers: ${peers}. Use {"tool":"send_message","to":"agent_id_or_all","message":"..."} or {"tool":"read_messages"} to coordinate.`
          : '';
        const childId = await worker.start(
          {
            submissionKey: `auto:${runId}:${agent.id}`,
            groupId: runId,
            knot: spec,
            purpose: 'agent',
            planTask: { planId: planId!, taskId: agent.id },
            constraints: priorContext.constraints,
            strand,
            pinnedStrandId: input.pinnedStrandId,
            prompt:
              `${agent.task}${contextNote}${peerNote}${memoryNote}` +
              (agent.expectedOutput ? `\n\nExpected deliverable: ${agent.expectedOutput}` : ''),
            folder: input.folder,
            outputFolder: input.outputFolder,
            selectionReason: `Auto-provisioned · ${agent.name}`,
          },
          resolve,
        );
        childRunIds[i] = childId;
        run.signal.throwIfAborted();
      }

      // Wait for all parallel agents to complete (or cancel/fail).
      const terminal = new Set(['completed', 'failed', 'cancelled']);
      while (true) {
        run.signal.throwIfAborted();
        const childRuns = childRunIds.map((cid) => core.runs.getById(cid)!);
        if (childRuns.some((r) => r && ['failed', 'cancelled'].includes(r.status)))
          throw new Error('A specialist failed or was cancelled; remaining work is stopped.');
        const state = childRuns.some((r) => r?.status === 'waiting_input')
          ? 'waiting_input'
          : childRuns.some((r) => r?.status === 'waiting_approval')
            ? 'waiting_approval'
            : childRuns.some((r) => r?.status === 'paused')
              ? 'paused'
              : 'running';
        core.runs.update(runId, { status: state });
        if (childRuns.every((r) => r && terminal.has(r.status))) break;
        await new Promise((r) => setTimeout(r, 40));
      }

      run.signal.throwIfAborted();
      const completedChildren = autoPlan.agents.map((agent, idx) => ({
        agent,
        run: core.runs.getById(childRunIds[idx])!,
        proposals: worker.reviewedFiles
          .list(childRunIds[idx])
          .filter((p) => p.state === 'verified')
          .map((p) => p.destination),
      }));
      const peerMessages = listPlanMessages(core, planId);
      cp.derivedPolicies = childRunIds.flatMap((id) => inheritedRunPolicies(core, id));
      if (peerMessages.some((m) => m.privacy === 'local_only'))
        cp.derivedPolicies.push({ ...agentSpecs[0], model_preferences: { privacy: 'local_only' } });
      writeCheckpoint(core, cp);
      const finalLocalOnly = [...priorContext.constraints, ...cp.derivedPolicies].some(
        (p) => p.model_preferences?.privacy === 'local_only',
      );
      if (completedChildren.some(({ run: child }) => child.status !== 'completed')) {
        throw new Error(
          'One or more specialists failed or were cancelled. Inspect their results before retrying.',
        );
      }
      db.prepare("UPDATE task_plans SET status = 'completed' WHERE id = ?").run(planId);

      // Single tool-using agent can return its answer directly without redundant synthesis.
      if (completedChildren.length === 1 && completedChildren[0].run.status === 'completed') {
        const finalOut = completedChildren[0].run.output || '';
        core.runManager.progressRun(runId, finalOut);
        core.memory.captureFromChatTurn({
          input: prompt,
          output: finalOut,
          tags: [completedChildren[0].agent.name],
          privacy: finalLocalOnly ? 'local_only' : 'cloud_allowed',
          sourceRunId: runId,
          sourceConversationId: conversationId,
        });
        core.runManager.completeRun(runId, {
          output: finalOut,
          modelUsed: completedChildren[0].run.model_used || strand.model,
          tokensIn: run.tokensIn,
          tokensOut: run.tokensOut,
          cost: run.cost,
        });
        return;
      }

      record('Synthesizing · combining parallel agent findings into final response');
      const contributions = completedChildren
        .map(
          ({ agent, run: r, proposals }) =>
            `### ${agent.name} (${agent.id}) · ${r.status}\n` +
            `Task: ${agent.task}\n` +
            (proposals.length ? `Verified files: ${proposals.join(', ')}\n` : '') +
            `Output:\n${r.output || r.error || '(no output)'}`,
        )
        .join('\n\n---\n\n');

      const synthesisSpec: KnotSpec = {
        version: '0.1.0',
        name: 'auto-synthesizer',
        display_name: 'Response Synthesizer',
        description: 'Consolidate outputs from parallel agents into one clear chat response.',
        instructions:
          'Synthesize the parallel agents’ findings and peer messages into one cohesive, accurate response that directly answers the user.',
        tools: [],
        model_preferences: {
          privacy: allowLocalMemories ? 'local_only' : 'any',
          max_output_tokens: 4096,
        },
      };

      if (!cp.synthResult) {
        run.output = '';
        core.runs.update(runId, { output: '' });
      }
      const synth =
        cp.synthResult ??
        (await router.call({
          runId,
          knot: synthesisSpec,
          constraints: [...priorContext.constraints, ...agentSpecs, ...(cp.derivedPolicies ?? [])],
          stage: 'deliver',
          pin: input.pinnedStrandId,
          system: synthesisSpec.instructions,
          messages: [
            ...priorContext.messages.slice(-4),
            {
              role: 'user',
              content:
                `User request:\n${prompt}\n\nParallel agent contributions:\n${contributions}` +
                (peerMessages.length
                  ? `\n\nPeer messages exchanged:\n${JSON.stringify(peerMessages)}`
                  : ''),
            },
          ],
          signal: run.signal,
          onDelta: (delta) => core.runManager.progressRun(runId, delta),
          onReset: () => {
            run.output = '';
            core.runs.update(runId, { output: '' });
          },
          record,
        }));

      cp.synthResult = synth;
      writeCheckpoint(core, cp);
      core.memory.captureFromChatTurn({
        input: prompt,
        output: synth.text,
        tags: ['auto-team'],
        privacy: finalLocalOnly ? 'local_only' : 'cloud_allowed',
        sourceRunId: runId,
        sourceConversationId: conversationId,
      });
      core.runManager.completeRun(runId, {
        output: synth.text,
        modelUsed: synth.model,
        tokensIn: run.tokensIn,
        tokensOut: run.tokensOut,
        cost: run.cost,
      });
    } catch (error) {
      if (cp.status === 'paused') return;
      if (planId) {
        db.prepare(
          "UPDATE task_plans SET status = 'failed' WHERE id = ? AND status = 'auto_active'",
        ).run(planId);
      }
      for (const childId of childRunIds) worker.cancel(childId);
      if (!run.isCancelled) {
        cp.status = 'failed';
        writeCheckpoint(core, cp);
        core.runManager.failRun(runId, error instanceof Error ? error.message : String(error));
      }
    } finally {
      const terminal = core.runs.getById(runId)?.status;
      if (terminal && ['completed', 'failed', 'cancelled'].includes(terminal)) {
        cp.status = terminal as AutoCheckpoint['status'];
        writeCheckpoint(core, cp);
      }
      const totals = autoChatAccounting(core, runId);
      if (totals)
        core.runs.update(runId, {
          cost: totals.costKnown ? totals.knownCostUsd : null,
          tokens_in: totals.tokensIn,
          tokens_out: totals.tokensOut,
        });
      core.runManager.removeListener('cancelled', onParentCancelled);
      rt.active.delete(runId);
    }
  })();
  rt.active.set(runId, { checkpoint: cp, promise: execution });

  return {
    runId,
    conversationId,
    title: initialTitle,
    strandName: strand.name,
    model: strand.model,
  };
}
