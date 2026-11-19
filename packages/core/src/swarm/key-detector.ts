import type { ProviderType } from '@knots/types';

export interface DetectedProviderInfo {
  provider: ProviderType;
  label: string;
  displayName: string;
  defaultModel: string;
  recommendedRoles: {
    orchestrator: string;
    coder: string;
    researcher: string;
    reviewer: string;
  };
}

/**
 * Automatically inspects the structure/prefix of any API key or endpoint
 * and detects which AI provider it belongs to, with optimal default models.
 */
export function detectProviderFromKey(input: string): DetectedProviderInfo {
  const trimmed = input.trim();

  // 1. OpenRouter (starts with sk-or-v1- or contains openrouter)
  if (trimmed.startsWith('sk-or-v1-') || trimmed.toLowerCase().includes('openrouter')) {
    return {
      provider: 'openrouter',
      label: 'OpenRouter (500+ Models)',
      displayName: 'OpenRouter (500+ Models)',
      defaultModel: 'anthropic/claude-3.7-sonnet',
      recommendedRoles: {
        orchestrator: 'anthropic/claude-3.7-sonnet',
        coder: 'anthropic/claude-3.5-sonnet',
        researcher: 'google/gemini-2.0-flash-001',
        reviewer: 'anthropic/claude-3.7-sonnet',
      },
    };
  }

  // 2. Anthropic (starts with sk-ant-)
  if (trimmed.startsWith('sk-ant-')) {
    return {
      provider: 'anthropic',
      label: 'Anthropic Claude',
      displayName: 'Anthropic Claude',
      defaultModel: 'claude-3-7-sonnet-latest',
      recommendedRoles: {
        orchestrator: 'claude-3-7-sonnet-latest',
        coder: 'claude-3-5-sonnet-latest',
        researcher: 'claude-3-5-haiku-latest',
        reviewer: 'claude-3-7-sonnet-latest',
      },
    };
  }

  // 3. Google Gemini (Google AI Studio keys start with AIzaSy)
  if (trimmed.startsWith('AIzaSy')) {
    return {
      provider: 'google',
      label: 'Google Gemini',
      displayName: 'Google Gemini',
      defaultModel: 'gemini-2.0-flash',
      recommendedRoles: {
        orchestrator: 'gemini-2.5-pro',
        coder: 'gemini-2.0-flash',
        researcher: 'gemini-2.0-flash',
        reviewer: 'gemini-2.5-pro',
      },
    };
  }

  // 4. OpenAI (starts with sk-proj- or sk-)
  if (trimmed.startsWith('sk-proj-') || trimmed.startsWith('sk-admin-') || trimmed.startsWith('sk-')) {
    return {
      provider: 'openai',
      label: 'OpenAI',
      displayName: 'OpenAI (GPT-4o)',
      defaultModel: 'gpt-4o',
      recommendedRoles: {
        orchestrator: 'gpt-4o',
        coder: 'gpt-4o',
        researcher: 'gpt-4o-mini',
        reviewer: 'gpt-4o',
      },
    };
  }

  // 5. Ollama / Local / Custom URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.includes(':11434')) {
    return {
      provider: 'ollama',
      label: 'Local Ollama',
      displayName: 'Local Ollama',
      defaultModel: 'llama3.2',
      recommendedRoles: {
        orchestrator: 'llama3.2',
        coder: 'qwen2.5-coder',
        researcher: 'mistral',
        reviewer: 'llama3.2',
      },
    };
  }

  // 6. Generic / Custom OpenAI-compatible
  return {
    provider: 'openai-compatible',
    label: 'Custom / OpenAI-Compatible',
    displayName: 'Custom / OpenAI-Compatible',
    defaultModel: 'default-model',
    recommendedRoles: {
      orchestrator: 'default-model',
      coder: 'default-model',
      researcher: 'default-model',
      reviewer: 'default-model',
    },
  };
}

