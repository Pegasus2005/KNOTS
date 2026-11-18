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
  ProviderType,
  ModelCapability,
} from './types.js';
export { ProviderError } from './types.js';

// Adapters
export { OllamaAdapter } from './adapters/ollama.js';
export { OpenAIAdapter } from './adapters/openai.js';
export { AnthropicAdapter } from './adapters/anthropic.js';
export { GoogleAdapter } from './adapters/google.js';
export {
  OpenRouterAdapter,
  OPENROUTER_DEFAULT_BASE_URL,
  OPENROUTER_DEFAULT_HEADERS,
  type OpenRouterConfig,
} from './adapters/openrouter.js';
export {
  OpenAICompatibleAdapter,
  type OpenAICompatibleConfig,
} from './adapters/openai-compatible.js';

// Registry
export { ProviderRegistry, createDefaultRegistry } from './registry.js';

// Capabilities
export {
  getModelCapabilities,
  listKnownModels,
  detectOpenRouterCapabilities,
  registerDynamicCapabilities,
  fetchOpenRouterCapabilities,
  DEFAULT_CAPABILITIES,
  type OpenRouterModelMetadata,
} from './capabilities.js';

// Retry (useful for consumers too)
export { withRetry, type RetryOptions } from './retry.js';
