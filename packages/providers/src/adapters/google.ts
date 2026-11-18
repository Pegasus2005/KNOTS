/**
 * Google Generative AI adapter — uses the `@google/generative-ai` package.
 * Supports Gemini 2.0 / 2.5 Flash, Pro, etc.
 */

import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type Content,
} from '@google/generative-ai';
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
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

/** Map Google finish reasons to our standard strings. */
function mapFinishReason(reason: string | undefined): 'stop' | 'length' | 'error' | 'unknown' {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'error';
    default:
      return 'unknown';
  }
}

export class GoogleAdapter implements ModelProvider {
  public readonly providerId = 'google' as const;
  private readonly genAI: GoogleGenerativeAI;

  constructor(config: Partial<ProviderConfig> = {}) {
    const apiKey =
      config.api_key ??
      ((config as Record<string, unknown>).apiKey as string | undefined);
    if (!apiKey) {
      throw new ProviderError('API key is required for Google AI', 'auth_error', 'google');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async *sendMessage(request: ModelRequest): AsyncGenerator<ModelChunk> {
    const model = this.getModel(request);
    const contents = this.buildContents(request);

    try {
      const result = await this.callWithRetry(() =>
        model.generateContentStream({ contents }),
      );

      for await (const chunk of result.stream) {
        const text = chunk.text?.() ?? '';
        const finishReason = chunk.candidates?.[0]?.finishReason;
        const isFinal = finishReason !== undefined && finishReason !== null;

        const modelChunk: ModelChunk = { delta: text, is_final: isFinal };

        if (isFinal) {
          modelChunk.finish_reason = mapFinishReason(finishReason);
          modelChunk.model = request.model;
          if (chunk.usageMetadata) {
            modelChunk.usage = {
              prompt_tokens: chunk.usageMetadata.promptTokenCount ?? 0,
              completion_tokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
              total_tokens: chunk.usageMetadata.totalTokenCount ?? 0,
            };
          }
        }

        yield modelChunk;
      }
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async sendMessageSync(request: ModelRequest): Promise<ModelResponse> {
    const model = this.getModel(request);
    const contents = this.buildContents(request);

    try {
      const result = await this.callWithRetry(() =>
        model.generateContent({ contents }),
      );

      const response = result.response;
      const text = response.text?.() ?? '';
      const candidate = response.candidates?.[0];

      return {
        content: text,
        model: request.model,
        usage: {
          prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
          completion_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          total_tokens: response.usageMetadata?.totalTokenCount ?? 0,
        },
        finish_reason: mapFinishReason(candidate?.finishReason as string | undefined),
      };
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return KNOWN_MODELS.map((id) => ({
      id,
      name: id,
      provider: 'google' as const,
      capabilities: getModelCapabilities('google', id),
    }));
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      await model.generateContent({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
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
    return getModelCapabilities('google', model);
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

  private getModel(request: ModelRequest): GenerativeModel {
    const config: {
      model: string;
      systemInstruction?: string;
      generationConfig?: Record<string, unknown>;
    } = {
      model: request.model,
    };

    const systemContent =
      request.system ??
      request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n');
    if (systemContent) {
      config.systemInstruction = systemContent;
    }

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.stop !== undefined) generationConfig.stopSequences = request.stop;
    if (request.response_format === 'json') {
      generationConfig.responseMimeType = 'application/json';
    }

    if (Object.keys(generationConfig).length > 0) {
      config.generationConfig = generationConfig;
    }

    return this.genAI.getGenerativeModel(config);
  }

  private buildContents(request: ModelRequest): Content[] {
    const contents: Content[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') continue;

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: '' }] });
    }

    return contents;
  }

  private wrapError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('API key')) {
      return new ProviderError(message, 'auth_error', 'google');
    }
    if (message.includes('not found') || message.includes('404')) {
      return new ProviderError(message, 'model_not_found', 'google');
    }
    if (message.includes('429') || message.includes('quota') || message.includes('rate')) {
      return new ProviderError(message, 'rate_limit', 'google');
    }
    if (message.includes('500') || message.includes('internal')) {
      return new ProviderError(message, 'server_error', 'google');
    }

    return new ProviderError(message, 'connection_error', 'google');
  }
}
