import assert from 'node:assert/strict';
export async function testConversations(directory) {
  const { createCore, KnotWorker } = await import('@knots/core');
  const core = createCore(directory);
  const worker = new KnotWorker(core);
  const strand = core.strands.create({
    name: 'chat-local',
    provider: 'ollama',
    model: 'fixture',
    is_local: true,
  });
  const cloud = core.strands.create({
    name: 'chat-cloud',
    provider: 'openai-compatible',
    model: 'fixture',
    is_local: false,
  });
  const knot = {
    version: '0.1.0',
    name: 'chat-bot',
    display_name: 'Chat bot',
    description: 'Chat',
    instructions: 'Answer.',
    tools: [],
    model_preferences: { privacy: 'local_only' },
  };
  core.knots.save(knot);
  const wait = async (id) => {
    for (let i = 0; i < 300; i++) {
      const run = core.runs.getById(id);
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('Chat timeout');
  };
  try {
    const first = await worker.start(
      {
        knot,
        strand,
        prompt: 'My project is Cobalt.',
        conversation: { id: 'chat', title: 'Cobalt' },
      },
      {
        async *sendMessage() {
          yield { delta: 'I will remember Cobalt.', is_final: true };
        },
      },
    );
    assert.equal((await wait(first)).status, 'completed');
    const second = await worker.start(
      { knot, strand, prompt: 'What is my project?', conversation: { id: 'chat' } },
      {
        async *sendMessage(request) {
          assert.deepEqual(
            request.messages.map((m) => m.role),
            ['user', 'assistant', 'user'],
          );
          assert.match(request.messages[0].content, /Cobalt/);
          yield { delta: 'Cobalt.', is_final: true };
        },
      },
    );
    assert.equal((await wait(second)).output, 'Cobalt.');
    assert.equal(
      core.database
        .getDb()
        .prepare('SELECT COUNT(*) AS n FROM conversation_runs WHERE conversation_id = ?')
        .get('chat').n,
      2,
    );
    // Relaxing the current knot cannot release earlier private conversation data.
    const relaxed = { ...knot, model_preferences: { privacy: 'cloud_allowed' } };
    core.knots.save(relaxed);
    let contacted = false;
    const privateTurn = await worker.start(
      {
        knot: relaxed,
        strand: cloud,
        pinnedStrandId: cloud.id,
        prompt: 'Continue',
        conversation: { id: 'chat' },
      },
      async () => {
        contacted = true;
        return {
          async *sendMessage() {
            yield { delta: 'no', is_final: true };
          },
        };
      },
    );
    assert.equal((await wait(privateTurn)).status, 'failed');
    assert.equal(contacted, false);
    await assert.rejects(
      worker.start(
        {
          knot: { ...knot, name: 'another' },
          strand,
          prompt: 'Switch bot',
          conversation: { id: 'chat' },
        },
        { async *sendMessage() {} },
      ),
      /original knot/,
    );
    const slow = await worker.start(
      { knot, strand, prompt: 'Wait', conversation: { id: 'busy', title: 'Busy' } },
      {
        async *sendMessage(request) {
          await new Promise((resolve, reject) =>
            request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            }),
          );
        },
      },
    );
    await assert.rejects(
      worker.start(
        { knot, strand, prompt: 'Duplicate', conversation: { id: 'busy' } },
        { async *sendMessage() {} },
      ),
      /current turn/,
    );
    worker.cancel(slow);
    console.log(
      'PASS: persistent chat turns, context handoff, original-bot binding, concurrent-turn rejection and inherited privacy across model changes.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
