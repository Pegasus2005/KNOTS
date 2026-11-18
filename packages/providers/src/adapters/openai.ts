/**
 * OpenAI adapter — uses the official `openai` npm package.
 */

import OpenAI from 'openai';
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

/** Well-known OpenAI models for listModels fallback. */
const KNOWN_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'o1',
  'o1-mini',
  'o3',
  'o3-mini',
];

function mapFinishReason(reason: string | undefined | null): 'stop' | 'length' | 'error' | 'unknown' {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'error';
    default:
      return 'unknown';
  }
}

export class OpenAIAdapter implements ModelProvider {
  public readonly providerId = 'openai' as const;
  private readonly client: OpenAI;

  constructor(config: Partial<ProviderConfig> = {}) {
    const apiKey =
      config.api_key ??
      ((config as Record<string, unknown>).apiKey as string | undefined);
    if (!apiKey) {
      throw new ProviderError('API key is required for OpenAI', 'auth_error', 'openai');
    }
    const baseURL =
      config.endpoint ??
      ((config as Record<string, unknown>).baseUrl as string | undefined);

    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  async *sendMessage(request: ModelRequest): AsyncGenerator<ModelChunk> {
    const params = this.buildParams(request);

    try {
      const stream = await this.callWithRetry(() => {
        request.signal?.throwIfAborted();
        return this.client.chat.completions.create({ ...params, stream: true }, { signal: request.signal });
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta?.content ?? '';
        const isFinal = choice.finish_reason !== null && choice.finish_reason !== undefined;

        const result: ModelChunk = { delta, is_final: isFinal };

        if (isFinal) {
          result.finish_reason = mapFinishReason(choice.finish_reason);
          result.model = request.model;
          if (chunk.usage) {
            result.usage = {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
              total_tokens: chunk.usage.total_tokens,
            };
          }
        }

        yield result;
      }
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async sendMessageSync(request: ModelRequest): Promise<ModelResponse> {
    const params = this.buildParams(request);

    try {
      const completion = await this.callWithRetry(() => {
        request.signal?.throwIfAborted();
        return this.client.chat.completions.create({ ...params, stream: false }, { signal: request.signal });
      });

      const choice = completion.choices[0];
      return {
        content: choice?.message?.content ?? '',
        model: completion.model ?? request.model,
        usage: {
          prompt_tokens: completion.usage?.prompt_tokens ?? 0,
          completion_tokens: completion.usage?.completion_tokens ?? 0,
          total_tokens: completion.usage?.total_tokens ?? 0,
        },
        finish_reason: mapFinishReason(choice?.finish_reason),
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.callWithRetry(() => this.client.models.list());
      const models: ModelInfo[] = [];

      for await (const m of response) {
        if (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3')) {
          models.push({
            id: m.id,
            name: m.id,
            provider: 'openai',
            capabilities: getModelCapabilities('openai', m.id),
          });
        }
      }

      if (models.length === 0) {
        return KNOWN_MODELS.map((id) => ({
          id,
          name: id,
          provider: 'openai' as const,
          capabilities: getModelCapabilities('openai', id),
        }));
      }

      return models;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      await this.client.models.list();
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
    return getModelCapabilities('openai', model);
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

  private buildParams(request: ModelRequest): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    for (const msg of request.messages) {
      messages.push({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      });
    }

    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages,
      stream: false,
    };

    if (request.temperature !== undefined) params.temperature = request.temperature;
    if (request.max_tokens !== undefined) params.max_tokens = request.max_tokens;
    if (request.stop !== undefined) params.stop = request.stop;
    if (request.response_format === 'json') {
      params.response_format = { type: 'json_object' };
    }

    return params;
  }

  private wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const anyErr = err as { status?: number; message?: string };
    if (typeof anyErr === 'object' && anyErr !== null && typeof anyErr.status === 'number') {
      const status = anyErr.status;
      const msg = anyErr.message ?? String(err);
      if (status === 401) return new ProviderError(msg, 'auth_error', 'openai', status);
      if (status === 404) return new ProviderError(msg, 'model_not_found', 'openai', status);
      if (status === 429) return new ProviderError(msg, 'rate_limit', 'openai', status);
      if (status >= 500) return new ProviderError(msg, 'server_error', 'openai', status);
      return new ProviderError(msg, 'unknown', 'openai', status);
    }

    return new ProviderError(
      err instanceof Error ? err.message : String(err),
      'connection_error',
      'openai',
    );
  }
}
