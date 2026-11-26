import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const wait = async (predicate, label = 'condition') => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for ' + label);
};
export async function testDurable(directory) {
  const { createCore, KnotWorker, requestWorkerStop, callReceipts, controlledProvider } =
    await import('@knots/core');
  // Upgrade an existing v5 workspace without losing its prior run records.
  const upgradePath = directory + '/upgrade';
  const oldCore = createCore(upgradePath);
  const oldRun = oldCore.runs.create({ knot_name: 'legacy', input: 'Preserve this task.' });
  oldCore.database
    .getDb()
    .exec(
      'DROP TABLE bot_drafts; DROP TABLE worker_submissions; DROP TABLE plan_messages; DROP TABLE conversation_summaries; DROP TABLE memories; DROP TABLE conversation_runs; DROP TABLE conversations; DROP TABLE mcp_actions; DROP TABLE plan_tasks; DROP TABLE task_plans; DROP TABLE worker_jobs; DELETE FROM schema_version WHERE version >= 6;',
    );
  oldCore.close();
  const upgraded = createCore(upgradePath);
  assert.equal(upgraded.runs.getById(oldRun.id).input, 'Preserve this task.');
  assert.equal(
    upgraded.database.getDb().prepare('SELECT COUNT(*) AS count FROM worker_jobs').get().count,
    0,
  );
  upgraded.close();
  const home = directory + '/queue';
  await mkdir(home, { recursive: true });
  let core = createCore(home);
  let worker = new KnotWorker(core, { concurrency: 1 });
  const strand = core.strands.create({
    name: 'queue-model',
    provider: 'ollama',
    model: 'fixture',
    is_local: true,
  });
  const knot = {
    version: '0.1.0',
    name: 'queue-bot',
    instructions: 'Answer.',
    tools: [],
    model_preferences: { privacy: 'local_only' },
  };
  core.knots.save(knot);
  const held = [];
  let active = 0;
  let maxActive = 0;
  const provider = {
    async *sendMessage(request) {
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve, reject) => {
          held.push(resolve);
          request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
          if (request.signal.aborted) reject(new Error('aborted'));
        });
        yield { delta: 'done', is_final: true };
      } finally {
        active--;
      }
    },
  };
  const first = await worker.start({ knot, strand, prompt: 'First' }, provider);
  await wait(() => held.length === 1);
  const second = await worker.start({ knot, strand, prompt: 'Second' }, provider);
  assert.equal(core.runs.getById(second).status, 'queued');
  worker.pause(first);
  await wait(() => core.runs.getById(second).status === 'running');
  await wait(() => held.length === 2);
  assert.equal(maxActive, 1, 'paused attempt must settle before the slot is reused');
  assert.equal(core.runs.getById(first).status, 'paused');
  held[1]();
  await wait(() => core.runs.getById(second).status === 'completed');
  await worker.resume(first);
  await wait(() => held.length === 3);
  held[2]();
  await wait(() => core.runs.getById(first).status === 'completed');
  assert.equal(
    core.runs.getById(first).output,
    'done',
    'partial output must not duplicate after resume',
  );
  assert.equal(callReceipts(core, first).length, 2);

  // Kill from another connection: stop is a command to the owner, not a cosmetic DB status change.
  const stopOne = await worker.start({ knot, strand, prompt: 'Stop active' }, provider);
  await wait(() => active === 1);
  const stopTwo = await worker.start({ knot, strand, prompt: 'Stop queued' }, provider);
  const commandCore = createCore(home);
  requestWorkerStop(commandCore);
  commandCore.close();
  worker.startControlPolling();
  await wait(() => core.runs.getById(stopOne).status === 'cancelled', 'shared stop command');
  assert.equal(core.runs.getById(stopTwo).status, 'cancelled');
  await assert.rejects(
    worker.start({ knot, strand, prompt: 'Blocked dispatch' }, provider),
    /stopped/,
  );
  worker.enableDispatch();
  assert.equal(
    core.runs.getById(stopTwo).status,
    'cancelled',
    'enabling dispatch cannot revive cancelled jobs',
  );

  // The legacy CLI adapter path observes the same stop command during a pending request.
  let legacyEntered = false;
  const legacy = controlledProvider(core, {
    ...provider,
    async sendMessageSync(request) {
      legacyEntered = true;
      await new Promise((resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new Error('legacy request aborted')),
          { once: true },
        );
      });
    },
  });
  const legacyCall = legacy.sendMessageSync({
    model: strand.model,
    messages: [{ role: 'user', content: 'wait' }],
  });
  assert.equal(legacyEntered, true);
  requestWorkerStop(core);
  await assert.rejects(legacyCall, /aborted/);
  worker.syncControl();
  worker.enableDispatch();

  // A paused request keeps its cost reservation; a tighter current budget cannot be bypassed by resume.
  core.strands.update(strand.id, {
    routing: { input_usd_per_million: 1, output_usd_per_million: 1 },
  });
  const budgetKnot = {
    ...knot,
    name: 'resume-budget',
    model_preferences: { privacy: 'local_only', max_cost_per_run: 1 },
  };
  core.knots.save(budgetKnot);
  const beforeBudgetCalls = held.length;
  const budgetId = await worker.start({ knot: budgetKnot, strand, prompt: 'Budgeted' }, provider);
  await wait(() => held.length > beforeBudgetCalls);
  worker.pause(budgetId);
  await wait(() => !worker.status(budgetId).settling);
  const reserved = callReceipts(core, budgetId)[0].cost_usd;
  assert.ok(reserved > 0);
  core.knots.save({
    ...budgetKnot,
    model_preferences: { ...budgetKnot.model_preferences, max_cost_per_run: reserved + 0.000001 },
  });
  await worker.resume(budgetId);
  await wait(() => core.runs.getById(budgetId).status === 'failed');
  assert.match(core.runs.getById(budgetId).error, /budget/);
  assert.equal(held.length, beforeBudgetCalls + 1);
  core.strands.update(strand.id, {
    routing: { input_usd_per_million: 0, output_usd_per_million: 0 },
  });

  // Missing input frees a slot and survives a close/reopen with its question intact.
  const inputKnot = { ...knot, name: 'question-bot', tools: ['list_files'] };
  core.knots.save(inputKnot);
  const folder = home + '/input';
  await mkdir(folder);
  const questions = {
    async *sendMessage(request) {
      yield {
        delta:
          request.messages.length === 1
            ? '{"ask":"Which audience?"}'
            : '{"answer":"For developers."}',
        is_final: true,
      };
    },
  };
  const questionId = await worker.start(
    { knot: inputKnot, strand, prompt: 'Write a summary', folder },
    questions,
  );
  await wait(() => core.runs.getById(questionId).status === 'waiting_input');
  await worker.shutdown();
  // Simulate a crash between terminal run and queue lifecycle writes in both directions.
  core.database
    .getDb()
    .prepare("UPDATE worker_jobs SET state = 'running' WHERE run_id = ?")
    .run(first);
  core.database.getDb().prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(stopOne);
  core.close();
  core = createCore(home);
  worker = new KnotWorker(core, { concurrency: 1 });
  worker.recover(async () => questions);
  assert.equal(worker.status(first).state, 'completed', 'completed run must never be resurrected');
  assert.equal(
    core.runs.getById(stopOne).status,
    'cancelled',
    'cancellation intent must survive an interrupted lifecycle write',
  );
  assert.equal(worker.status(questionId).question, 'Which audience?');
  await assert.rejects(worker.resume(questionId, undefined, 'Developers'), /Renew access/);
  await assert.rejects(worker.resume(questionId, {}, 'Developers'), /Choose a folder/);
  await worker.resume(questionId, { folder }, 'Developers');
  await wait(() => core.runs.getById(questionId).status === 'completed');
  assert.equal(core.runs.getById(questionId).output, 'For developers.');

  // Pending approval retains its ID across pause and cannot execute while paused.
  const output = home + '/output';
  await mkdir(output);
  const writing = { ...knot, name: 'pause-writer', tools: ['create_file'] };
  core.knots.save(writing);
  const writer = {
    async *sendMessage(request) {
      yield {
        delta:
          request.messages.length === 1
            ? '{"tool":"create_file","path":"paused.md","content":"approved once"}'
            : '{"answer":"Done."}',
        is_final: true,
      };
    },
  };
  const writeId = await worker.start(
    { knot: writing, strand, prompt: 'Write', outputFolder: output },
    writer,
  );
  const proposal = await wait(() => worker.reviewedFiles.list(writeId)[0]);
  worker.pause(writeId);
  assert.throws(() => worker.reviewedFiles.decide(proposal.id, true), /no longer waiting/);
  await assert.rejects(access(output + '/paused.md'));
  await worker.resume(writeId);
  await wait(() => core.runs.getById(writeId).status === 'waiting_approval');
  assert.equal(worker.reviewedFiles.list(writeId).length, 1);
  worker.reviewedFiles.decide(proposal.id, true);
  await wait(() => core.runs.getById(writeId).status === 'completed');
  worker.reviewedFiles.decide(proposal.id, true);
  assert.equal(await readFile(output + '/paused.md', 'utf8'), 'approved once');
  await worker.shutdown();
  core.close();

  // A real child process is killed between a persisted write state and its observation checkpoint.
  for (const mode of ['verified', 'partial', 'absent']) {
    const path = directory + '/crash-' + mode;
    await mkdir(path + '/input', { recursive: true });
    await mkdir(path + '/output');
    await writeFile(path + '/input/notes.txt', 'source context');
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./crash-worker.mjs', import.meta.url)),
        path,
        mode,
        ...(process.env.CI === 'true' && process.argv.includes('--no-sandbox')
          ? ['--no-sandbox']
          : []),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let childError = '';
    child.stderr.on('data', (data) => {
      childError += data;
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    let ready;
    try {
      ready = await wait(async () => {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error('Crash fixture exited: ' + childError);
        try {
          return JSON.parse(await readFile(path + '/ready.json', 'utf8'));
        } catch {
          return false;
        }
      }, mode + ' crash checkpoint');
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
    const restored = createCore(path);
    const recovered = new KnotWorker(restored, { concurrency: 1 });
    let resumedCalls = 0;
    const resumedProvider = async () => ({
      async *sendMessage(request) {
        resumedCalls++;
        assert.ok(request.messages.some((message) => message.content.includes('source context')));
        assert.ok(
          request.messages.some((message) => message.content.includes('Created and verified')),
        );
        yield { delta: '{"answer":"Recovered safely."}', is_final: true };
      },
    });
    try {
      recovered.recover(resumedProvider);
      assert.equal(restored.runs.getById(ready.runId).status, 'paused');
      const grants = { folder: path + '/input', outputFolder: path + '/output' };
      await assert.rejects(recovered.resume(ready.runId), /Renew access/);
      await assert.rejects(
        recovered.resume(ready.runId, { folder: directory, outputFolder: path + '/output' }),
        /original folders/,
      );
      if (mode !== 'verified') {
        assert.equal(recovered.reviewedFiles.list(ready.runId)[0].state, 'uncertain');
        await assert.rejects(recovered.resume(ready.runId, grants), /Reconcile/);
        if (mode === 'partial') {
          await assert.rejects(
            recovered.reconcile(ready.runId, ready.proposalId, 'verify', grants),
            /differs/,
          );
          await assert.rejects(
            recovered.reconcile(ready.runId, ready.proposalId, 'retry', grants),
            /already exists/,
          );
          assert.equal(await readFile(path + '/output/report.md', 'utf8'), 'partial');
          await writeFile(path + '/output/report.md', 'reviewed report');
          await recovered.reconcile(ready.runId, ready.proposalId, 'verify', grants);
        } else {
          await recovered.reconcile(ready.runId, ready.proposalId, 'retry', grants);
        }
      }
      await recovered.resume(ready.runId, grants);
      if (mode === 'absent') {
        await wait(() => restored.runs.getById(ready.runId).status === 'waiting_approval');
        await assert.rejects(access(path + '/output/report.md'));
        recovered.reviewedFiles.decide(ready.proposalId, true);
      }
      await wait(() => restored.runs.getById(ready.runId).status === 'completed');
      assert.equal(
        resumedCalls,
        1,
        'reads and the completed create action must not be replayed as new model requests',
      );
      assert.equal(recovered.reviewedFiles.list(ready.runId).length, 1);
      assert.equal(await readFile(path + '/output/report.md', 'utf8'), 'reviewed report');
      assert.equal(restored.runs.getById(ready.runId).output, 'Recovered safely.');
    } finally {
      await recovered.shutdown();
      restored.close();
    }
  }
  console.log(
    'PASS: bounded FIFO queue, pause/resume, persisted questions, cross-connection stop, stopped dispatch, renewed grants, approval identity, and real process-crash recovery with verified/partial/absent file outcomes.',
  );
}
