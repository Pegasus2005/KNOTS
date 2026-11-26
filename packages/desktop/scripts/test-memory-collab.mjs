import assert from 'node:assert/strict';

export async function testMemoryAndCollab(directory) {
  const { createCore, KnotWorker, KnotPlans, MAX_PLAN_MESSAGES } = await import('@knots/core');
  const core = createCore(directory);
  let plans;
  const worker = new KnotWorker(core, {
    onStop: (mode) => plans?.haltAll(mode),
    beforeClose: () => plans?.settle() ?? Promise.resolve(),
  });

  const localBig = core.strands.create({
    name: 'local-big',
    provider: 'ollama',
    model: 'llama-large',
    is_local: true,
    routing: { context_window: 100000 },
  });
  const localSmall = core.strands.create({
    name: 'local-small',
    provider: 'ollama',
    model: 'llama-small',
    is_local: true,
    routing: { context_window: 950 },
  });
  const cloud = core.strands.create({
    name: 'cloud-one',
    provider: 'openai-compatible',
    model: 'cloud-model',
    is_local: false,
    routing: { context_window: 100000 },
  });

  const wait = async (fn, ms = 5) => {
    for (let i = 0; i < 600; i++) {
      if (plans) await plans.tick();
      const val = fn();
      if (val) return val;
      await new Promise((r) => setTimeout(r, ms));
    }
    throw new Error('Memory/Collab test timeout');
  };
  const terminal = (id) =>
    wait(() => {
      const run = core.runs.getById(id);
      return ['completed', 'failed', 'cancelled'].includes(run.status) && run;
    });

  try {
    // 1. Cross-chat memory retrieval with strict privacy filtering
    const publicMem = core.memory.remember({
      content: 'User prefers strict TypeScript ESM style.',
      tags: ['typescript', 'style'],
      privacy: 'cloud_allowed',
    });
    core.memory.remember({
      content: 'Internal local vault secret XYZ-404.',
      tags: ['typescript', 'secret'],
      privacy: 'local_only',
    });

    const cloudKnot = {
      version: '0.1.0',
      name: 'cloud-helper',
      display_name: 'Cloud helper',
      description: 'Answers TypeScript questions',
      instructions: 'Answer clearly.',
      tools: [],
      model_preferences: { privacy: 'cloud_allowed', max_output_tokens: 200 },
    };
    const localMemKnot = {
      version: '0.1.0',
      name: 'mem-bot',
      display_name: 'Memory bot',
      description: 'Reads/writes cross-chat memory',
      instructions: 'Use memory tools.',
      tools: ['memory'],
      model_preferences: { privacy: 'local_only', max_output_tokens: 200 },
    };
    core.knots.save(cloudKnot);
    core.knots.save(localMemKnot);

    let cloudSeenPrompt = '';
    const cloudRun = await worker.start(
      {
        knot: cloudKnot,
        strand: cloud,
        pinnedStrandId: cloud.id,
        prompt: 'Check typescript rules.',
        conversation: { id: 'fresh-cloud-chat', title: 'TS check' },
      },
      async () => ({
        getCapabilities: () => [],
        async *sendMessage(request) {
          cloudSeenPrompt = JSON.stringify(request.messages);
          yield { delta: 'Done.', is_final: true };
        },
      }),
    );
    assert.equal((await terminal(cloudRun)).status, 'completed');
    assert.match(cloudSeenPrompt, /TypeScript ESM style/);
    assert.doesNotMatch(cloudSeenPrompt, /XYZ-404/, 'local_only memory must never reach cloud');

    // Verify memory tools save_memory & search_memory inside a local knot
    let memTurn = 0;
    const memToolRun = await worker.start(
      {
        knot: localMemKnot,
        strand: localBig,
        pinnedStrandId: localBig.id,
        prompt: 'Inspect typescript notes.',
        conversation: { id: 'local-mem-chat', title: 'Local mem' },
      },
      async () => ({
        getCapabilities: () => [],
        async *sendMessage(request) {
          memTurn++;
          if (memTurn === 1) {
            assert.match(JSON.stringify(request.messages), /XYZ-404/);
            yield {
              delta: JSON.stringify({
                tool: 'save_memory',
                content: 'Remember project port 4778.',
                tags: ['config'],
              }),
              is_final: true,
            };
          } else if (memTurn === 2) {
            yield {
              delta: JSON.stringify({ tool: 'search_memory', query: 'port' }),
              is_final: true,
            };
          } else {
            assert.match(request.messages.at(-1).content, /4778/);
            yield {
              delta: JSON.stringify({ answer: 'Saved and verified 4778.' }),
              is_final: true,
            };
          }
        },
      }),
    );
    assert.equal((await terminal(memToolRun)).output, 'Saved and verified 4778.');
    assert.ok(core.memory.list().some((m) => m.content.includes('4778')));
    assert.equal(core.memory.forget(publicMem.id), true);

    // 2. Context preservation across smaller model switches + allowKnotSwitch handoff
    const longAnswer = 'Detail '.repeat(70); // ~490 bytes per turn
    for (let i = 1; i <= 3; i++) {
      const turnRun = await worker.start(
        {
          knot: cloudKnot,
          strand: cloud,
          pinnedStrandId: cloud.id,
          prompt: `Step ${i}: remember marker TOKEN_${i}.`,
          conversation: {
            id: 'portable-chat',
            title: i === 1 ? 'Portable chat' : undefined,
          },
        },
        async () => ({
          getCapabilities: () => [],
          async *sendMessage() {
            yield { delta: `Ack TOKEN_${i}. ${longAnswer}`, is_final: true };
          },
        }),
      );
      assert.equal((await terminal(turnRun)).status, 'completed');
    }

    // Switch to a different knot AND a smaller-context local strand while preserving chat context
    const switchedKnot = {
      ...cloudKnot,
      name: 'handoff-bot',
      display_name: 'Handoff bot',
      model_preferences: { privacy: 'any', max_output_tokens: 180 },
    };
    core.knots.save(switchedKnot);
    let compactMessages = [];
    const switchedRun = await worker.start(
      {
        knot: switchedKnot,
        strand: localSmall,
        pinnedStrandId: localSmall.id,
        prompt: 'Continue on small model.',
        conversation: { id: 'portable-chat', allowKnotSwitch: true },
      },
      async () => ({
        getCapabilities: () => [],
        async *sendMessage(request) {
          compactMessages = request.messages;
          yield { delta: 'Continued seamlessly.', is_final: true };
        },
      }),
    );
    assert.equal((await terminal(switchedRun)).output, 'Continued seamlessly.');
    assert.match(
      JSON.stringify(compactMessages),
      /Portable context summary|TOKEN_1/,
      'smaller model must receive compacted summary instead of failing',
    );
    assert.ok(
      worker.activity(switchedRun).some((line) => line.includes('compacted context')),
    );

    // Verify allowKnotSwitch inherits earlier local_only privacy from first turn
    const privateBot = {
      ...cloudKnot,
      name: 'private-starter',
      model_preferences: { privacy: 'local_only' },
    };
    core.knots.save(privateBot);
    const priv1 = await worker.start(
      {
        knot: privateBot,
        strand: localBig,
        pinnedStrandId: localBig.id,
        prompt: 'Private secret.',
        conversation: { id: 'priv-handoff', title: 'Priv handoff' },
      },
      async () => ({
        async *sendMessage() {
          yield { delta: 'Noted locally.', is_final: true };
        },
      }),
    );
    assert.equal((await terminal(priv1)).status, 'completed');
    let leakedToCloud = false;
    const priv2 = await worker.start(
      {
        knot: switchedKnot,
        strand: cloud,
        pinnedStrandId: cloud.id,
        prompt: 'Switch to cloud bot.',
        conversation: { id: 'priv-handoff', allowKnotSwitch: true },
      },
      async () => {
        leakedToCloud = true;
        return {
          async *sendMessage() {
            yield { delta: 'no', is_final: true };
          },
        };
      },
    );
    assert.equal((await terminal(priv2)).status, 'failed');
    assert.equal(leakedToCloud, false);

    // 3. Bot-to-bot plan message board + anti-loop message cap
    const peerSender = {
      version: '0.1.0',
      name: 'peer-sender',
      display_name: 'Peer sender',
      description: 'Sends plan messages',
      instructions: 'Coordinate with peers.',
      tools: ['memory'],
      model_preferences: { privacy: 'local_only' },
    };
    const peerReceiver = {
      ...peerSender,
      name: 'peer-receiver',
      display_name: 'Peer receiver',
      description: 'Reads plan messages',
      model_preferences: { privacy: 'cloud_allowed' },
    };
    core.knots.save(peerSender);
    core.knots.save(peerReceiver);

    const planDef = {
      summary: 'Coordinated two-bot plan',
      tasks: [
        {
          id: 'task-a',
          title: 'Discover API',
          knotName: 'peer-sender',
          prompt: 'Find endpoint and message task-b.',
          expectedOutput: 'Endpoint shared',
          dependsOn: [],
        },
        {
          id: 'task-b',
          title: 'Use endpoint',
          knotName: 'peer-receiver',
          prompt: 'Read peer message and answer.',
          expectedOutput: 'Final endpoint note',
          dependsOn: ['task-a'],
        },
      ],
    };

    let senderTurn = 0;
    let receiverTurn = 0;
    let seenByB = '';
    const planResolver = async () => ({
      async *sendMessage(request) {
        if (request.system.includes('Break the supplied goal')) {
          yield { delta: JSON.stringify(planDef), is_final: true };
          return;
        }
        const firstMsg = request.messages[0].content;
        if (firstMsg.includes('Find endpoint')) {
          senderTurn++;
          if (senderTurn === 1) {
            yield {
              delta: JSON.stringify({
                tool: 'send_message',
                to: 'task-b',
                message: 'API endpoint is /v2/orders',
              }),
              is_final: true,
            };
          } else {
            yield { delta: JSON.stringify({ answer: 'Sent endpoint to task-b.' }), is_final: true };
          }
        } else {
          receiverTurn++;
          if (receiverTurn === 1) {
            yield { delta: JSON.stringify({ tool: 'read_messages' }), is_final: true };
          } else {
            seenByB = request.messages.at(-1).content;
            yield { delta: JSON.stringify({ answer: 'Received /v2/orders.' }), is_final: true };
          }
        }
      },
    });
    plans = new KnotPlans(core, worker, planResolver);
    const planId = await plans.create('Coordinate two bots', 'local_only');
    await wait(() => plans.list().find((p) => p.id === planId)?.status === 'draft');
    await plans.approve(planId);
    await wait(() => plans.list().find((p) => p.id === planId)?.status === 'completed');

    const completedPlan = plans.list().find((p) => p.id === planId);
    assert.equal(completedPlan.messages.length, 1);
    assert.equal(completedPlan.messages[0].body, 'API endpoint is /v2/orders');
    assert.match(seenByB, /\/v2\/orders/);

    // Verify anti-loop peer message cap (MAX_PLAN_MESSAGES)
    const { postPlanMessage } = await import('@knots/core');
    core.database.getDb().prepare("UPDATE task_plans SET status = 'active' WHERE id = ?").run(planId);
    for (let i = 1; i < MAX_PLAN_MESSAGES; i++) {
      postPlanMessage(core, {
        planId,
        fromTaskId: 'task-a',
        toTaskId: 'task-b',
        body: `msg-${i}`,
        privacy: 'local_only',
      });
    }
    assert.throws(
      () =>
        postPlanMessage(core, {
          planId,
          fromTaskId: 'task-a',
          toTaskId: 'task-b',
          body: 'overflow',
          privacy: 'local_only',
        }),
      /Peer message limit/,
    );

    console.log(
      'PASS: cross-chat privacy-filtered memory, memory tools, model-independent context compaction, cross-bot chat handoff, and bounded bot-to-bot plan messaging.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
