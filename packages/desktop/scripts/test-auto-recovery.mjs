import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
export async function testAutoRecovery(directory) {
  const {
    createCore,
    KnotWorker,
    startAutoChat,
    pauseAutoChat,
    resumeAutoChat,
    recoverAutoChats,
    autoChatStatus,
    autoChatAccounting,
  } = await import('@knots/core');
  let core = createCore(directory),
    worker = new KnotWorker(core, { concurrency: 2 });
  const strand = core.strands.create({
    name: 'local',
    provider: 'ollama',
    model: 'fixture',
    is_local: true,
  });
  const folder = directory + '/input';
  await mkdir(folder);
  let calls = 0;
  const resolver = async () => ({
    async *sendMessage(request) {
      calls++;
      if (request.system.includes('assemble 1 focused agent'))
        yield {
          delta: JSON.stringify({
            title: 'Two specialists',
            strategy: 'Compare findings',
            agents: [
              {
                id: 'a',
                name: 'Alpha',
                instructions: 'Research alpha',
                task: 'Read alpha',
                expectedOutput: 'Alpha result',
              },
              {
                id: 'b',
                name: 'Beta',
                instructions: 'Research beta',
                task: 'Read beta',
                expectedOutput: 'Beta result',
              },
            ],
          }),
          is_final: true,
        };
      else if (request.system.includes('Synthesize'))
        yield { delta: 'Combined verified response', is_final: true };
      else yield { delta: JSON.stringify({ answer: 'Specialist result' }), is_final: true };
    },
  });
  const wait = async (fn) => {
    for (let i = 0; i < 600; i++) {
      const value = fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Automatic recovery timeout');
  };
  try {
    const task = await startAutoChat(core, worker, resolver, {
      prompt: 'Compare two perspectives',
      strand,
      folder,
      requestId: 'stable-task',
      maxCostUsd: 0,
      maxCalls: 10,
    });
    await wait(() => autoChatAccounting(core, task.runId)?.modelCalls >= 1);
    pauseAutoChat(core, worker, task.runId);
    await worker.shutdown();
    core.close();
    core = createCore(directory);
    worker = new KnotWorker(core, { concurrency: 2 });
    worker.recover(resolver);
    recoverAutoChats(core, worker);
    assert.equal(core.runs.getById(task.runId).status, 'paused');
    assert.equal(autoChatStatus(core, worker, task.runId).needsAccess, true);
    await assert.rejects(resumeAutoChat(core, worker, resolver, task.runId), /Renew/);
    await resumeAutoChat(core, worker, resolver, task.runId, { folder });
    await wait(() => core.runs.getById(task.runId).status === 'completed');
    assert.equal(core.runs.getById(task.runId).output, 'Combined verified response');
    const tasks = core.database
      .getDb()
      .prepare(
        'SELECT task_id,run_id FROM plan_tasks WHERE plan_id=(SELECT id FROM task_plans WHERE draft_run_id=?)',
      )
      .all(task.runId);
    assert.equal(tasks.length, 2);
    assert.equal(new Set(tasks.map((t) => t.run_id)).size, 2);
    const before = calls;
    const duplicate = await startAutoChat(core, worker, resolver, {
      prompt: 'Compare two perspectives',
      strand,
      folder,
      requestId: 'stable-task',
    });
    assert.equal(duplicate.runId, task.runId);
    assert.equal(calls, before);
    const accounting = autoChatAccounting(core, task.runId);
    assert.ok(accounting.modelCalls >= 4);
    assert.equal(accounting.costKnown, true);
    assert.equal(accounting.knownCostUsd, 0);
    const bounded = await startAutoChat(core, worker, resolver, {
      prompt: 'Too few calls for a team',
      strand,
      maxCalls: 1,
    });
    await wait(() => ['completed', 'failed'].includes(core.runs.getById(bounded.runId).status));
    assert.equal(core.runs.getById(bounded.runId).status, 'failed');
    assert.equal(autoChatAccounting(core, bounded.runId).modelCalls, 1);
    const priced = core.strands.create({
      name: 'priced',
      provider: 'ollama',
      model: 'priced',
      is_local: true,
      routing: { input_usd_per_million: 1, output_usd_per_million: 1 },
    });
    const noSpend = await startAutoChat(core, worker, resolver, {
      prompt: 'Budget must block dispatch',
      strand: priced,
      pinnedStrandId: priced.id,
      maxCostUsd: 0,
    });
    await wait(() => core.runs.getById(noSpend.runId).status === 'failed');
    assert.equal(autoChatAccounting(core, noSpend.runId).modelCalls, 0);
    core.database
      .getDb()
      .prepare('INSERT INTO call_groups(id,max_cost_usd,max_calls) VALUES(?,?,?)')
      .run('concurrent-budget', 0.004, 10);
    let dispatched = 0;
    const slow = async () => ({
      async *sendMessage() {
        dispatched++;
        await new Promise((r) => setTimeout(r, 100));
        yield { delta: 'Done', is_final: true };
      },
    });
    const budgetSpec = {
      version: '0.1.0',
      name: 'budget-check',
      display_name: 'Budget check',
      description: 'Budget test',
      instructions: 'Answer briefly',
      tools: [],
      model_preferences: { max_output_tokens: 2000 },
    };
    const jobs = await Promise.all(
      [1, 2].map((i) =>
        worker.start(
          {
            knot: budgetSpec,
            groupId: 'concurrent-budget',
            strand: priced,
            pinnedStrandId: priced.id,
            prompt: `Bounded request ${i}`,
            purpose: 'evaluation',
          },
          slow,
        ),
      ),
    );
    await wait(() =>
      jobs.every((id) => ['completed', 'failed'].includes(core.runs.getById(id).status)),
    );
    assert.equal(dispatched, 1);
    assert.equal(jobs.filter((id) => core.runs.getById(id).status === 'failed').length, 1);
    const stopped = await startAutoChat(core, worker, resolver, {
      prompt: 'Cancel the whole team',
      strand,
    });
    worker.stopAll();
    await wait(() => core.runs.getById(stopped.runId).status === 'cancelled');
    await hardCrash(directory + '/hard-crash');
    console.log(
      'PASS: automatic parent checkpoint recovery across core restart, renewed grants, stable task/child identities, shared call limits, aggregate receipts and global cancellation.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}

async function hardCrash(directory) {
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { readFile } = await import('node:fs/promises');
  const { createCore, KnotWorker, recoverAutoChats, resumeAutoChat } = await import('@knots/core');
  await mkdir(directory + '/input', { recursive: true });
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./crash-auto.mjs', import.meta.url)),
      directory,
      ...(process.env.CI === 'true' && process.argv.includes('--no-sandbox')
        ? ['--no-sandbox']
        : []),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let error = '';
  child.stderr.on('data', (data) => (error += data));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let ready;
  try {
    for (let i = 0; i < 1200; i++) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('Automatic crash fixture exited: ' + error);
      try {
        ready = JSON.parse(await readFile(directory + '/ready.json', 'utf8'));
        break;
      } catch {}
      await new Promise((r) => setTimeout(r, 10));
    }
    if (!ready) throw new Error('Automatic crash fixture timed out: ' + error);
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  const core = createCore(directory),
    worker = new KnotWorker(core, { concurrency: 2 }),
    systems = [];
  const resolve = async () => ({
    async *sendMessage(request) {
      systems.push(request.system);
      yield {
        delta: request.system.includes('Synthesize')
          ? 'Recovered combined response'
          : '{"answer":"Recovered slow result"}',
        is_final: true,
      };
    },
  });
  try {
    worker.recover(resolve);
    recoverAutoChats(core, worker);
    assert.equal(core.runs.getById(ready.id).status, 'paused');
    await resumeAutoChat(core, worker, resolve, ready.id, { folder: directory + '/input' });
    for (let i = 0; i < 600 && core.runs.getById(ready.id).status !== 'completed'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(core.runs.getById(ready.id).output, 'Recovered combined response');
    assert.equal(systems.length, 2);
    assert.ok(
      systems.every((s) => !s.includes('assemble 1 focused agent') && !s.includes('Research fast')),
    );
    const ids = core.database
      .getDb()
      .prepare(
        'SELECT run_id FROM plan_tasks WHERE plan_id=(SELECT id FROM task_plans WHERE draft_run_id=?) ORDER BY rowid',
      )
      .all(ready.id)
      .map((r) => r.run_id);
    assert.deepEqual(ids, ready.children);
    console.log(
      'PASS: real SIGKILL recovery resumes the existing unfinished specialist and synthesis without rerunning the completed specialist or planner.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
