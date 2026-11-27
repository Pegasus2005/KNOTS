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
      if (request.system.startsWith('Propose a small')) {
        assert.doesNotMatch(JSON.stringify(request.messages), /PRIVATE HOLDOUT/);
        yield {
          delta: JSON.stringify({ instructions: 'Write an improved summary.' }),
          is_final: true,
        };
      } else yield { delta: 'Summary: complete', is_final: true };
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
    core.knots.save(spec);
    const source = await worker.start(
      { knot: { ...spec, tools: [] }, strand: local, prompt: 'A real report request' },
      async () => ({
        async *sendMessage() {
          yield { delta: 'Summary: original', is_final: true };
        },
      }),
    );
    await wait(() => core.runs.getById(source).status === 'completed');
    const proposalId = await lab.propose({
      runId: source,
      correction: 'Summary: corrected',
      note: 'Be precise',
      budgetUsd: 0,
    });
    await wait(() => !!lab.proposals().find((p) => p.id === proposalId)?.proposed);
    assert.throws(() => lab.decideProposal(proposalId, 'accept'), /Complete and assess/);
    const validation = lab.saveSuite({
      name: 'Held out',
      knotName: 'reporter',
      privacy: 'local_only',
      approved: true,
      cases: [
        {
          id: 'held-secret',
          input: 'PRIVATE HOLDOUT new report',
          criteria: 'Summary',
          split: 'holdout',
          contains: ['Summary'],
        },
      ],
    });
    const comparison = await lab.evaluateProposal({
      proposalId,
      suiteId: validation,
      strandIds: [local.id],
      budgetUsd: 0,
      maxCalls: 2,
    });
    await wait(() =>
      lab
        .get('evaluation', comparison)
        .attempts.every((a) => a.runId && core.runs.getById(a.runId).status === 'completed'),
    );
    for (const a of lab.get('evaluation', comparison).attempts)
      lab.assess(comparison, a.key, 'pass');
    lab.defer(proposalId, true);
    assert.equal(lab.proposals().find((p) => p.id === proposalId).deferred, true);
    lab.decideProposal(proposalId, 'accept');
    assert.equal(core.knots.get('reporter').spec.instructions, 'Write an improved summary.');
    lab.decideProposal(proposalId, 'revert');
    assert.equal(core.knots.get('reporter').spec.instructions, spec.instructions);
    console.log(
      'PASS: immutable evaluation suites, holdout splits, tool-free replay, source privacy, budgets/call bounds, assertions, human assessments, staleness and idempotent queue bindings.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
