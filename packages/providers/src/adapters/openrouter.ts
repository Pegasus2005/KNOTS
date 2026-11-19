/**
 * OpenRouter adapter — routes to 500+ models (Claude, Gemini, GPT, LLaMA, Mistral, etc.)
 * through https://openrouter.ai/api/v1 using the OpenAI-compatible SDK.
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
import {
  getModelCapabilities,
  detectOpenRouterCapabilities,
  registerDynamicCapabilities,
  type OpenRouterModelMetadata,
} from '../capabilities.js';
import { withRetry } from '../retry.js';

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const OPENROUTER_DEFAULT_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://knots.app',
  'X-Title': 'KNOTS',
};

export interface OpenRouterConfig extends Partial<ProviderConfig> {
  apiKey?: string;
  baseURL?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
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

export class OpenRouterAdapter implements ModelProvider {
  public readonly providerId = 'openrouter' as const;
  private readonly client: OpenAI;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;

  constructor(config: OpenRouterConfig = {}) {
    const apiKey =
      config.api_key ??
      config.apiKey;
    if (!apiKey) {
      throw new ProviderError('API key is required for OpenRouter', 'auth_error', 'openrouter');
    }

    const baseURL = (
      config.baseURL ??
      config.baseUrl ??
      config.endpoint ??
      OPENROUTER_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');

    const customHeaders =
      config.headers ??
      (config.options?.headers as Record<string, string> | undefined);

    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.headers = {
      ...OPENROUTER_DEFAULT_HEADERS,
      ...customHeaders,
    };

    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      defaultHeaders: this.headers,
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
        const choice = chunk.choices?.[0];
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

      const anyCompletion = completion as any;
      if (anyCompletion?.error) {
        throw new Error(anyCompletion.error?.message || JSON.stringify(anyCompletion.error));
      }
      if (!completion.choices || completion.choices.length === 0) {
        throw new Error(`OpenRouter returned no response choices: ${JSON.stringify(completion)}`);
      }

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

  /**
   * Fetch all available models (500+) from OpenRouter's /api/v1/models endpoint
   * and dynamically detect + cache each model's capabilities.
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.callWithRetry(async () => {
        const res = await globalThis.fetch(`${this.baseURL}/models`, {
          headers: {
            ...this.headers,
            Authorization: `Bearer ${this.apiKey}`,
          },
        });
        if (!res.ok) {
          const text = await res.text();
          throw this.mapHttpError(res.status, text);
        }
        return res;
      });

      const payload = (await response.json()) as { data?: OpenRouterModelMetadata[] };
      const entries = payload.data ?? [];

      return entries.map((entry) => {
        const capabilities = detectOpenRouterCapabilities(entry);
        registerDynamicCapabilities('openrouter', entry.id, capabilities);

        return {
          id: entry.id,
          name: entry.name ?? entry.id,
          provider: 'openrouter' as const,
          capabilities,
          context_length: entry.context_length ?? entry.top_provider?.context_length,
          description: entry.description,
        };
      });
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      // Verify auth key via /auth/key or fallback to /models
      const authRes = await globalThis.fetch(`${this.baseURL}/auth/key`, {
        headers: {
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      const latency_ms = Date.now() - start;
      if (authRes.ok) {
        return { success: true, latency_ms };
      }

      if (authRes.status === 401 || authRes.status === 403) {
        return {
          success: false,
          error: `Authentication failed (HTTP ${authRes.status})`,
          latency_ms,
        };
      }

      // If /auth/key is unavailable on a custom proxy, fall back to /models
      const modelsRes = await globalThis.fetch(`${this.baseURL}/models`, {
        headers: {
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      const fallbackLatency = Date.now() - start;
      if (modelsRes.ok) {
        return { success: true, latency_ms: fallbackLatency };
      }
      return {
        success: false,
        error: `HTTP ${modelsRes.status}`,
        latency_ms: fallbackLatency,
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
    return getModelCapabilities('openrouter', model);
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

  private mapHttpError(status: number, body: string): ProviderError {
    if (status === 401 || status === 403) return new ProviderError(`Auth error: ${body}`, 'auth_error', 'openrouter', status);
    if (status === 404) return new ProviderError(`Model not found: ${body}`, 'model_not_found', 'openrouter', status);
    if (status === 429) return new ProviderError(`Rate limited: ${body}`, 'rate_limit', 'openrouter', status);
    if (status >= 500) return new ProviderError(`Server error: ${body}`, 'server_error', 'openrouter', status);
    return new ProviderError(`HTTP ${status}: ${body}`, 'unknown', 'openrouter', status);
  }

  private wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const anyErr = err as { status?: number; message?: string };
    if (typeof anyErr === 'object' && anyErr !== null && typeof anyErr.status === 'number') {
      const status = anyErr.status;
      const msg = anyErr.message ?? String(err);
      if (status === 401 || status === 403) return new ProviderError(msg, 'auth_error', 'openrouter', status);
      if (status === 404) return new ProviderError(msg, 'model_not_found', 'openrouter', status);
      if (status === 429) return new ProviderError(msg, 'rate_limit', 'openrouter', status);
      if (status >= 500) return new ProviderError(msg, 'server_error', 'openrouter', status);
      return new ProviderError(msg, 'unknown', 'openrouter', status);
    }

    return new ProviderError(
      err instanceof Error ? err.message : String(err),
      'connection_error',
      'openrouter',
    );
  }
}
