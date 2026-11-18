/**
 * Capability map — a built-in database of known model capabilities
 * with dynamic detection for OpenRouter and override support for custom endpoints.
 */

import type { ModelCapability, ProviderType } from '@knots/types';

type CapabilitySet = ModelCapability[];

const CAPABILITY_DB: Record<string, Record<string, CapabilitySet>> = {
  openai: {
    'gpt-4o':              ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gpt-4o-mini':         ['structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gpt-4-turbo':         ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gpt-4':               ['structured_output', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'o1':                  ['long_context', 'structured_output', 'streaming', 'system_prompt'],
    'o1-mini':             ['structured_output', 'streaming'],
    'o3':                  ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'o3-mini':             ['structured_output', 'streaming', 'tool_calling', 'json_mode'],
  },
  anthropic: {
    'claude-sonnet-4-20250514':     ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'claude-3-5-sonnet-20241022':   ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'claude-3-5-haiku-20241022':    ['structured_output', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'claude-3-opus-20240229':       ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
  },
  google: {
    'gemini-2.0-flash':    ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gemini-2.5-flash':    ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gemini-2.5-pro':      ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gemini-1.5-pro':      ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
    'gemini-1.5-flash':    ['long_context', 'structured_output', 'vision', 'tool_calling', 'streaming', 'system_prompt', 'json_mode'],
  },
  ollama: {
    'llama3':              ['streaming', 'system_prompt'],
    'llama3.1':            ['long_context', 'streaming', 'system_prompt', 'tool_calling'],
    'llama3.2':            ['streaming', 'system_prompt'],
    'llama3.2-vision':     ['vision', 'streaming', 'system_prompt'],
    'codellama':           ['streaming', 'system_prompt'],
    'mistral':             ['streaming', 'system_prompt'],
    'mixtral':             ['long_context', 'streaming', 'system_prompt'],
    'phi3':                ['streaming', 'system_prompt'],
    'gemma2':              ['streaming', 'system_prompt'],
    'deepseek-coder':      ['streaming', 'system_prompt'],
    'qwen2':               ['long_context', 'streaming', 'system_prompt'],
  },
};

/** Default capabilities when a model is not in the database (also default for openai-compatible). */
export const DEFAULT_CAPABILITIES: CapabilitySet = ['streaming', 'system_prompt'];

/** Runtime cache for dynamically discovered capabilities (e.g. from OpenRouter /api/v1/models). */
const DYNAMIC_CAPABILITY_CACHE = new Map<string, CapabilitySet>();

/** Shape of a model entry returned by OpenRouter's /api/v1/models endpoint. */
export interface OpenRouterModelMetadata {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

/**
 * Derive KNOTS ModelCapability tags from OpenRouter model metadata.
 */
export function detectOpenRouterCapabilities(
  model: OpenRouterModelMetadata,
): ModelCapability[] {
  const caps = new Set<ModelCapability>(['streaming', 'system_prompt']);

  const contextLength = model.context_length ?? model.top_provider?.context_length ?? 0;
  if (contextLength >= 32_768) {
    caps.add('long_context');
  }

  const inputModalities = model.architecture?.input_modalities ?? [];
  const modalityStr = (model.architecture?.modality ?? '').toLowerCase();
  if (
    inputModalities.includes('image') ||
    modalityStr.includes('image') ||
    modalityStr.includes('vision') ||
    model.id.toLowerCase().includes('vision')
  ) {
    caps.add('vision');
  }

  const params = new Set(model.supported_parameters ?? []);
  if (params.has('tools') || params.has('tool_choice')) {
    caps.add('tool_calling');
  }
  if (params.has('structured_outputs') || params.has('response_format')) {
    caps.add('structured_output');
    caps.add('json_mode');
  }

  return [...caps];
}

/**
 * Store dynamically detected or overridden capabilities in the runtime cache.
 */
export function registerDynamicCapabilities(
  provider: ProviderType | string,
  model: string,
  capabilities: ModelCapability[],
): void {
  DYNAMIC_CAPABILITY_CACHE.set(`${provider}:${model}`, [...capabilities]);
}

/**
 * Fetch model list from OpenRouter `/api/v1/models` and populate the dynamic capability cache.
 */
export async function fetchOpenRouterCapabilities(
  baseUrl = 'https://openrouter.ai/api/v1',
  apiKey?: string,
): Promise<Map<string, ModelCapability[]>> {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'HTTP-Referer': 'https://knots.app',
    'X-Title': 'KNOTS',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await globalThis.fetch(`${normalizedBase}/models`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: OpenRouterModelMetadata[] };
  const result = new Map<string, ModelCapability[]>();

  for (const entry of payload.data ?? []) {
    const caps = detectOpenRouterCapabilities(entry);
    registerDynamicCapabilities('openrouter', entry.id, caps);
    result.set(entry.id, caps);
  }

  return result;
}

/**
 * Look up known capabilities for a provider + model combination.
 * Checks optional override -> dynamic cache -> built-in database -> default set.
 */
export function getModelCapabilities(
  provider: ProviderType | string,
  model: string,
  overrideCapabilities?: ModelCapability[],
): ModelCapability[] {
  if (overrideCapabilities && overrideCapabilities.length > 0) {
    return [...overrideCapabilities];
  }

  const dynamicHit = DYNAMIC_CAPABILITY_CACHE.get(`${provider}:${model}`);
  if (dynamicHit) {
    return [...dynamicHit];
  }

  // For OpenRouter models (e.g. "openai/gpt-4o", "anthropic/claude-3.5-sonnet"),
  // fall back to the underlying provider's known capability DB if not yet dynamically fetched.
  if (provider === 'openrouter' && model.includes('/')) {
    const slashIdx = model.indexOf('/');
    const upstreamProvider = model.slice(0, slashIdx);
    const upstreamModel = model.slice(slashIdx + 1);
    const upstreamDb = CAPABILITY_DB[upstreamProvider];
    if (upstreamDb) {
      if (upstreamDb[upstreamModel]) return [...upstreamDb[upstreamModel]];
      for (const knownModel of Object.keys(upstreamDb)) {
        if (upstreamModel.startsWith(knownModel)) {
          return [...upstreamDb[knownModel]];
        }
      }
    }
    return [...DEFAULT_CAPABILITIES];
  }

  // For custom OpenAI-compatible endpoints, default to basic capabilities unless overridden.
  if (provider === 'openai-compatible') {
    return [...DEFAULT_CAPABILITIES];
  }

  const providerDb = CAPABILITY_DB[provider];
  if (!providerDb) return [...DEFAULT_CAPABILITIES];

  // Try exact match first, then prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  if (providerDb[model]) return [...providerDb[model]];

  for (const knownModel of Object.keys(providerDb)) {
    if (model.startsWith(knownModel)) {
      return [...providerDb[knownModel]];
    }
  }

  return [...DEFAULT_CAPABILITIES];
}

/**
 * Returns all provider+model entries in the capability database.
 */
export function listKnownModels(): Array<{ provider: string; model: string; capabilities: ModelCapability[] }> {
  const results: Array<{ provider: string; model: string; capabilities: ModelCapability[] }> = [];
  for (const [provider, models] of Object.entries(CAPABILITY_DB)) {
    for (const [model, caps] of Object.entries(models)) {
      results.push({ provider, model, capabilities: [...caps] });
    }
  }
  return results;
}
