import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import Ajv from 'ajv';
import { v4 as uuid } from 'uuid';
import type { KnotSpec } from '@knots/types';
import type { KnotsCore } from '../index.js';
import type { RunContext } from '../run/run-context.js';
export interface McpAction {
  tool: 'mcp_call';
  server: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface McpServer {
  name: string;
  endpoint: string;
  keyRef?: string;
}
export interface McpReceipt {
  id: string;
  run_id: string;
  server: string;
  name: string;
  arguments: string;
  endpoint: string;
  state: string;
  result?: string;
  error?: string;
}
export interface McpTool {
  server: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface McpConnection {
  tools: McpTool[];
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
export type McpConnector = (server: McpServer, signal: AbortSignal) => Promise<McpConnection>;
export function serverURL(endpoint: string) {
  const url = new URL(endpoint);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  )
    throw new Error(
      'Use HTTPS or a loopback HTTP MCP endpoint without embedded credentials, query, or fragment.',
    );
  return url;
}
export class McpTools {
  private waiters = new Map<string, (approve: boolean) => void>();
  constructor(
    private core: KnotsCore,
    private connector: McpConnector = (server, signal) => this.connect(server, signal),
  ) {}
  servers(): McpServer[] {
    return this.core.settings.getJSON<McpServer[]>('mcp_servers') ?? [];
  }
  save(server: McpServer) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(server.name))
      throw new Error('Use a lowercase server name.');
    serverURL(server.endpoint);
    const all = this.servers().filter((item) => item.name !== server.name);
    all.push(server);
    this.core.settings.setJSON('mcp_servers', all);
  }
  async inspect(name: string, signal: AbortSignal) {
    const server = this.servers().find((item) => item.name === name);
    if (!server) throw new Error('Configure that server first.');
    const connection = await this.connector(server, signal);
    try {
      return connection.tools;
    } finally {
      await connection.close();
    }
  }
  remove(name: string) {
    this.core.settings.setJSON(
      'mcp_servers',
      this.servers().filter((server) => server.name !== name),
    );
  }
  private async connect(server: McpServer, signal: AbortSignal): Promise<McpConnection> {
    signal.throwIfAborted();
    const token = server.keyRef ? await this.core.credentials.getApiKey(server.keyRef) : undefined;
    const client = new Client({ name: 'KNOTS', version: '0.1.0' });
    const transport = new StreamableHTTPClientTransport(serverURL(server.endpoint), {
      requestInit: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        redirect: 'error',
      },
      reconnectionOptions: {
        maxRetries: 0,
        maxReconnectionDelay: 1000,
        initialReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
    });
    const abort = () => {
      void client.close();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await client.connect(transport, { signal, timeout: 15000 });
      const result = await client.listTools(undefined, { signal, timeout: 15000 });
      return {
        tools: result.tools.map((tool) => ({
          server: server.name,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        call: async (name, args, signal) =>
          client.callTool({ name, arguments: args }, { signal, timeout: 30000 }),
        close: async () => {
          signal.removeEventListener('abort', abort);
          await client.close();
        },
      };
    } catch (error) {
      signal.removeEventListener('abort', abort);
      await client.close();
      throw error;
    }
  }
  async catalog(knot: KnotSpec, signal: AbortSignal, constraints: KnotSpec[] = []) {
    if (!knot.tools?.includes('mcp_call')) return [];
    const tools: McpTool[] = [];
    for (const [name, allowed] of Object.entries(knot.integrations ?? {})) {
      const server = this.servers().find((item) => item.name === name);
      if (!server) throw new Error(`Configure MCP server ${name}.`);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(
        serverURL(server.endpoint).hostname,
      );
      if (
        !local &&
        [knot, ...constraints].some((spec) => spec.model_preferences?.privacy === 'local_only')
      )
        throw new Error('Local-only data cannot be sent to a remote MCP server.');
      const connection = await this.connector(server, signal);
      try {
        tools.push(...connection.tools.filter((tool) => allowed.includes(tool.name)));
      } finally {
        await connection.close();
      }
    }
    if (!tools.length) throw new Error('No declared MCP tools are available.');
    if (JSON.stringify(tools).length > 64000)
      throw new Error('The selected MCP tool catalog exceeds 64 KB. Select fewer tools.');
    return tools;
  }
  list(runId: string) {
    return this.core.database
      .getDb()
      .prepare('SELECT * FROM mcp_actions WHERE run_id = ? ORDER BY rowid')
      .all(runId) as McpReceipt[];
  }
  prepare(run: RunContext, value: unknown, catalog: McpTool[]): { action: McpAction; id: string } {
    const action = value as McpAction;
    if (
      !action ||
      action.tool !== 'mcp_call' ||
      !action.arguments ||
      typeof action.arguments !== 'object' ||
      Array.isArray(action.arguments) ||
      JSON.stringify(action.arguments).length > 64000
    )
      throw new Error('Invalid MCP arguments.');
    const tool = catalog.find((tool) => tool.server === action.server && tool.name === action.name);
    if (!tool) throw new Error('MCP tool is outside the approved catalog.');
    const validator = new Ajv({ strict: false, allErrors: true }).compile(tool.inputSchema);
    if (!validator(action.arguments))
      throw new Error('MCP arguments do not match the tool schema.');
    const server = this.servers().find((server) => server.name === action.server);
    if (!server) throw new Error('MCP server was removed.');
    const id = uuid();
    this.core.database
      .getDb()
      .prepare(
        "INSERT INTO mcp_actions (id,run_id,server,name,arguments,endpoint,state) VALUES (?,?,?,?,?,?,'pending')",
      )
      .run(
        id,
        run.runId,
        action.server,
        action.name,
        JSON.stringify(action.arguments),
        server.endpoint,
      );
    return { action, id };
  }
  decide(id: string, approve: boolean) {
    const receipt = this.core.database
      .getDb()
      .prepare('SELECT * FROM mcp_actions WHERE id = ?')
      .get(id) as McpReceipt | undefined;
    if (!receipt) throw new Error('MCP action not found.');
    if (receipt.state !== 'pending') return;
    if (!this.waiters.has(id) || this.core.settings.get('worker_dispatch_enabled') === 'false')
      throw new Error('The action is not waiting in an active job.');
    this.core.database
      .getDb()
      .prepare("UPDATE mcp_actions SET state = ? WHERE id = ? AND state = 'pending'")
      .run(approve ? 'approved' : 'rejected', id);
    this.waiters.get(id)!(approve);
  }
  async apply(run: RunContext, id: string, knot: KnotSpec, constraints: KnotSpec[]) {
    const db = this.core.database.getDb();
    const receipt = this.list(run.runId).find((item) => item.id === id);
    if (!receipt) throw new Error('MCP action not found.');
    if (receipt.state === 'completed') return receipt.result!;
    if (receipt.state === 'rejected') return 'The user rejected this MCP call.';
    if (receipt.state !== 'pending')
      throw new Error('Reconcile the uncertain MCP action before resuming.');
    run.status = 'waiting_approval';
    this.core.runs.update(run.runId, { status: 'waiting_approval' });
    const approved = await new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        this.waiters.delete(id);
        if (this.core.runs.getById(run.runId)?.status !== 'paused')
          db.prepare(
            "UPDATE mcp_actions SET state = 'cancelled' WHERE id = ? AND state IN ('pending','approved')",
          ).run(id);
        reject(new Error('MCP approval interrupted.'));
      };
      this.waiters.set(id, (decision) => {
        run.signal.removeEventListener('abort', abort);
        this.waiters.delete(id);
        resolve(decision);
      });
      run.signal.addEventListener('abort', abort, { once: true });
      if (run.signal.aborted) abort();
    });
    if (run.signal.aborted) {
      db.prepare("UPDATE mcp_actions SET state = ? WHERE id = ? AND state = 'approved'").run(
        this.core.runs.getById(run.runId)?.status === 'paused' ? 'pending' : 'cancelled',
        id,
      );
      run.signal.throwIfAborted();
    }
    run.status = 'running';
    this.core.runs.update(run.runId, { status: 'running' });
    if (!approved) return 'The user rejected this MCP call.';
    const server = this.servers().find((item) => item.name === receipt.server);
    if (
      !server ||
      server.endpoint !== receipt.endpoint ||
      !knot.integrations?.[receipt.server]?.includes(receipt.name)
    )
      throw new Error('The MCP connection or tool grant changed.');
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(serverURL(server.endpoint).hostname) &&
      [knot, ...constraints].some((spec) => spec.model_preferences?.privacy === 'local_only')
    )
      throw new Error('Local-only data cannot be sent to a remote MCP server.');
    const connection = await this.connector(server, run.signal);
    try {
      run.signal.throwIfAborted();
      if (this.core.settings.get('worker_dispatch_enabled') === 'false')
        throw new Error('Dispatch is stopped.');
      const tool = connection.tools.find((tool) => tool.name === receipt.name);
      if (
        !tool ||
        !new Ajv({ strict: false }).compile(tool.inputSchema)(JSON.parse(receipt.arguments))
      )
        throw new Error('MCP schema changed; review a fresh call.');
      if (
        !db
          .prepare("UPDATE mcp_actions SET state = 'executing' WHERE id = ? AND state = 'approved'")
          .run(id).changes
      )
        throw new Error('The MCP action was already claimed or cancelled.');
      const result = JSON.stringify(
        await connection.call(receipt.name, JSON.parse(receipt.arguments), run.signal),
      );
      if (result.length > 64000)
        throw new Error('MCP response exceeds 64 KB; outcome requires reconciliation.');
      db.prepare("UPDATE mcp_actions SET state = 'completed', result = ? WHERE id = ?").run(
        result,
        id,
      );
      return result;
    } catch (error) {
      db.prepare(
        "UPDATE mcp_actions SET state = 'uncertain', error = ? WHERE id = ? AND state = 'executing'",
      ).run('The remote outcome is unknown. Inspect the service; do not retry automatically.', id);
      throw error;
    } finally {
      await connection.close();
    }
  }
  reconcile(runId: string, id: string, result: string) {
    if (
      this.core.runs.getById(runId)?.status !== 'paused' ||
      typeof result !== 'string' ||
      !result.trim() ||
      result.length > 64000
    )
      throw new Error('Pause the job and provide a verified outcome of up to 64 KB.');
    const update = this.core.database
      .getDb()
      .prepare(
        "UPDATE mcp_actions SET state = 'completed', result = ?, error = 'Outcome supplied by user after external inspection.' WHERE id = ? AND run_id = ? AND state = 'uncertain'",
      )
      .run(JSON.stringify({ userReconciled: true, result }), id, runId);
    if (!update.changes) throw new Error('Choose an uncertain MCP action.');
  }
}
