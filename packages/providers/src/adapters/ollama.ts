/**
 * Ollama adapter — talks to a local Ollama instance via REST API.
 * No API key required.
 */

import type { ModelCapability } from '@knots/types';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  ModelInfo,
  ConnectionResult,
  ProviderConfig,
  TokenUsage,
} from '../types.js';
import { ProviderError } from '../types.js';
import { getModelCapabilities } from '../capabilities.js';
import { withRetry } from '../retry.js';

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    size: number;
    digest: string;
    modified_at: string;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
      families?: string[];
    };
  }>;
}

interface OllamaChatMessage {
  role: string;
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
    stop?: string[];
  };
  format?: string;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaAdapter implements ModelProvider {
  public readonly providerId = 'ollama' as const;
  private readonly baseUrl: string;

  constructor(config: Partial<ProviderConfig> = {}) {
    const rawUrl =
      config.endpoint ??
      ((config as Record<string, unknown>).baseUrl as string | undefined) ??
      'http://localhost:11434';
    this.baseUrl = rawUrl.replace(/\/+$/, '');
  }

  async *sendMessage(request: ModelRequest): AsyncGenerator<ModelChunk> {
    const body = this.buildChatRequest(request, true);

    const response = await withRetry(() => this.fetch('/api/chat', body));

    if (!response.body) {
      throw new ProviderError('No response body for streaming', 'server_error', 'ollama');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const parseChunkLine = (line: string): ModelChunk | null => {
      const trimmed = line.trim();
      if (!trimmed) return null;

      let chunk: OllamaChatResponse;
      try {
        chunk = JSON.parse(trimmed) as OllamaChatResponse;
      } catch {
        // Ignore malformed NDJSON lines rather than crashing the stream
        return null;
      }

      const delta = chunk.message?.content ?? '';
      if (chunk.done) {
        const usage: TokenUsage = {
          prompt_tokens: chunk.prompt_eval_count ?? 0,
          completion_tokens: chunk.eval_count ?? 0,
          total_tokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
        };
        return { delta, is_final: true, usage, finish_reason: 'stop', model: chunk.model };
      }
      return { delta, is_final: false };
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = parseChunkLine(line);
          if (parsed) {
            yield parsed;
          }
        }
      }

      // Flush any trailing decoded bytes and remaining buffered line
      buffer += decoder.decode();
      if (buffer.trim()) {
        const parsed = parseChunkLine(buffer);
        if (parsed) {
          yield parsed;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async sendMessageSync(request: ModelRequest): Promise<ModelResponse> {
    const body = this.buildChatRequest(request, false);

    const response = await withRetry(() => this.fetch('/api/chat', body));
    const data = (await response.json()) as OllamaChatResponse;

    return {
      content: data.message?.content ?? '',
      model: data.model,
      usage: {
        prompt_tokens: data.prompt_eval_count ?? 0,
        completion_tokens: data.eval_count ?? 0,
        total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      finish_reason: data.done ? 'stop' : 'unknown',
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await withRetry(() =>
      this.fetchGet('/api/tags'),
    );
    const data = (await response.json()) as OllamaTagsResponse;

    return (data.models ?? []).map((m) => ({
      id: m.name,
      name: m.name,
      provider: 'ollama' as const,
      capabilities: getModelCapabilities('ollama', m.name.split(':')[0]),
    }));
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const response = await globalThis.fetch(`${this.baseUrl}/api/tags`);
      const latency_ms = Date.now() - start;
      if (response.ok) {
        return { success: true, latency_ms };
      }
      return { success: false, error: `HTTP ${response.status}`, latency_ms };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - start,
      };
    }
  }

  getCapabilities(model: string): ModelCapability[] {
    return getModelCapabilities('ollama', model.split(':')[0]);
  }

  // ─── Private helpers ────────────────────────────────────────────────

  private buildChatRequest(request: ModelRequest, stream: boolean): OllamaChatRequest {
    const messages: OllamaChatMessage[] = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }

    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    const body: OllamaChatRequest = {
      model: request.model,
      messages,
      stream,
    };

    const options: OllamaChatRequest['options'] = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.max_tokens !== undefined) options.num_predict = request.max_tokens;
    if (request.stop !== undefined) options.stop = request.stop;
    if (Object.keys(options).length > 0) body.options = options;

    if (request.response_format === 'json') body.format = 'json';

    return body;
  }

  private async fetch(path: string, body: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      const response = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw this.mapHttpError(response.status, await response.text());
      }
      return response;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        'connection_error',
        'ollama',
      );
    }
  }

  private async fetchGet(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    try {
      const response = await globalThis.fetch(url);
      if (!response.ok) {
        throw this.mapHttpError(response.status, await response.text());
      }
      return response;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        'connection_error',
        'ollama',
      );
    }
  }

  private mapHttpError(status: number, body: string): ProviderError {
    if (status === 404) return new ProviderError(`Model not found: ${body}`, 'model_not_found', 'ollama', status);
    if (status === 429) return new ProviderError('Rate limited', 'rate_limit', 'ollama', status);
    if (status >= 500) return new ProviderError(`Server error: ${body}`, 'server_error', 'ollama', status);
    return new ProviderError(`HTTP ${status}: ${body}`, 'unknown', 'ollama', status);
  }
}
