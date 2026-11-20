import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

export async function testRouting(core, worker, input, output) {
  const { callReceipts } = await import('@knots/core');
  const make = (name, local, routing) =>
    core.strands.create({
      name,
      provider: local ? 'ollama' : 'openai-compatible',
      model: name,
      is_local: local,
      routing,
      capabilities: ['structured_output'],
    });
  const inspector = make('inspect-fixture', true);
  const primary = make('deliver-fixture', false, {
    input_usd_per_million: 1,
    output_usd_per_million: 1,
    context_window: 100000,
  });
  const backup = make('backup-fixture', false, {
    input_usd_per_million: 1,
    output_usd_per_million: 1,
  });
  const unknown = make('unknown-price-fixture', false);
  const small = make('small-context-fixture', true, { context_window: 5 });
  const base = {
    version: '0.1.0',
    name: 'routing-fixture',
    display_name: 'Routing fixture',
    description: 'Reads notes and writes an approved result.',
    instructions: 'Read notes and write a result.',
    tools: ['read_file', 'create_file'],
    lanes: { inspect: [inspector.name], deliver: [primary.name, backup.name] },
  };
  function restrict(knot, models) {
    return { ...knot, rules: models.map((value) => ({ scope: 'model', type: 'allow', value })) };
  }
  const wait = async (check) => {
    for (let i = 0; i < 300; i++) {
      const value = check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Routing check timed out.');
  };
  const terminal = (id) =>
    wait(() => {
      const run = core.runs.getById(id);
      return ['completed', 'failed', 'cancelled'].includes(run.status) && run;
    });
  const json = (action) => ({
    delta: JSON.stringify(action),
    is_final: true,
    usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
  });
  let inspected = 0,
    delivered = 0,
    recovered = 0;
  const factory = async (strand) => ({
    getCapabilities: () => strand.capabilities,
    async *sendMessage(request) {
      if (strand.id === inspector.id) {
        inspected++;
        yield {
          delta: '',
          is_final: false,
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        yield json({ tool: 'read_file', path: 'release.txt' });
      } else if (strand.id === primary.id) {
        delivered++;
        if (delivered === 1) {
          assert.match(request.messages.at(-1).content, /Version one/);
          yield json({ tool: 'create_file', path: 'routed.md', content: '# Routed report' });
        } else {
          assert.match(request.messages.at(-1).content, /Created and verified/);
          yield { delta: 'partial failed response', is_final: false };
          throw Object.assign(new Error('provider unavailable'), { code: 'connection_error' });
        }
      } else if (strand.id === backup.id) {
        recovered++;
        assert.match(request.messages.at(-1).content, /Created and verified/);
        yield json({ answer: 'The approved report was created.' });
      } else throw new Error('Unexpected model call.');
    },
  });
  const id = await worker.start(
    {
      knot: restrict(base, [inspector.model, primary.model, backup.model]),
      strand: primary,
      prompt: 'Read release notes and create a report.',
      folder: input,
      outputFolder: output,
    },
    factory,
  );
  const proposal = await wait(() => worker.reviewedFiles.list(id)[0]);
  worker.reviewedFiles.decide(proposal.id, true);
  assert.equal((await terminal(id)).status, 'completed');
  assert.deepEqual([inspected, delivered, recovered], [1, 2, 1]);
  assert.equal(worker.reviewedFiles.list(id).length, 1);
  assert.equal(await readFile(output + '/routed.md', 'utf8'), '# Routed report');
  const calls = callReceipts(core, id);
  assert.deepEqual(
    calls.map((call) => call.strand_name),
    [inspector.name, primary.name, primary.name, backup.name],
  );
  assert.equal(calls[0].tokens_in, 5, 'cumulative chunks must not be double counted');
  assert.equal(calls[2].status, 'failed');
  assert.equal(calls[2].cost_source, 'estimated');

  let cloudPrepared = 0,
    localCalls = 0;
  const localId = await worker.start(
    {
      knot: restrict(
        {
          ...base,
          tools: ['read_file'],
          model_preferences: { privacy: 'local_only' },
          lanes: {
            inspect: [primary.name, inspector.name],
            deliver: [backup.name, inspector.name],
          },
        },
        [inspector.model, primary.model, backup.model],
      ),
      strand: primary,
      prompt: 'Stay local.',
      folder: input,
    },
    async (strand) => {
      if (!strand.is_local) cloudPrepared++;
      return {
        getCapabilities: () => strand.capabilities,
        async *sendMessage() {
          localCalls++;
          yield json(
            localCalls === 1
              ? { tool: 'read_file', path: 'release.txt' }
              : { answer: 'Local result' },
          );
        },
      };
    },
  );
  assert.equal((await terminal(localId)).status, 'completed');
  assert.equal(cloudPrepared, 0, 'privacy must filter before provider preparation');
  assert.ok(callReceipts(core, localId).every((call) => call.strand_name === inspector.name));

  const noTools = { ...base, tools: [], lanes: {} };
  let dispatches = 0;
  const quietFactory = async (strand) => ({
    getCapabilities: () => strand.capabilities,
    async *sendMessage() {
      dispatches++;
      yield { delta: 'Result', is_final: true };
    },
  });
  for (const [strand, knot, expected] of [
    [small, noTools, /context window/],
    [unknown, { ...noTools, model_preferences: { max_cost_per_run: 1 } }, /pricing required/],
    [primary, { ...noTools, model_preferences: { max_cost_per_run: 0 } }, /budget/],
    [
      inspector,
      { ...noTools, rules: [{ type: 'require', scope: 'capability', value: 'vision' }] },
      /required capability/,
    ],
  ]) {
    const before = dispatches;
    const denied = await worker.start(
      { knot, strand, pinnedStrandId: strand.id, prompt: 'Test constraints' },
      quietFactory,
    );
    assert.equal((await terminal(denied)).status, 'failed');
    assert.match(core.runs.getById(denied).error, expected);
    assert.equal(dispatches, before);
  }
  let budgetCalls = 0;
  const budgetId = await worker.start(
    {
      knot: restrict(
        {
          ...noTools,
          lanes: { deliver: [primary.name, backup.name] },
          model_preferences: { max_cost_per_run: 0.003 },
        },
        [primary.model, backup.model],
      ),
      strand: primary,
      prompt: 'Test budget reservation.',
    },
    async (strand) => ({
      getCapabilities: () => strand.capabilities,
      async *sendMessage() {
        budgetCalls++;
        throw Object.assign(new Error('unavailable'), { code: 'connection_error' });
      },
    }),
  );
  assert.equal((await terminal(budgetId)).status, 'failed');
  assert.equal(budgetCalls, 1, 'fallback must account for the failed attempt reservation');

  const unknownId = await worker.start(
    { knot: noTools, strand: unknown, pinnedStrandId: unknown.id, prompt: 'Unknown cost' },
    quietFactory,
  );
  assert.equal((await terminal(unknownId)).status, 'completed');
  assert.equal(callReceipts(core, unknownId)[0].cost_usd, null);
  assert.equal(core.runs.getById(unknownId).cost, undefined);

  let pinnedCalls = 0;
  const pinId = await worker.start(
    {
      knot: base,
      strand: primary,
      pinnedStrandId: primary.id,
      prompt: 'Pin',
      folder: input,
      outputFolder: output,
    },
    async () => ({
      getCapabilities: () => [],
      async *sendMessage() {
        pinnedCalls++;
        throw Object.assign(new Error('pinned failure'), { code: 'connection_error' });
      },
    }),
  );
  assert.equal((await terminal(pinId)).status, 'failed');
  assert.equal(pinnedCalls, 1, 'an explicit override must not switch models');
  await assert.rejects(access(output + '/unexpected.md'));
  const { registerIpcHandlers } = await import('../dist/main/ipc-handlers.js');
  const handlers = new Map();
  registerIpcHandlers({ handle: (name, fn) => handlers.set(name, fn) }, core, {
    sample: output + '/unused.yaml',
    bundledSample: output + '/unused.yaml',
  });
  const invoke = (channel, ...args) => handlers.get(channel)({}, ...args);
  invoke('knots:save', {
    name: 'ipc-routing-fixture',
    display_name: 'IPC routing fixture',
    description: 'Test routing settings',
    instructions: 'Read notes.',
    expected_output: '',
    editing: false,
    tools: [],
    inspectStrands: inspector.name,
    deliverStrands: [primary.name, backup.name].join(','),
    privacy: 'local_only',
    maxCost: '0.02',
    preferredStrand: inspector.name,
  });
  const persisted = core.knots.get('ipc-routing-fixture').spec;
  assert.equal(persisted.model_preferences.privacy, 'local_only');
  assert.equal(persisted.model_preferences.max_cost_per_run, 0.02);
  assert.deepEqual(persisted.lanes.deliver, [primary.name, backup.name]);
  invoke('strands:routing', primary.id, {
    context_window: 50000,
    input_usd_per_million: 2,
    output_usd_per_million: 3,
  });
  assert.equal(core.strands.getById(primary.id).routing.output_usd_per_million, 3);
  assert.throws(
    () => invoke('strands:routing', primary.id, { context_window: -1 }),
    /positive|nonnegative/,
  );
  const view = invoke('workspace:get');
  assert.equal(view.runs.find((run) => run.id === id).calls.length, 4);
  assert.equal(view.strands.find((item) => item.id === primary.id).api_key_ref, undefined);

  console.log(
    'PASS: routing stages, context preservation, failure-only fallback, single verified write, local-only privacy, capability/context constraints, budgets, unknown cost, pinned override, cumulative usage.',
  );
}
