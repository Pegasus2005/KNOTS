import type { KnotsCore } from '../index.js';
import type { AgentRole, RoleModelBinding, ProviderType } from '@knots/types';
import { detectProviderFromKey, type DetectedProviderInfo } from './key-detector.js';
import { resolveEnvApiKey } from '../connections.js';

const SETTINGS_PREFIX = 'role_binding:';
const CONNECTED_PROVIDERS_KEY = 'connected_providers';
const CUSTOM_SKILLS_KEY = 'custom_skills_list';

export const DEFAULT_ROLES: AgentRole[] = ['orchestrator', 'coder', 'researcher', 'reviewer'];

export interface CustomSkillDefinition {
  id: string;
  name: string;
  description?: string;
  binding: RoleModelBinding;
}

export class RoleManager {
  constructor(private core: KnotsCore) {}

  /**
   * Smart key addition: Paste ANY key, auto-detect the provider, save it,
   * and auto-wire default models for all roles.
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

    // 3. Auto-configure default role bindings for this provider
    this.setBinding('orchestrator', {
      role: 'orchestrator',
      provider: detected.provider,
      model: detected.recommendedRoles.orchestrator,
      label: `${detected.label} (${detected.recommendedRoles.orchestrator})`,
    });

    this.setBinding('coder', {
      role: 'coder',
      provider: detected.provider,
      model: detected.recommendedRoles.coder,
      label: `${detected.label} (${detected.recommendedRoles.coder})`,
    });

    this.setBinding('researcher', {
      role: 'researcher',
      provider: detected.provider,
      model: detected.recommendedRoles.researcher,
      label: `${detected.label} (${detected.recommendedRoles.researcher})`,
    });

    this.setBinding('reviewer', {
      role: 'reviewer',
      provider: detected.provider,
      model: detected.recommendedRoles.reviewer,
      label: `${detected.label} (${detected.recommendedRoles.reviewer})`,
    });

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

  async getConnectedProvidersDetails(): Promise<Array<{ provider: ProviderType; label: string; displayName: string; defaultModel: string; active: boolean }>> {
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
   * Get the configured model binding for a role, or smart fallback.
   */
  getBinding(role: string): RoleModelBinding {
    const raw = this.core.settings.get(`${SETTINGS_PREFIX}${role}`);
    if (raw) {
      try {
        return JSON.parse(raw) as RoleModelBinding;
      } catch {
        // Fall back below
      }
    }

    return this.getDefaultBinding(role as AgentRole);
  }

  /**
   * Save a model binding for a specific role.
   */
  setBinding(role: string, binding: RoleModelBinding): void {
    this.core.settings.set(`${SETTINGS_PREFIX}${role}`, JSON.stringify(binding));
  }

  /**
   * Return all 4 primary role bindings plus custom skills.
   */
  getAllBindings(): Record<string, RoleModelBinding> {
    const base: Record<string, RoleModelBinding> = {
      orchestrator: this.getBinding('orchestrator'),
      coder: this.getBinding('coder'),
      researcher: this.getBinding('researcher'),
      reviewer: this.getBinding('reviewer'),
    };

    // Add any custom skills
    const custom = this.getCustomSkills();
    custom.forEach((skill) => {
      base[skill.id] = skill.binding;
    });

    return base;
  }

  /**
   * Custom Skills Management (e.g. "Data Analyst", "DevOps", "Researcher")
   */
  getCustomSkills(): CustomSkillDefinition[] {
    const raw = this.core.settings.get(CUSTOM_SKILLS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  addCustomSkill(name: string, binding: RoleModelBinding, description?: string): CustomSkillDefinition {
    const skills = this.getCustomSkills();
    const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const newSkill: CustomSkillDefinition = { id, name, description, binding };
    
    const existingIndex = skills.findIndex((s) => s.id === id);
    if (existingIndex >= 0) {
      skills[existingIndex] = newSkill;
    } else {
      skills.push(newSkill);
    }

    this.core.settings.set(CUSTOM_SKILLS_KEY, JSON.stringify(skills));
    this.setBinding(id, binding);
    return newSkill;
  }

  removeCustomSkill(id: string): void {
    const skills = this.getCustomSkills().filter((s) => s.id !== id);
    this.core.settings.set(CUSTOM_SKILLS_KEY, JSON.stringify(skills));
  }

  private getDefaultBinding(role: AgentRole): RoleModelBinding {
    const strands = this.core.strands.getAll();
    if (strands.length > 0) {
      const defaultStrand = strands.find((s) => s.is_default) || strands[0];
      return {
        role,
        provider: defaultStrand.provider,
        model: defaultStrand.model,
        label: defaultStrand.name,
        endpoint: defaultStrand.endpoint,
      };
    }

    if (process.env.OPENROUTER_API_KEY) {
      return {
        role,
        provider: 'openrouter',
        model: role === 'researcher' ? 'google/gemini-2.0-flash-001' : 'anthropic/claude-3.7-sonnet',
        label: 'OpenRouter',
      };
    }

    if (process.env.ANTHROPIC_API_KEY) {
      return {
        role,
        provider: 'anthropic',
        model: role === 'researcher' ? 'claude-3-5-haiku-latest' : 'claude-3-7-sonnet-latest',
        label: 'Anthropic',
      };
    }

    if (process.env.OPENAI_API_KEY) {
      return {
        role,
        provider: 'openai',
        model: role === 'researcher' ? 'gpt-4o-mini' : 'gpt-4o',
        label: 'OpenAI',
      };
    }

    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return {
        role,
        provider: 'google',
        model: role === 'researcher' ? 'gemini-2.0-flash' : 'gemini-2.5-pro',
        label: 'Google Gemini',
      };
    }

    return {
      role,
      provider: 'ollama',
      model: role === 'researcher' ? 'mistral' : 'llama3.2',
      label: 'Local Ollama',
      endpoint: 'http://localhost:11434',
    };
  }
}
