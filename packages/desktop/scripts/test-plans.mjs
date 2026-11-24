import assert from 'node:assert/strict';
export async function testPlans(directory) {
  const { createCore, KnotWorker, KnotPlans, validateTaskPlan } = await import('@knots/core');
  const core = createCore(directory);
  let plans;
  const worker = new KnotWorker(core, {
    onStop: (mode) => plans.haltAll(mode),
    beforeClose: () => plans.settle(),
  });
  const local = core.strands.create({
    name: 'plan-local',
    provider: 'ollama',
    model: 'fixture',
    is_local: true,
  });
  const cloud = core.strands.create({
    name: 'plan-cloud',
    provider: 'openai-compatible',
    model: 'fixture',
    is_local: false,
  });
  const bot = (name, privacy) => ({
    version: '0.1.0',
    name,
    display_name: name,
    description: 'Test bot',
    instructions: 'Answer.',
    tools: [],
    model_preferences: { privacy },
  });
  const reader = bot('reader', 'local_only');
  const writer = bot('writer', 'cloud_allowed');
  core.knots.save(reader);
  core.knots.save(writer);
  const definition = {
    summary: 'Read then write',
    tasks: [
      {
        id: 'read',
        title: 'Read',
        knotName: 'reader',
        prompt: 'Find facts',
        expectedOutput: 'Facts',
        dependsOn: [],
      },
      {
        id: 'write',
        title: 'Write',
        knotName: 'writer',
        prompt: 'Write summary',
        expectedOutput: 'Summary',
        dependsOn: ['read'],
      },
    ],
  };
  let fail = false;
  let preparedCloud = 0;
  let executions = 0;
  const resolver = async (strand) => {
    if (!strand.is_local) preparedCloud++;
    return {
      async *sendMessage(request) {
        if (request.system.includes('Break the supplied goal')) {
          yield { delta: JSON.stringify(definition), is_final: true };
          return;
        }
        executions++;
        const payload = JSON.parse(request.messages[0].content);
        if (fail) throw new Error('planned failure');
        if (payload.task === 'Write summary') assert.equal(payload.dependencies[0].result, 'facts');
        yield { delta: payload.task === 'Find facts' ? 'facts' : 'summary', is_final: true };
      },
    };
  };
  plans = new KnotPlans(core, worker, resolver);
  const wait = async (fn) => {
    for (let i = 0; i < 500; i++) {
      await plans.tick();
      const value = fn();
      if (value) return value;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('Plan timeout');
  };
  try {
    assert.throws(
      () =>
        validateTaskPlan(
          { ...definition, tasks: definition.tasks.map((t) => ({ ...t, dependsOn: [t.id] })) },
          [reader, writer],
        ),
      /cycles/,
    );
    assert.throws(
      () =>
        validateTaskPlan(
          { ...definition, tasks: [{ ...definition.tasks[0], knotName: 'invented' }] },
          [reader],
        ),
      /saved knot/,
    );
    assert.throws(
      () =>
        validateTaskPlan(
          { ...definition, tasks: [{ ...definition.tasks[0], dependsOn: ['missing'] }] },
          [reader],
        ),
      /missing task/,
    );
    const id = await plans.create('Make a summary', 'local_only');
    await wait(() => plans.list().find((p) => p.id === id).status === 'draft');
    assert.equal(executions, 0, 'draft must never execute its tasks');
    await plans.approve(id);
    await wait(() => plans.list().find((p) => p.id === id).status === 'completed');
    const plan = plans.list().find((p) => p.id === id);
    assert.equal(plan.tasks.length, 2);
    assert.equal(new Set(plan.tasks.map((t) => t.run_id)).size, 2);
    assert.equal(preparedCloud, 0, 'plan privacy must filter cloud before adapter preparation');
    await plans.tick();
    assert.equal(executions, 2, 'completed tasks cannot enqueue twice');
    await assert.rejects(plans.approve(id), /unapproved/);
    assert.throws(() => plans.edit(id, definition), /unapproved/);
    const bad = await plans.create('Fail safely', 'local_only');
    await wait(() => plans.list().find((p) => p.id === bad).status === 'draft');
    fail = true;
    await plans.approve(bad);
    await wait(() => plans.list().find((p) => p.id === bad).status === 'blocked');
    assert.equal(
      plans
        .list()
        .find((p) => p.id === bad)
        .tasks.find((t) => t.task_id === 'write').run_id,
      null,
    );
    fail = false;
    const rejected = await plans.create('Reject', 'local_only');
    await wait(() => plans.list().find((p) => p.id === rejected).status === 'draft');
    plans.cancel(rejected);
    assert.equal(plans.list().find((p) => p.id === rejected).status, 'rejected');
    const stale = await plans.create('Stale', 'local_only');
    await wait(() => plans.list().find((p) => p.id === stale).status === 'draft');
    core.knots.save({ ...reader, instructions: 'Changed' });
    await assert.rejects(plans.approve(stale), /changed/);
    core.knots.save(reader);
    // A terminal run bound before a process interruption stays bound after recovering the plan.
    const restored = new KnotPlans(core, worker, resolver);
    restored.recover();
    await restored.tick();
    assert.equal(restored.list().find((p) => p.id === id).status, 'completed');
    assert.equal(executions, 3);
    console.log(
      'PASS: reviewed DAG plans, validation/cycles, dependency handoff, privacy, one run per task, failure propagation, rejection, stale definitions and persisted bindings.',
    );
  } finally {
    await worker.shutdown();
    core.close();
  }
}
