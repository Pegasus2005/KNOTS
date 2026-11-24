import { createServer } from 'node:http';
import { mkdir, readdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';

export async function startNotesServer({ directory, port = 4778 }) {
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  const filename = (name) => {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}\.md$/.test(name))
      throw new Error('Use a single Markdown filename.');
    return join(root, name);
  };
  const read = async (name) => {
    const file = filename(name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536)
      throw new Error('Choose a regular note up to 64 KB.');
    return readFile(file, 'utf8');
  };
  const schema = (properties, required) =>
    fromJsonSchema({ type: 'object', properties, required, additionalProperties: false });
  const server = createServer(async (req, res) => {
    const address = server.address();
    const hosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (
      !hosts.includes(req.headers.host) ||
      (req.headers.origin && !hosts.map((host) => 'http://' + host).includes(req.headers.origin)) ||
      req.url !== '/mcp'
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    const mcp = new McpServer({ name: 'knots-notes', version: '1.0.0' });
    mcp.registerTool(
      'search_notes',
      {
        description: 'Search Markdown notes in the configured notes directory.',
        inputSchema: schema({ query: { type: 'string', minLength: 1, maxLength: 200 } }, ['query']),
      },
      async ({ query }) => {
        const notes = [];
        for (const name of (await readdir(root)).slice(0, 200)) {
          try {
            const content = await read(name);
            if (content.toLowerCase().includes(query.toLowerCase()))
              notes.push({ name, excerpt: content.slice(0, 2000) });
          } catch {}
          if (notes.length === 10) break;
        }
        return { content: [{ type: 'text', text: JSON.stringify(notes) }] };
      },
    );
    mcp.registerTool(
      'read_note',
      {
        description: 'Read one Markdown note.',
        inputSchema: schema({ name: { type: 'string' } }, ['name']),
      },
      async ({ name }) => ({ content: [{ type: 'text', text: await read(name) }] }),
    );
    mcp.registerTool(
      'create_note',
      {
        description: 'Create a new Markdown note. Existing files are never overwritten.',
        inputSchema: schema(
          { name: { type: 'string' }, content: { type: 'string', maxLength: 64000 } },
          ['name', 'content'],
        ),
      },
      async ({ name, content }) => {
        if (Buffer.byteLength(content, 'utf8') > 65536) throw new Error('Note exceeds 64 KB.');
        await writeFile(filename(name), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return { content: [{ type: 'text', text: `Created ${name}` }] };
      },
    );
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await mcp.connect(transport);
      res.once('close', () => {
        void mcp.close();
      });
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end();
      await mcp.close();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/mcp`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.env.KNOTS_DEMO_NOTES_DIR || join(homedir(), '.knots', 'demo-notes');
  const demo = await startNotesServer({
    directory,
    port: Number(process.env.KNOTS_DEMO_MCP_PORT || 4778),
  });
  console.log(
    `Notes MCP: ${demo.endpoint}\nDirectory: ${directory}\nTools: search_notes, read_note, create_note`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void demo.close().then(() => process.exit(0));
    });
}
