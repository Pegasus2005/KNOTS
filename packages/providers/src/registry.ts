/**
 * Provider Registry — register and create providers by type.
 */

import type { Strand, ProviderType } from '@knots/types';
import type { ModelProvider, ProviderConfig, ProviderFactory } from './types.js';
import { ProviderError } from './types.js';
import { OllamaAdapter } from './adapters/ollama.js';
import { OpenAIAdapter } from './adapters/openai.js';
import { AnthropicAdapter } from './adapters/anthropic.js';
import { GoogleAdapter } from './adapters/google.js';

export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  /**
   * Register a provider factory under a type name.
   */
  register(type: string, factory: ProviderFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * Create a provider by type name and config.
   */
  createProvider(type: string, config: Partial<ProviderConfig> = {}): ModelProvider {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new ProviderError(
        `Unknown provider type: ${type}`,
        'invalid_request',
        type as ProviderType,
      );
    }
    const fullConfig: ProviderConfig = {
      type: type as ProviderType,
      ...config,
    };
    return factory(fullConfig);
  }

  /**
   * Create a provider directly from a Strand configuration.
   * The strand's `provider` field selects the factory, and
   * any additional config (API key, base URL) is passed through.
   */
  createFromStrand(strand: Strand, config: Partial<ProviderConfig> = {}): ModelProvider {
    const mergedConfig: Partial<ProviderConfig> = {
      type: strand.provider,
      endpoint: strand.endpoint,
      default_model: strand.model,
      ...config,
    };
    return this.createProvider(strand.provider, mergedConfig);
  }

  /**
   * List all registered provider type names.
   */
  listTypes(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Check whether a provider type is registered.
   */
  has(type: string): boolean {
    return this.factories.has(type);
  }
}

/**
 * Create a default registry with all 4 built-in adapters pre-registered.
 */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  registry.register('ollama', (config) => new OllamaAdapter(config));
  registry.register('openai', (config) => new OpenAIAdapter(config));
  registry.register('anthropic', (config) => new AnthropicAdapter(config));
  registry.register('google', (config) => new GoogleAdapter(config));

  return registry;
}
