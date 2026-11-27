import assert from 'node:assert/strict';
export async function testLearning(directory) {
  const { createCore, KnotWorker, LearningLab } = await import('@knots/core');
  const { Playbooks } = await import('@knots/core');
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
    const books = new Playbooks(core);
    const lesson = books.save({
      knotName: 'reporter',
      kind: 'lesson',
      scope: 'quarterly',
      content: 'Use a clear quarterly overview',
      enabled: true,
    });
    assert.equal(books.retrieve('reporter', 'quarterly report')[0].id, lesson);
    assert.equal(books.retrieve('reporter', 'banana recipes').length, 0);
    assert.throws(
      () =>
        books.save({
          knotName: 'reporter',
          kind: 'lesson',
          scope: 'quarterly',
          content: 'Conflicting',
          enabled: true,
        }),
      /Conflicting/,
    );
    const revisedLesson = books.save({
      knotName: 'reporter',
      kind: 'lesson',
      scope: 'quarterly',
      content: 'Prefer concise quarterly summaries',
      enabled: true,
      supersedes: lesson,
    });
    assert.equal(books.get(lesson).enabled, false);
    const procedure = books.save({
      knotName: 'reporter',
      kind: 'procedure',
      scope: 'report',
      content: 'Read input and create a report',
      enabled: true,
      steps: [
        { tool: 'read_file', path: 'input.txt' },
        { tool: 'create_file', path: 'report.md', content: 'Summary' },
      ],
    });
    assert.equal(
      books.fixture(procedure, {
        files: { 'input.txt': 'Input' },
        expected: { 'report.md': 'Summary' },
      }).passed,
      true,
    );
    assert.equal(
      books.fixture(procedure, {
        files: { 'input.txt': 'Input', 'report.md': 'Existing' },
        expected: { 'report.md': 'Summary' },
      }).passed,
      false,
    );
    assert.throws(
      () =>
        books.save({
          knotName: 'reporter',
          kind: 'procedure',
          scope: 'bad',
          content: 'Escape',
          enabled: true,
          steps: [{ tool: 'read_file', path: '../secret' }],
        }),
      /relative/,
    );
    const imported = books.import('reporter', books.export([procedure], true), true);
    assert.equal(books.get(imported[0]).enabled, false);
    assert.equal(books.get(imported[0]).policy.at(-1).model_preferences.privacy, 'local_only');
    books.forget(revisedLesson);
    assert.equal(books.retrieve('reporter', 'quarterly').length, 0);
    const other = core.strands.create({
      name: 'other-local',
      provider: 'ollama',
      model: 'other',
      is_local: true,
    });
    const audition = await lab.evaluate({
      suiteId: validation,
      strandIds: [local.id, other.id],
      budgetUsd: 0,
      maxCalls: 2,
    });
    assert.throws(() => lab.recommend(audition, 'cost'), /Complete/);
    await wait(() =>
      lab
        .get('evaluation', audition)
        .attempts.every((a) => a.runId && core.runs.getById(a.runId).status === 'completed'),
    );
    for (const attempt of lab.get('evaluation', audition).attempts)
      lab.assess(audition, attempt.key, 'pass');
    const recommendation = lab.recommend(audition, 'cost');
    lab.applyRecommendation(audition, recommendation.strandId, 'cost', 'both');
    assert.equal(core.knots.get('reporter').spec.lanes.deliver[0], recommendation.name);
    assert.equal(core.knots.get('reporter').spec.model_preferences.privacy, 'local_only');
    assert.equal(lab.auditionReport(audition).stale, true);
    assert.throws(() => lab.recommend(audition, 'cost'), /stale/);
    console.log(
      'PASS: reviewed multi-model auditions, recorded metrics, bounded routing changes and stale-evidence rejection.',
    );
    console.log(
      'PASS: scoped playbook retrieval, explicit conflicts/revisions, forgetting, isolated create-only fixtures and untrusted disabled package imports.',
    );
    console.log(
      'PASS: immutable evaluation suites, holdout splits, tool-free replay, source privacy, budgets/call bounds, assertions, human assessments, staleness and idempotent queue bindings.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
