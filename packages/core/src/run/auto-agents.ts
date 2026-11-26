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
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
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
      const id = seen.has(baseId) ? `agent-${i + 1}` : baseId;
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
        instructions:
          'Help the user accomplish their request thoroughly, clearly, and accurately.',
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
): Promise<{ runId: string; conversationId: string; title: string; strandName: string; model: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Enter a message or task first.');
  if (!worker.control().enabled) {
    throw new Error('Dispatch is stopped. Enable it before starting work.');
  }

  const strand = input.strand ?? resolveDefaultStrand(core);
  const db = core.database.getDb();
  const isNewConversation = !input.conversationId;
  const conversationId = input.conversationId ?? uuid();
  const initialTitle = formatChatTitle(prompt);

  let priorContext: { messages: ModelMessage[]; summary?: string; constraints: KnotSpec[] } = {
    messages: [],
    constraints: [],
  };

  const run = core.runManager.createRun({
    knotName: 'auto',
    input: prompt,
    strandId: strand.id,
    strandName: strand.name,
  });
  const runId = run.runId;
  const record = (msg: string) => {
    db.prepare('INSERT INTO run_activity (run_id, message) VALUES (?, ?)').run(runId, msg);
  };

  db.transaction(() => {
    const existing = db
      .prepare('SELECT id, title FROM conversations WHERE id = ?')
      .get(conversationId) as { id: string; title: string } | undefined;
    if (existing) {
      priorContext = conversationContext(core, conversationId, 'auto', {
        allowKnotSwitch: true,
      });
    } else {
      db.prepare(
        "INSERT INTO conversations (id, title, knot_name, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ).run(conversationId, initialTitle, 'auto');
    }

    db.prepare('INSERT INTO run_snapshots (run_id, spec, purpose) VALUES (?, ?, ?)').run(
      runId,
      JSON.stringify({
        version: '0.1.0',
        name: 'auto',
        display_name: 'Autonomous team',
        description: 'Automatically provisions parallel specialized agents per task.',
        instructions: 'Automatically coordinate specialized agents to solve the user task.',
      }),
      'task',
    );
    db.prepare(
      'INSERT INTO conversation_runs (conversation_id, run_id, turn) SELECT ?, ?, COALESCE(MAX(turn), 0) + 1 FROM conversation_runs WHERE conversation_id = ?',
    ).run(conversationId, runId, conversationId);
    db.prepare(
      "UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    ).run(conversationId);
    core.runs.update(runId, { model_used: strand.model });
    record('Provisioning · analyzing task to assign parallel agents');
  })();

  const childRunIds: string[] = [];
  let planId: string | undefined;
  const onParentCancelled = ({ runId: cancelledId }: { runId: string }) => {
    if (cancelledId !== runId) return;
    for (const cid of childRunIds) worker.cancel(cid);
    if (planId) {
      db.prepare("UPDATE task_plans SET status = 'cancelled' WHERE id = ? AND status = 'auto_active'").run(
        planId,
      );
    }
  };
  core.runManager.on('cancelled', onParentCancelled);

  // Execute asynchronously so chat creation returns immediately and streams live progress.
  void (async () => {
    try {
      core.runManager.startRun(runId);
      const router = new ModelRouter(core, resolve);
      const allowLocalMemories = priorContext.constraints.some(
        (spec) => spec.model_preferences?.privacy === 'local_only',
      );
      const memories = core.memory.retrieve(prompt, allowLocalMemories);
      const memoryNote = memories.length
        ? '\n\nWorkspace memory (cross-chat context, cite [M1] etc when used):\n' +
          JSON.stringify(
            memories.map(({ citation, content, tags, privacy }) => ({
              citation,
              content,
              tags,
              privacy,
            })),
          )
        : '';

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
          max_output_tokens: 1200,
        },
      };

      let autoPlan: AutoPlanSpec;
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
        if (run.signal.aborted) throw err;
        autoPlan = parseAutoPlan('', prompt);
      }

      run.signal.throwIfAborted();
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
        const result = await router.call({
          runId,
          knot: soloSpec,
          constraints: priorContext.constraints,
          stage: 'deliver',
          pin: input.pinnedStrandId,
          system: solo.instructions,
          messages: [
            ...priorContext.messages,
            { role: 'user', content: prompt + memoryNote },
          ],
          signal: run.signal,
          onDelta: (delta) => core.runManager.progressRun(runId, delta),
          onReset: () => {
            run.output = '';
            core.runs.update(runId, { output: '' });
          },
          record,
        });
        core.memory.captureFromChatTurn({
          input: prompt,
          output: result.text,
          tags: [solo.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'auto'],
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
      planId = uuid();
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
        const agent = autoPlan.agents[i];
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
        childRunIds.push(childId);
      }

      // Wait for all parallel agents to complete (or cancel/fail).
      const terminal = new Set(['completed', 'failed', 'cancelled']);
      while (true) {
        run.signal.throwIfAborted();
        const childRuns = childRunIds.map((cid) => core.runs.getById(cid)!);
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
      if (completedChildren.some(({ run: child }) => child.status !== 'completed')) {
        throw new Error('One or more specialists failed or were cancelled. Inspect their results before retrying.');
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
          privacy: allowLocalMemories ? 'local_only' : 'cloud_allowed',
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

      const synth = await router.call({
        runId,
        knot: synthesisSpec,
        constraints: [...priorContext.constraints, ...agentSpecs],
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
      });

      core.memory.captureFromChatTurn({
        input: prompt,
        output: synth.text,
        tags: ['auto-team'],
        privacy: allowLocalMemories ? 'local_only' : 'cloud_allowed',
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
      if (planId) {
        db.prepare("UPDATE task_plans SET status = 'failed' WHERE id = ? AND status = 'auto_active'").run(
          planId,
        );
      }
      for (const childId of childRunIds) worker.cancel(childId);
      if (!run.isCancelled) {
        core.runManager.failRun(runId, error instanceof Error ? error.message : String(error));
      }
    } finally {
      core.runManager.removeListener('cancelled', onParentCancelled);
    }
  })();

  return {
    runId,
    conversationId,
    title: initialTitle,
    strandName: strand.name,
    model: strand.model,
  };
}
