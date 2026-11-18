/**
 * Generic OpenAI-compatible adapter — works with any custom OpenAI-API endpoint
 * such as Groq, Together AI, Mistral, Fireworks, DeepSeek, local LM Studio,
 * vLLM, text-generation-webui, etc.
 */

import OpenAI from 'openai';
import type { ModelCapability, ProviderType } from '@knots/types';
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

export interface OpenAICompatibleConfig extends Partial<ProviderConfig> {
  baseURL?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  capabilities?: ModelCapability[];
}

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

export class OpenAICompatibleAdapter implements ModelProvider {
  public readonly providerId: ProviderType = 'openai-compatible';
  protected readonly client: OpenAI;
  protected readonly baseURL: string;
  protected readonly defaultModel?: string;
  protected readonly capabilityOverrides?: ModelCapability[];

  constructor(config: OpenAICompatibleConfig = {}) {
    const raw = config as Record<string, unknown>;
    const baseURL =
      config.baseURL ??
      config.baseUrl ??
      config.endpoint ??
      (raw.base_url as string | undefined);

    if (!baseURL) {
      throw new ProviderError(
        'Base URL (baseURL / endpoint) is required for openai-compatible provider',
        'invalid_request',
        'openai-compatible',
      );
    }

    const apiKey =
      config.api_key ??
      config.apiKey ??
      'not-needed';

    const headers =
      config.headers ??
      (config.options?.headers as Record<string, string> | undefined);

    this.baseURL = baseURL.replace(/\/+$/, '');
    this.defaultModel = config.model ?? config.default_model;
    this.capabilityOverrides =
      config.capabilities ??
      (config.options?.capabilities as ModelCapability[] | undefined);

    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      defaultHeaders: headers,
    });
  }

  async *sendMessage(request: ModelRequest): AsyncGenerator<ModelChunk> {
    const model = request.model || this.defaultModel || '';
    const params = this.buildParams({ ...request, model });

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
          result.model = model;
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
    const model = request.model || this.defaultModel || '';
    const params = this.buildParams({ ...request, model });

    try {
      const completion = await this.callWithRetry(() => {
        request.signal?.throwIfAborted();
        return this.client.chat.completions.create({ ...params, stream: false }, { signal: request.signal });
      });

      const choice = completion.choices[0];
      return {
        content: choice?.message?.content ?? '',
        model: completion.model ?? model,
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
        models.push({
          id: m.id,
          name: m.id,
          provider: this.providerId,
          capabilities: this.getCapabilities(m.id),
        });
      }

      if (models.length === 0 && this.defaultModel) {
        return [
          {
            id: this.defaultModel,
            name: this.defaultModel,
            provider: this.providerId,
            capabilities: this.getCapabilities(this.defaultModel),
          },
        ];
      }

      return models;
    } catch (err) {
      // Some custom OpenAI-compatible servers don't expose /models; fall back to configured defaultModel if available
      if (this.defaultModel) {
        return [
          {
            id: this.defaultModel,
            name: this.defaultModel,
            provider: this.providerId,
            capabilities: this.getCapabilities(this.defaultModel),
          },
        ];
      }
      throw this.wrapError(err);
    }
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const models: string[] = [];
      const response = await this.client.models.list();
      for await (const m of response) {
        models.push(m.id);
      }
      return {
        success: true,
        latency_ms: Date.now() - start,
        models_available: models.length > 0 ? models : this.defaultModel ? [this.defaultModel] : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - start,
      };
    }
  }

  getCapabilities(model: string): ModelCapability[] {
    return getModelCapabilities(this.providerId, model, this.capabilityOverrides);
  }

  // ─── Protected helpers ──────────────────────────────────────────────

  protected callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(async () => {
      try {
        return await fn();
      } catch (err) {
        throw this.wrapError(err);
      }
    });
  }

  protected buildParams(request: ModelRequest): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
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

  protected wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const anyErr = err as { status?: number; message?: string };
    if (typeof anyErr === 'object' && anyErr !== null && typeof anyErr.status === 'number') {
      const status = anyErr.status;
      const msg = anyErr.message ?? String(err);
      if (status === 401 || status === 403) return new ProviderError(msg, 'auth_error', this.providerId, status);
      if (status === 404) return new ProviderError(msg, 'model_not_found', this.providerId, status);
      if (status === 429) return new ProviderError(msg, 'rate_limit', this.providerId, status);
      if (status >= 500) return new ProviderError(msg, 'server_error', this.providerId, status);
      return new ProviderError(msg, 'unknown', this.providerId, status);
    }

    return new ProviderError(
      err instanceof Error ? err.message : String(err),
      'connection_error',
      this.providerId,
    );
  }
}
