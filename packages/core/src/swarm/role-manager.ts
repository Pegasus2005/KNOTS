import type { KnotsCore } from '../index.js';
import type { AgentRole, RoleModelBinding, ProviderType } from '@knots/types';
import { detectProviderFromKey, type DetectedProviderInfo } from './key-detector.js';
import { resolveEnvApiKey } from '../connections.js';

const DEFAULT_MODEL_KEY = 'knots_global_default_model';
const CONNECTED_PROVIDERS_KEY = 'connected_providers';
const MODEL_OVERRIDES_KEY = 'knots_model_overrides';

export const DEFAULT_ROLES: AgentRole[] = ['orchestrator', 'coder', 'researcher', 'reviewer'];

export interface ModelOverride {
  id: string;
  targetName: string;
  provider: ProviderType;
  model: string;
  label?: string;
}

export type CustomSkillDefinition = ModelOverride;

export class RoleManager {
  constructor(private core: KnotsCore) {}

  /**
   * Set a specific binding/override for backwards compatibility.
   */
  setBinding(role: string, binding: RoleModelBinding): void {
    this.addOverride(role, role, binding.provider, binding.model, binding.label);
  }

  /**
   * Smart key addition: Paste ANY key, auto-detect the provider, save it,
   * and immediately set it as the global default model powering ALL bots.
   */
  async addAutoDetectedKey(rawInput: string): Promise<DetectedProviderInfo> {
    const detected = detectProviderFromKey(rawInput);
    const key = rawInput.trim();

    // 1. Store API key or endpoint securely
    if (detected.provider === 'ollama') {
      this.core.settings.set('ollama_endpoint', key);
    } else {
      await this.core.credentials.setApiKey(detected.provider, key);
    }

    // 2. Track connected providers
    const connected = this.getConnectedProvidersList();
    if (!connected.includes(detected.provider)) {
      connected.push(detected.provider);
      this.core.settings.set(CONNECTED_PROVIDERS_KEY, JSON.stringify(connected));
    }

    // 3. Set as the Global Default Model for all bots
    this.setDefaultModel(detected.provider, detected.defaultModel, detected.displayName);

    return detected;
  }

  getConnectedProvidersList(): ProviderType[] {
    const raw = this.core.settings.get(CONNECTED_PROVIDERS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async getConnectedProvidersDetails(): Promise<
    Array<{ provider: ProviderType; label: string; displayName: string; defaultModel: string; active: boolean }>
  > {
    const connected = this.getConnectedProvidersList();
    const all: ProviderType[] = ['openrouter', 'anthropic', 'openai', 'google', 'ollama'];

    const meta: Record<ProviderType, { name: string; defaultModel: string }> = {
      openrouter: { name: 'OpenRouter (500+ Models)', defaultModel: 'deepseek/deepseek-chat' },
      anthropic: { name: 'Anthropic Claude', defaultModel: 'claude-3-7-sonnet-latest' },
      openai: { name: 'OpenAI', defaultModel: 'gpt-4o' },
      google: { name: 'Google Gemini', defaultModel: 'gemini-2.0-flash' },
      ollama: { name: 'Local Ollama', defaultModel: 'llama3.2' },
      'openai-compatible': { name: 'OpenAI Compatible', defaultModel: 'default' },
    };

    const details = [];
    for (const p of all) {
      const isConnected = connected.includes(p);
      const hasStoredKey = Boolean(await this.core.credentials.getApiKey(p));
      const hasEnvKey = Boolean(resolveEnvApiKey(p));
      const isOllamaConfigured = p === 'ollama' && Boolean(this.core.settings.get('ollama_endpoint'));
      const active = isConnected || hasStoredKey || hasEnvKey || isOllamaConfigured;

      if (active) {
        details.push({
          provider: p,
          label: meta[p]?.name || p,
          displayName: meta[p]?.name || p,
          defaultModel: meta[p]?.defaultModel || 'default',
          active: true,
        });
      }
    }
    return details;
  }

  /**
   * Get the global default model that powers all bots unless overridden.
   */
  getDefaultModel(): RoleModelBinding {
    const raw = this.core.settings.get(DEFAULT_MODEL_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as RoleModelBinding;
      } catch {}
    }

    // Smart default based on environment or available strands
    const strands = this.core.strands.getAll();
    if (strands.length > 0) {
      const defaultStrand = strands.find((s) => s.is_default) || strands[0];
      return {
        role: 'orchestrator',
        provider: defaultStrand.provider,
        model: defaultStrand.model,
        label: defaultStrand.name,
        endpoint: defaultStrand.endpoint,
      };
    }

    if (process.env.OPENROUTER_API_KEY) {
      return {
        role: 'orchestrator',
        provider: 'openrouter',
        model: 'deepseek/deepseek-chat',
        label: 'OpenRouter (DeepSeek)',
      };
    }

    if (process.env.ANTHROPIC_API_KEY) {
      return {
        role: 'orchestrator',
        provider: 'anthropic',
        model: 'claude-3-7-sonnet-latest',
        label: 'Anthropic Claude',
      };
    }

    if (process.env.OPENAI_API_KEY) {
      return {
        role: 'orchestrator',
        provider: 'openai',
        model: 'gpt-4o',
        label: 'OpenAI (GPT-4o)',
      };
    }

    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return {
        role: 'orchestrator',
        provider: 'google',
        model: 'gemini-2.0-flash',
        label: 'Google Gemini',
      };
    }

    return {
      role: 'orchestrator',
      provider: 'ollama',
      model: 'llama3.2',
      label: 'Local Ollama',
      endpoint: 'http://localhost:11434',
    };
  }

  /**
   * Set the global default model.
   */
  setDefaultModel(provider: ProviderType, model: string, label?: string): RoleModelBinding {
    const binding: RoleModelBinding = {
      role: 'orchestrator',
      provider,
      model,
      label: label || `${provider}:${model}`,
    };
    this.core.settings.set(DEFAULT_MODEL_KEY, JSON.stringify(binding));
    return binding;
  }

  /**
   * Model overrides list (only populated if the user explicitly added an override).
   */
  getOverrides(): ModelOverride[] {
    const raw = this.core.settings.get(MODEL_OVERRIDES_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  addOverride(
    targetId: string,
    targetName: string,
    provider: ProviderType,
    model: string,
    label?: string,
  ): ModelOverride {
    const overrides = this.getOverrides();
    const id = targetId.toLowerCase().trim();
    const newOverride: ModelOverride = {
      id,
      targetName,
      provider,
      model,
      label: label || `${provider}:${model}`,
    };

    const existingIndex = overrides.findIndex((o) => o.id === id);
    if (existingIndex >= 0) {
      overrides[existingIndex] = newOverride;
    } else {
      overrides.push(newOverride);
    }

    this.core.settings.set(MODEL_OVERRIDES_KEY, JSON.stringify(overrides));
    return newOverride;
  }

  removeOverride(id: string): void {
    const overrides = this.getOverrides().filter((o) => o.id !== id.toLowerCase().trim());
    this.core.settings.set(MODEL_OVERRIDES_KEY, JSON.stringify(overrides));
  }

  /**
   * Get the active model binding for any bot role.
   * If an override exists for this role, return it.
   * Otherwise, return the Global Default Model!
   */
  getBinding(role: string): RoleModelBinding {
    const overrides = this.getOverrides();
    const match = overrides.find((o) => o.id === role.toLowerCase());
    if (match) {
      return {
        role: role as AgentRole,
        provider: match.provider,
        model: match.model,
        label: match.label,
      };
    }

    // Fall back directly to the global default model
    const def = this.getDefaultModel();
    return {
      ...def,
      role: role as AgentRole,
    };
  }

  /**
   * Backwards-compatible bindings map for all roles.
   */
  getAllBindings(): Record<string, RoleModelBinding> {
    const def = this.getDefaultModel();
    const result: Record<string, RoleModelBinding> = {
      orchestrator: this.getBinding('orchestrator'),
      coder: this.getBinding('coder'),
      researcher: this.getBinding('researcher'),
      reviewer: this.getBinding('reviewer'),
    };

    const overrides = this.getOverrides();
    overrides.forEach((o) => {
      result[o.id] = {
        role: o.id as AgentRole,
        provider: o.provider,
        model: o.model,
        label: o.label,
      };
    });

    return result;
  }
}
