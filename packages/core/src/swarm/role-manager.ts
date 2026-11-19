import type { KnotsCore } from '../index.js';
import type { AgentRole, RoleModelBinding, ProviderType } from '@knots/types';

const SETTINGS_PREFIX = 'role_binding:';

export const DEFAULT_ROLES: AgentRole[] = ['orchestrator', 'coder', 'researcher', 'reviewer'];

export class RoleManager {
  constructor(private core: KnotsCore) {}

  /**
   * Get the configured model binding for a role, or smart fallback.
   */
  getBinding(role: AgentRole): RoleModelBinding {
    const raw = this.core.settings.get(`${SETTINGS_PREFIX}${role}`);
    if (raw) {
      try {
        return JSON.parse(raw) as RoleModelBinding;
      } catch {
        // Fall back below
      }
    }

    // Smart default based on available strands or environment
    return this.getDefaultBinding(role);
  }

  /**
   * Save a model binding for a specific role.
   */
  setBinding(role: AgentRole, binding: RoleModelBinding): void {
    this.core.settings.set(`${SETTINGS_PREFIX}${role}`, JSON.stringify(binding));
  }

  /**
   * Return all 4 role bindings.
   */
  getAllBindings(): Record<AgentRole, RoleModelBinding> {
    return {
      orchestrator: this.getBinding('orchestrator'),
      coder: this.getBinding('coder'),
      researcher: this.getBinding('researcher'),
      reviewer: this.getBinding('reviewer'),
      custom: this.getBinding('custom'),
    };
  }

  /**
   * Provide an intelligent default if none is configured yet.
   */
  private getDefaultBinding(role: AgentRole): RoleModelBinding {
    // If strands exist in DB, pick the best strand
    const strands = this.core.strands.getAll();
    if (strands.length > 0) {
      // Look for a strand matching the role name or default
      const defaultStrand = strands.find(s => s.is_default) || strands[0];
      return {
        role,
        provider: defaultStrand.provider,
        model: defaultStrand.model,
        label: defaultStrand.name,
        endpoint: defaultStrand.endpoint,
      };
    }

    // Otherwise sensible presets depending on provider availability
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        role,
        provider: 'anthropic',
        model: role === 'researcher' ? 'claude-3-5-haiku-latest' : 'claude-3-7-sonnet-latest',
        label: role === 'researcher' ? 'Claude 3.5 Haiku' : 'Claude 3.7 Sonnet',
      };
    }

    if (process.env.OPENAI_API_KEY) {
      return {
        role,
        provider: 'openai',
        model: role === 'researcher' ? 'gpt-4o-mini' : 'gpt-4o',
        label: role === 'researcher' ? 'GPT-4o Mini' : 'GPT-4o',
      };
    }

    if (process.env.OPENROUTER_API_KEY) {
      return {
        role,
        provider: 'openrouter',
        model: role === 'researcher' ? 'google/gemini-2.0-flash-001' : 'anthropic/claude-3.7-sonnet',
        label: role === 'researcher' ? 'Gemini 2.0 Flash (OpenRouter)' : 'Claude 3.7 Sonnet (OpenRouter)',
      };
    }

    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return {
        role,
        provider: 'google',
        model: role === 'researcher' ? 'gemini-2.0-flash' : 'gemini-2.5-pro',
        label: role === 'researcher' ? 'Gemini 2.0 Flash' : 'Gemini 2.5 Pro',
      };
    }

    // Default to local Ollama
    return {
      role,
      provider: 'ollama',
      model: role === 'researcher' ? 'mistral' : 'llama3.2',
      label: role === 'researcher' ? 'Mistral (Ollama)' : 'Llama 3.2 (Ollama)',
      endpoint: 'http://localhost:11434',
    };
  }
}

