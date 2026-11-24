import assert from 'node:assert/strict';
export async function testKnowledge(directory) {
  const { createCore, KnotKnowledge, KnotWorker } = await import('@knots/core');
  const core = createCore(directory);
  const worker = new KnotWorker(core);
  const knowledge = new KnotKnowledge(core);
  const spec = {
    version: '0.1.0',
    name: 'reference-bot',
    display_name: 'Reference bot',
    description: 'Answer from references',
    instructions: 'Use references and cite sources.',
    tools: [],
    model_preferences: { privacy: 'local_only' },
  };
  core.knots.save(spec);
  const strand = core.strands.create({
    name: 'knowledge-local',
    provider: 'ollama',
    model: 'fixture',
    is_local: true,
  });
  try {
    knowledge.attach(
      spec.name,
      'release.md',
      'The cobalt release supports encrypted offline exports.',
    );
    knowledge.attach(spec.name, 'other.md', 'The orchard grows apples and pears.');
    const loaded = core.knots.get(spec.name).spec;
    const references = knowledge.retrieve(loaded, 'cobalt encrypted exports');
    assert.equal(references[0].name, 'release.md');
    assert.equal(references[0].citation, 'K1');
    const id = await worker.start(
      { knot: loaded, strand, prompt: 'What does cobalt support?' },
      {
        async *sendMessage(request) {
          assert.match(request.messages[0].content, /encrypted offline exports/);
          yield { delta: 'Encrypted offline exports [K1].', is_final: true };
        },
      },
    );
    for (let i = 0; i < 100 && core.runs.getById(id).status !== 'completed'; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(core.runs.getById(id).status, 'completed');
    assert.equal(worker.status(id).sources[0].name, 'release.md');
    const bundle = knowledge.export(spec.name);
    assert.equal(bundle.spec.knowledge_refs[0], 'knowledge/0.txt');
    assert.ok(!JSON.stringify(bundle).includes(directory));
    assert.throws(() => knowledge.import(bundle), /already exists/);
    const imported = knowledge.import(bundle, 'imported-reference');
    assert.equal(knowledge.list(imported).length, 2);
    const bad = structuredClone(bundle);
    bad.files[0].path = '../escape.txt';
    assert.throws(() => knowledge.validate(bad), /path/);
    const corrupt = structuredClone(bundle);
    corrupt.files[0].content = 'tampered';
    assert.throws(() => knowledge.validate(corrupt), /hash/);
    const external = { ...loaded, knowledge_refs: ['/etc/passwd'] };
    assert.throws(() => knowledge.retrieve(external, 'anything'), /outside/);
    knowledge.detach(spec.name, knowledge.list(spec.name)[0].ref);
    assert.equal(knowledge.list(spec.name).length, 1);
    assert.equal(
      knowledge.retrieve(loaded, 'cobalt')[0].name,
      'release.md',
      'queued snapshots retain immutable references',
    );
    console.log(
      'PASS: bounded local retrieval, citations/checkpoints, reviewed portable package roundtrip, duplicate/path/hash rejection and retained version references.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
