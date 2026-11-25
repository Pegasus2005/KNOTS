import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDefaultRegistry } from '@knots/providers';
export async function testProviderContracts() {
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    let data = '';
    for await (const chunk of req) data += chunk;
    const input = JSON.parse(data || '{}');
    if (req.url.startsWith('/denied')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'fixture authentication failure', type: 'authentication_error' },
        }),
      );
      return;
    }
    if (req.url.includes('/api/chat')) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.end(
        JSON.stringify({
          model: 'fixture',
          message: { role: 'assistant', content: 'READY' },
          done: true,
          prompt_eval_count: 3,
          eval_count: 2,
        }) + '\n',
      );
      return;
    }
    if (req.url.includes('/messages')) {
      if (!input.stream) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg-fixture',
            type: 'message',
            role: 'assistant',
            model: 'fixture',
            content: [{ type: 'text', text: 'READY' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 3, output_tokens: 2 },
          }),
        );
        return;
      }
      res.setHeader('Content-Type', 'text/event-stream');
      for (const [event, data] of [
        [
          'message_start',
          {
            type: 'message_start',
            message: {
              id: 'msg-fixture',
              type: 'message',
              role: 'assistant',
              model: 'fixture',
              content: [],
              usage: { input_tokens: 3, output_tokens: 0 },
            },
          },
        ],
        [
          'content_block_start',
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        ],
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'READY' } },
        ],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        [
          'message_delta',
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 2 },
          },
        ],
        ['message_stop', { type: 'message_stop' }],
      ])
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
      return;
    }
    if (!input.stream) {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'fixture',
          model: 'fixture',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'READY' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }),
      );
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(
      'data: ' +
        JSON.stringify({
          id: 'fixture',
          model: 'fixture',
          choices: [{ index: 0, delta: { content: 'READY' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }) +
        '\n\n',
    );
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registry = createDefaultRegistry();
    for (const type of ['openai', 'openai-compatible', 'anthropic', 'ollama']) {
      const adapter = registry.createProvider(type, {
        api_key: 'fixture-only',
        endpoint: base + (type.startsWith('openai') ? '/v1' : ''),
        default_model: 'fixture',
      });
      const request = {
        model: 'fixture',
        messages: [{ role: 'user', content: 'Test' }],
        system: 'Answer.',
        max_tokens: 16,
      };
      const response = await adapter.sendMessageSync(request);
      assert.equal(response.content, 'READY', type + ' sync');
      let output = '';
      for await (const chunk of adapter.sendMessage(request)) output += chunk.delta;
      assert.equal(output, 'READY', type + ' streaming');
    }
    const denied = registry.createProvider('openai-compatible', {
      api_key: 'fixture',
      endpoint: base + '/denied',
    });
    await assert.rejects(
      denied.sendMessageSync({ model: 'fixture', messages: [{ role: 'user', content: 'Test' }] }),
      (error) => error.code === 'auth_error',
    );
    console.log(
      'PASS: local HTTP provider contracts for OpenAI, compatible, Anthropic and Ollama, streaming/sync responses and normalized authentication errors.',
    );
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
