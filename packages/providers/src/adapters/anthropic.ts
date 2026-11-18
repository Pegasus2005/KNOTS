/**
 * Anthropic adapter — uses the official `@anthropic-ai/sdk` package.
 * System prompt goes in the `system` field, not in messages.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ModelCapability } from '@knots/types';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  ModelInfo,
  ConnectionResult,
  ProviderConfig,
} from '../types.js';
import { ProviderError } from '../types.js';
import { getModelCapabilities } from '../capabilities.js';
import { withRetry } from '../retry.js';

const KNOWN_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
];

function mapFinishReason(reason: string | undefined | null): 'stop' | 'length' | 'error' | 'unknown' {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    default:
      return 'unknown';
  }
}

export class AnthropicAdapter implements ModelProvider {
  public readonly providerId = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(config: Partial<ProviderConfig> = {}) {
    const apiKey =
      config.api_key ??
      ((config as Record<string, unknown>).apiKey as string | undefined);
    if (!apiKey) {
      throw new ProviderError('API key is required for Anthropic', 'auth_error', 'anthropic');
    }
    const baseURL =
      config.endpoint ??
      ((config as Record<string, unknown>).baseUrl as string | undefined);

    this.client = new Anthropic({
      apiKey,
      baseURL,
    });
  }

  async *sendMessage(request: ModelRequest): AsyncGenerator<ModelChunk> {
    const params = this.buildParams(request);

    try {
      const stream = await this.callWithRetry(() => {
        request.signal?.throwIfAborted();
        return this.client.messages.create({ ...params, stream: true }, { signal: request.signal });
      });

      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: string | undefined;

      for await (const event of stream) {
        const ev = event as {
          type: string;
          message?: { usage?: { input_tokens?: number } };
          delta?: { type?: string; text?: string; stop_reason?: string };
          usage?: { output_tokens?: number };
        };

        if (ev.type === 'message_start') {
          inputTokens = ev.message?.usage?.input_tokens ?? 0;
        } else if (ev.type === 'content_block_delta') {
          const delta = ev.delta?.text ?? '';
          if (delta) {
            yield { delta, is_final: false };
          }
        } else if (ev.type === 'message_delta') {
          if (ev.usage?.output_tokens !== undefined) {
            outputTokens = ev.usage.output_tokens;
          }
          if (ev.delta?.stop_reason !== undefined) {
            stopReason = ev.delta.stop_reason;
          }
        } else if (ev.type === 'message_stop') {
          yield {
            delta: '',
            is_final: true,
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            },
            finish_reason: mapFinishReason(stopReason),
            model: request.model,
          };
        }
      }
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async sendMessageSync(request: ModelRequest): Promise<ModelResponse> {
    const params = this.buildParams(request);

    try {
      const message = await this.callWithRetry(() => {
        request.signal?.throwIfAborted();
        return this.client.messages.create({ ...params, stream: false }, { signal: request.signal });
      });

      const content = (message.content ?? [])
        .filter((block: { type: string; text?: string }) => block.type === 'text')
        .map((block: { type: string; text?: string }) => block.text ?? '')
        .join('');

      return {
        content,
        model: message.model ?? request.model,
        usage: {
          prompt_tokens: message.usage?.input_tokens ?? 0,
          completion_tokens: message.usage?.output_tokens ?? 0,
          total_tokens: (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
        },
        finish_reason: mapFinishReason(message.stop_reason),
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return KNOWN_MODELS.map((id) => ({
      id,
      name: id,
      provider: 'anthropic' as const,
      capabilities: getModelCapabilities('anthropic', id),
    }));
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { success: true, latency_ms: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - start,
      };
    }
  }

  getCapabilities(model: string): ModelCapability[] {
    return getModelCapabilities('anthropic', model);
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(async () => {
      try {
        return await fn();
      } catch (err) {
        throw this.wrapError(err);
      }
    });
  }

  private buildParams(
    request: ModelRequest,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const messages: Anthropic.MessageParam[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') continue;
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    if (messages.length === 0) {
      messages.push({ role: 'user', content: '' });
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 4096,
      stream: false,
    };

    const systemContent =
      request.system ??
      request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
    if (systemContent) {
      params.system = systemContent;
    }

    if (request.temperature !== undefined) params.temperature = request.temperature;
    if (request.stop !== undefined) params.stop_sequences = request.stop;

    return params;
  }

  private wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const anyErr = err as { status?: number; message?: string };
    if (typeof anyErr === 'object' && anyErr !== null && typeof anyErr.status === 'number') {
      const status = anyErr.status;
      const msg = anyErr.message ?? String(err);
      if (status === 401) return new ProviderError(msg, 'auth_error', 'anthropic', status);
      if (status === 404) return new ProviderError(msg, 'model_not_found', 'anthropic', status);
      if (status === 429) return new ProviderError(msg, 'rate_limit', 'anthropic', status);
      if (status >= 500) return new ProviderError(msg, 'server_error', 'anthropic', status);
      return new ProviderError(msg, 'unknown', 'anthropic', status);
    }

    return new ProviderError(
      err instanceof Error ? err.message : String(err),
      'connection_error',
      'anthropic',
    );
  }
}
