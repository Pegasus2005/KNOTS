import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { startNotesServer } from './mcp-notes.mjs';
export async function testMcp(directory) {
  const { createCore, KnotWorker, McpTools, serverURL } = await import('@knots/core');
  const core = createCore(directory);
  const worker = new KnotWorker(core);
  const notes = await startNotesServer({ directory: directory + '/notes', port: 0 });
  worker.mcpTools.save({ name: 'notes', endpoint: notes.endpoint });
  const strand = core.strands.create({
    name: 'mcp-local',
    provider: 'ollama',
    model: 'fixture',
    is_local: true,
  });
  const knot = {
    version: '0.1.0',
    name: 'notes-bot',
    display_name: 'Notes bot',
    description: 'Use the notes integration',
    instructions: 'Create a note when asked.',
    tools: ['mcp_call'],
    integrations: { notes: ['create_note', 'search_notes'] },
    model_preferences: { privacy: 'local_only' },
  };
  core.knots.save(knot);
  const wait = async (fn) => {
    for (let i = 0; i < 500; i++) {
      const result = fn();
      if (result) return result;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('MCP timeout');
  };
  const provider = (name) => ({
    async *sendMessage(request) {
      assert.match(request.system, /Declared MCP catalog/);
      yield {
        delta:
          request.messages.length === 1
            ? JSON.stringify({
                tool: 'mcp_call',
                server: 'notes',
                name: 'create_note',
                arguments: { name, content: 'approved integration output' },
              })
            : '{"answer":"Done."}',
        is_final: true,
      };
    },
  });
  try {
    assert.throws(() => serverURL('http://example.com/mcp'), /HTTPS/);
    assert.throws(() => serverURL('https://token:password@example.com/mcp'), /credentials/);
    const catalog = await worker.mcpTools.inspect('notes', new AbortController().signal);
    assert.equal(catalog.length, 3);
    const id = await worker.start(
      { knot, strand, prompt: 'Create report.md' },
      provider('report.md'),
    );
    const pending = await wait(() => worker.mcpTools.list(id).find((a) => a.state === 'pending'));
    await assert.rejects(access(directory + '/notes/report.md'));
    worker.pause(id);
    assert.throws(() => worker.mcpTools.decide(pending.id, true), /not waiting/);
    await worker.resume(id);
    await wait(() => core.runs.getById(id).status === 'waiting_approval');
    worker.mcpTools.decide(pending.id, true);
    await wait(() => core.runs.getById(id).status === 'completed');
    assert.equal(
      await readFile(directory + '/notes/report.md', 'utf8'),
      'approved integration output',
    );
    worker.mcpTools.decide(pending.id, true);
    assert.equal(worker.mcpTools.list(id).length, 1);
    const rejected = await worker.start(
      { knot, strand, prompt: 'Reject' },
      provider('rejected.md'),
    );
    const rejectAction = await wait(() => worker.mcpTools.list(rejected)[0]);
    worker.mcpTools.decide(rejectAction.id, false);
    await wait(() => core.runs.getById(rejected).status === 'completed');
    await assert.rejects(access(directory + '/notes/rejected.md'));
    const denied = await worker.start(
      { knot, strand, prompt: 'Unknown tool' },
      {
        async *sendMessage() {
          yield {
            delta:
              '{"tool":"mcp_call","server":"notes","name":"read_note","arguments":{"name":"report.md"}}',
            is_final: true,
          };
        },
      },
    );
    await wait(() => core.runs.getById(denied).status === 'failed');
    assert.equal(worker.mcpTools.list(denied).length, 0);
    let contacted = false;
    const policyTools = new McpTools(core, async () => {
      contacted = true;
      throw new Error('not allowed');
    });
    policyTools.save({ name: 'remote', endpoint: 'https://example.com/mcp' });
    await assert.rejects(
      policyTools.catalog(
        { ...knot, integrations: { remote: ['search_notes'] } },
        new AbortController().signal,
      ),
      /Local-only/,
    );
    assert.equal(contacted, false);
    // A remote outcome can be uncertain even when transport cancellation succeeds.
    let calls = 0;
    const uncertainWorker = new KnotWorker(core, {
      mcpConnector: async (server) => ({
        tools: [
          {
            server: server.name,
            name: 'create_note',
            inputSchema: {
              type: 'object',
              properties: { name: { type: 'string' }, content: { type: 'string' } },
              required: ['name', 'content'],
              additionalProperties: false,
            },
          },
        ],
        close: async () => {},
        call: async () => {
          calls++;
          throw new Error('connection lost after dispatch');
        },
      }),
    });
    const uncertain = await uncertainWorker.start(
      { knot, strand, prompt: 'Uncertain' },
      provider('unknown.md'),
    );
    const action = await wait(() => uncertainWorker.mcpTools.list(uncertain)[0]);
    uncertainWorker.mcpTools.decide(action.id, true);
    await wait(() => core.runs.getById(uncertain).status === 'paused');
    assert.equal(uncertainWorker.mcpTools.list(uncertain)[0].state, 'uncertain');
    await assert.rejects(uncertainWorker.resume(uncertain), /Reconcile/);
    uncertainWorker.mcpTools.reconcile(
      uncertain,
      action.id,
      'Inspected notes service: the note was created.',
    );
    await uncertainWorker.resume(uncertain);
    await wait(() => core.runs.getById(uncertain).status === 'completed');
    assert.equal(calls, 1);
    await uncertainWorker.shutdown();
    console.log(
      'PASS: official MCP HTTP transport and notes tools, schema/allowlist checks, exact approval, pause/rejection, local-only server policy, single execution and uncertain-outcome reconciliation.',
    );
  } finally {
    await worker.shutdown();
    await notes.close();
    core.close();
  }
}
