import assert from 'node:assert/strict';
export async function testLearning(directory) {
  const { createCore, KnotWorker, LearningLab } = await import('@knots/core');
  const core = createCore(directory),
    worker = new KnotWorker(core);
  const local = core.strands.create({
      name: 'local',
      provider: 'ollama',
      model: 'fixture',
      is_local: true,
    }),
    cloud = core.strands.create({
      name: 'cloud',
      provider: 'openai',
      model: 'fixture',
      is_local: false,
    });
  const spec = {
    version: '0.1.0',
    name: 'reporter',
    display_name: 'Reporter',
    description: 'Reports',
    instructions: 'Write a summary',
    tools: ['create_file'],
    model_preferences: { privacy: 'local_only' },
  };
  core.knots.save(spec);
  let sends = 0;
  const lab = new LearningLab(core, worker, async () => ({
    async *sendMessage(request) {
      sends++;
      assert.doesNotMatch(request.system, /File creation:/);
      yield { delta: 'Summary: complete', is_final: true };
    },
  }));
  const wait = async (fn) => {
    for (let i = 0; i < 300; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout');
  };
  try {
    const suiteId = lab.saveSuite({
      name: 'Reports',
      knotName: 'reporter',
      privacy: 'cloud_allowed',
      approved: true,
      cases: [
        {
          id: 'improve',
          input: 'Report A',
          criteria: 'Clear summary',
          split: 'improvement',
          contains: ['Summary'],
        },
        {
          id: 'held',
          input: 'Report B',
          criteria: 'Clear summary',
          split: 'holdout',
          contains: ['Missing'],
        },
      ],
    });
    await assert.rejects(
      lab.evaluate({ suiteId, strandIds: [cloud.id], budgetUsd: 1, maxCalls: 2 }),
      /Local-only/,
    );
    assert.equal(sends, 0);
    await assert.rejects(
      lab.evaluate({ suiteId, strandIds: [local.id], budgetUsd: 0, maxCalls: 1 }),
      /needs 2/,
    );
    const id = await lab.evaluate({ suiteId, strandIds: [local.id], budgetUsd: 0, maxCalls: 2 });
    await wait(() =>
      lab.list().evaluations[0].attempts.every((a) => a.run?.status === 'completed'),
    );
    let batch = lab.list().evaluations[0];
    assert.equal(batch.attempts[0].verdict, 'needs_review');
    assert.equal(batch.attempts[1].verdict, 'fail');
    lab.assess(id, batch.attempts[0].key, 'pass');
    assert.equal(lab.list().evaluations[0].attempts[0].verdict, 'pass');
    await Promise.all([lab.enqueue(id), lab.enqueue(id)]);
    assert.equal(sends, 2);
    core.knots.save({ ...spec, instructions: 'Changed' });
    assert.equal(lab.list().evaluations[0].stale, true);
    const revised = lab.saveSuite({
      name: 'Reports revised',
      knotName: 'reporter',
      privacy: 'local_only',
      previousId: suiteId,
      approved: true,
      cases: [
        { id: 'new', input: 'New report', criteria: 'Summary', split: 'holdout', contains: [] },
      ],
    });
    assert.equal(lab.get('suite', revised).version, 2);
    assert.equal(new LearningLab(core, worker, async () => {}).list().evaluations.length, 1);
    console.log(
      'PASS: immutable evaluation suites, holdout splits, tool-free replay, source privacy, budgets/call bounds, assertions, human assessments, staleness and idempotent queue bindings.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
