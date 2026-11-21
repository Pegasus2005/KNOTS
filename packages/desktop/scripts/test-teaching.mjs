import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

export async function testTeaching(core, worker) {
  const { KnotTeaching, callReceipts } = await import('@knots/core');
  const terminal = async (id) => {
    const started = Date.now();
    while (Date.now() - started < 5000) {
      const run = core.runs.getById(id);
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Timed out: ' + id);
  };
  const local = core.strands.create({
    name: 'teach-local',
    provider: 'ollama',
    model: 'teacher',
    is_local: true,
  });
  const cloud = core.strands.create({
    name: 'teach-cloud',
    provider: 'openai-compatible',
    model: 'remote',
    is_local: false,
  });
  let preparedCloud = 0;
  const requests = [];
  let invalid = false;
  let failReplay = false;
  const resolver = async (strand) => {
    if (!strand.is_local) preparedCloud++;
    return {
      async *sendMessage(request) {
        requests.push(request);
        if (request.system.includes('Propose a small')) {
          yield {
            delta: invalid
              ? 'invalid json'
              : JSON.stringify({
                  instructions: 'Write a concise bullet report.',
                  tools: ['create_file'],
                  model_preferences: { privacy: 'any' },
                }),
            is_final: true,
          };
        } else {
          if (failReplay) throw new Error('fixture replay failure');
          yield {
            delta: request.system.includes('concise bullet')
              ? '- concise result'
              : 'A long report.',
            is_final: true,
          };
        }
      },
    };
  };
  const base = {
    version: '0.1.0',
    name: 'teaching-fixture',
    instructions: 'Write a report.',
    tools: [],
    lanes: { default: [local.name] },
    model_preferences: { privacy: 'local_only' },
  };
  core.knots.save(base, { overwrite: false });
  const source = await worker.start(
    { knot: base, strand: local, prompt: 'Summarize release notes.' },
    resolver,
  );
  assert.equal((await terminal(source)).status, 'completed');
  const teaching = new KnotTeaching(core, worker, resolver);
  const create = (runId = source) =>
    teaching.create({
      runId,
      exampleInput: 'Release notes: better knots.',
      correction: '- better knots',
      note: 'Prefer concise bullets.',
    });
  const id = await create();
  const row = () => teaching.list().find((change) => change.id === id);
  await terminal(row().generation_run_id);
  assert.equal(row().state, 'ready');
  assert.equal(preparedCloud, 0, 'source local-only enforced before resolving cloud credentials');
  assert.equal(
    core.knots.get(base.name).spec.instructions,
    base.instructions,
    'proposal never applies itself',
  );
  const secondSource = await worker.start(
    { knot: base, strand: local, prompt: 'Different release notes.' },
    resolver,
  );
  await terminal(secondSource);
  const heldout = await create(secondSource);
  await terminal(teaching.list().find((change) => change.id === heldout).generation_run_id);
  const evalIds = await teaching.evaluate(id, [heldout], local.id);
  let comparison = row().evaluations.find((evaluation) => evaluation.id === evalIds[0]);
  await terminal(comparison.before_run_id);
  await terminal(comparison.after_run_id);
  comparison = row().evaluations[0];
  assert.equal(comparison.before.output, 'A long report.');
  assert.equal(comparison.after.output, '- concise result');
  assert.equal(comparison.before.strand_id, comparison.after.strand_id);
  assert.equal(callReceipts(core, comparison.before_run_id).length, 1);
  assert.equal(callReceipts(core, comparison.after_run_id).length, 1);
  assert.equal(requests.at(-1).messages[0].content, 'Release notes: better knots.');
  assert.ok(!requests.at(-1).system.includes('You can use these tools'));
  teaching.assess(comparison.id, 'after');
  assert.equal(row().evaluations[0].assessment, 'after');
  assert.throws(() => teaching.assess(comparison.id, 'excellent'), /Invalid/);
  await assert.rejects(teaching.evaluate(id, [], local.id), /Select between/);
  await assert.rejects(
    teaching.create({
      runId: comparison.before_run_id,
      exampleInput: 'x',
      correction: 'y',
      note: 'z',
    }),
    /completed task/,
  );
  // Model changes cannot release historically private example data.
  core.knots.save({ ...base, model_preferences: { privacy: 'any' } });
  await assert.rejects(teaching.evaluate(id, [heldout], cloud.id), /requires a local model/);
  const relaxed = await create();
  await terminal(teaching.list().find((change) => change.id === relaxed).generation_run_id);
  const blockedIds = await teaching.evaluate(relaxed, [heldout], cloud.id);
  const blocked = teaching
    .list()
    .find((change) => change.id === relaxed)
    .evaluations.find((evaluation) => evaluation.id === blockedIds[0]);
  assert.equal((await terminal(blocked.before_run_id)).status, 'failed');
  assert.equal((await terminal(blocked.after_run_id)).status, 'failed');
  assert.equal(preparedCloud, 0);
  assert.throws(() => teaching.assess(blocked.id, 'after'), /must complete/);
  assert.throws(() => teaching.decide(id, 'accept'), /changed while/);
  core.knots.save(base);
  teaching.decide(id, 'accept');
  assert.equal(row().state, 'accepted');
  assert.equal(core.knots.get(base.name).spec.instructions, 'Write a concise bullet report.');
  assert.deepEqual(core.knots.get(base.name).spec.tools, []);
  assert.equal(core.knots.get(base.name).spec.model_preferences.privacy, 'local_only');
  const backups = await readdir(core.dataDir + '/knots/.versions');
  assert.ok(backups.filter((name) => name.startsWith(base.name + '.')).length >= 3);
  // Revert restores instructions while retaining unrelated newer settings.
  core.knots.save({ ...core.knots.get(base.name).spec, description: 'New description' });
  teaching.decide(id, 'revert');
  assert.equal(core.knots.get(base.name).spec.instructions, base.instructions);
  assert.equal(core.knots.get(base.name).spec.description, 'New description');
  assert.equal(row().state, 'reverted');
  assert.throws(() => teaching.decide(id, 'accept'), /unavailable/);
  // Failed model proposals retain the correction and never alter the bot.
  invalid = true;
  const malformed = await create();
  await terminal(teaching.list().find((change) => change.id === malformed).generation_run_id);
  assert.equal(teaching.list().find((change) => change.id === malformed).state, 'failed');
  assert.throws(() => teaching.decide(malformed, 'accept'), /unavailable/);
  invalid = false;
  failReplay = true;
  const failedEval = await teaching.evaluate(heldout, [heldout], local.id);
  const evaluation = teaching
    .list()
    .find((change) => change.id === heldout)
    .evaluations.find((item) => item.id === failedEval[0]);
  assert.equal((await terminal(evaluation.after_run_id)).status, 'failed');
  assert.equal((await terminal(evaluation.before_run_id)).status, 'failed');
  assert.match(
    teaching
      .list()
      .find((change) => change.id === heldout)
      .evaluations.at(-1).after.error,
    /fixture replay failure/,
  );
  const { createCore } = await import('@knots/core');
  const reopened = createCore(core.dataDir);
  try {
    const diskHistory = new KnotTeaching(
      reopened,
      new (await import('@knots/core')).KnotWorker(reopened),
      resolver,
    ).list();
    assert.equal(diskHistory.find((change) => change.id === id).evaluations[0].assessment, 'after');
    assert.equal(
      diskHistory.find((change) => change.id === id).source.input,
      'Summarize release notes.',
    );
  } finally {
    reopened.close();
  }
  const old = core.runManager.createRun({ knotName: base.name, input: 'Old task' });
  core.runManager.startRun(old.runId);
  core.runManager.completeRun(old.runId, { output: 'Old result' });
  await assert.rejects(create(old.runId), /recorded knot definition/);
  core.knots.save({
    ...core.knots.get(base.name).spec,
    instructions: 'Later manual instructions.',
  });
  await assert.rejects(create(), /changed since/);
  const restored = new KnotTeaching(core, worker, resolver);
  assert.equal(
    restored.list().find((change) => change.id === id).evaluations[0].assessment,
    'after',
  );
  teaching.decide(heldout, 'reject');
  assert.equal(restored.list().find((change) => change.id === heldout).state, 'rejected');
  console.log(
    'PASS: corrected-run proposals, held-out text comparisons, model pinning, privacy retention, manual assessments, stale-edit protection, acceptance/backups/revert, malformed output, failed replay and persisted history.',
  );
}
