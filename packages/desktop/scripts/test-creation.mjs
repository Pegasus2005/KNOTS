import assert from 'node:assert/strict';
export async function testCreation(directory) {
  const { createCore, KnotWorker, BotCreation } = await import('@knots/core');
  const core = createCore(directory),
    worker = new KnotWorker(core);
  core.strands.create({ name: 'local', provider: 'ollama', model: 'fixture', is_local: true });
  const review = {
    spec: {
      version: '0.1.0',
      name: 'report-helper',
      display_name: 'Report helper',
      description: 'Structured reports',
      instructions: 'Write a clear report.',
      tools: [],
      expected_output: 'A report',
    },
    criteria: ['Clear sections'],
    questions: [],
    gaps: [],
    assumptions: [],
    examples: ['Draft a report'],
  };
  const resolver = async () => ({
    async *sendMessage(request) {
      yield {
        delta: request.system.includes('Create one reusable bot')
          ? JSON.stringify(review)
          : 'Completed report',
        is_final: true,
      };
    },
  });
  const creation = new BotCreation(core, worker, resolver);
  async function terminal(id) {
    for (let i = 0; i < 300; i++) {
      const r = core.runs.getById(id);
      if (['completed', 'failed', 'cancelled'].includes(r.status)) return r;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout');
  }
  try {
    const id = creation.create('Help me write a structured report', 'local_only');
    await terminal(await creation.generate(id));
    assert.equal(creation.get(id).review.spec.model_preferences.privacy, 'local_only');
    assert.equal(creation.save(id), 'report-helper');
    const ids = await Promise.all([creation.run(id), creation.run(id)]);
    assert.equal(ids[0], ids[1]);
    assert.equal((await terminal(ids[0])).output, 'Completed report');
    assert.equal(creation.save(id), 'report-helper');
    const reuse = creation.create('Write another report', 'local_only');
    assert.ok(creation.matches('structured reports').length);
    assert.equal(creation.save(reuse, 'report-helper'), 'report-helper');
    const second = creation.create('Inspect authorized project text files', 'local_only');
    creation.edit(second, {
      ...review,
      spec: {
        ...review.spec,
        name: 'project-auditor',
        tools: ['list_files', 'read_file'],
        rules: [{ scope: 'provider', type: 'allow', value: 'openai' }],
        integrations: { unsafe: ['execute'] },
      },
    });
    assert.equal(creation.get(second).review.spec.integrations, undefined);
    assert.equal(creation.get(second).review.spec.rules, undefined);
    creation.save(second);
    await assert.rejects(creation.run(second), /folder/i);
    assert.equal(
      core.database
        .getDb()
        .prepare('SELECT COUNT(*) AS n FROM worker_submissions WHERE key=?')
        .get(`draft:${second}`).n,
      0,
    );
    const bad = creation.create('Unclear request', 'local_only');
    creation.edit(bad, {
      ...review,
      spec: { ...review.spec, name: 'other' },
      questions: ['Which format?'],
    });
    assert.throws(() => creation.save(bad), /Resolve/);
    assert.throws(
      () => creation.edit(bad, { ...review, spec: { ...review.spec, tools: ['shell'] } }),
      /Invalid/,
    );
    core.knots.save({ ...core.knots.get('report-helper').spec, instructions: 'Changed' });
    await assert.rejects(creation.run(id), /changed/);
    const broken = new BotCreation(core, worker, async () => ({
      async *sendMessage() {
        yield { delta: 'invalid json', is_final: true };
      },
    }));
    const invalid = broken.create('Make a bot', 'local_only');
    await terminal(await broken.generate(invalid));
    assert.ok(broken.get(invalid).error);
    assert.throws(() => broken.save(invalid), /review/);
    assert.equal(new BotCreation(core, worker, resolver).get(id).savedName, 'report-helper');
    console.log(
      'PASS: reviewed bot generation, malformed/capability rejection, clarification gate, reuse, privacy, persistent drafts and one-run activation under concurrent submission.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
