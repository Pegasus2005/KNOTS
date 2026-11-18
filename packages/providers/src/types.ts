/**
 * Provider-layer types for the KNOTS provider system.
 * Re-exports and extends base types from @knots/types.
 */

import type {
  ModelCapability,
  ProviderType,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  TokenUsage,
  ConnectionResult,
  ModelInfo,
  ProviderConfig,
  ModelProvider,
  ProviderErrorCode,
  ProviderError as IProviderError,
} from '@knots/types';

export type {
  ModelCapability,
  ProviderType,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  TokenUsage,
  ConnectionResult,
  ModelInfo,
  ProviderConfig,
  ModelProvider,
  ProviderErrorCode,
  IProviderError,
};

// ─── Provider Error Class ─────────────────────────────────────────────

export class ProviderError extends Error implements IProviderError {
  public readonly code: ProviderErrorCode;
  public readonly provider: ProviderType;
  public readonly model?: string;
  public readonly retryable: boolean;
  public readonly retry_after_ms?: number;
  public readonly statusCode?: number;

  constructor(
    message: string,
    code: ProviderErrorCode,
    provider: ProviderType,
    statusCode?: number,
    options?: { model?: string; retryable?: boolean; retry_after_ms?: number },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.provider = provider;
    this.statusCode = statusCode;
    this.model = options?.model;
    this.retryable = options?.retryable ?? (code === 'rate_limit' || code === 'connection_error' || code === 'server_error' || code === 'timeout');
    this.retry_after_ms = options?.retry_after_ms;
  }
}

// ─── Provider Factory ─────────────────────────────────────────────────

export type ProviderFactory = (config: ProviderConfig) => ModelProvider;
