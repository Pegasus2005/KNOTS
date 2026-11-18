/**
 * Capability map — a built-in database of known model capabilities
 * with a fallback for dynamic detection.
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

/** Default capabilities when a model is not in the database. */
const DEFAULT_CAPABILITIES: CapabilitySet = ['streaming', 'system_prompt'];

/**
 * Look up known capabilities for a provider + model combination.
 * Falls back to a conservative default set.
 */
export function getModelCapabilities(
  provider: ProviderType | string,
  model: string,
): ModelCapability[] {
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
