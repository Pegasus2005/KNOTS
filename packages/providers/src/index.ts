/**
 * @knots/providers — model adapters and capability detection.
 *
 * Re-exports everything the rest of the monorepo needs.
 */

// Types
export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelChunk,
  ModelMessage,
  ModelInfo,
  ConnectionResult,
  TokenUsage,
  ProviderConfig,
  ProviderFactory,
  ProviderErrorCode,
} from './types.js';
export { ProviderError } from './types.js';

// Adapters
export { OllamaAdapter } from './adapters/ollama.js';
export { OpenAIAdapter } from './adapters/openai.js';
export { AnthropicAdapter } from './adapters/anthropic.js';
export { GoogleAdapter } from './adapters/google.js';

// Registry
export { ProviderRegistry, createDefaultRegistry } from './registry.js';

// Capabilities
export { getModelCapabilities, listKnownModels } from './capabilities.js';

// Retry (useful for consumers too)
export { withRetry, type RetryOptions } from './retry.js';
