import type { KnotsCore } from './index.js';
import type { Strand } from '@knots/types';

/**
 * Build the per-strand keychain/credential reference key (`strand:<name>`).
 */
export function getStrandApiKeyRef(strandName: string): string {
  return `strand:${strandName}`;
}

/**
 * Resolve an API key from standard environment variables for a provider type.
 */
export function resolveEnvApiKey(provider: string): string | undefined {
  const p = provider.toLowerCase();
  if (p === 'openai' && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY.trim();
  }
  if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY.trim();
  }
  if (p === 'google') {
    const googleKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (googleKey) return googleKey.trim();
  }
  if (p === 'openrouter' && process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY.trim();
  }
  return undefined;
}

/**
 * Return the primary environment variable name(s) for a provider type.
 */
export function getProviderEnvVarName(provider: string): string | undefined {
  switch (provider.toLowerCase()) {
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'google':
      return 'GEMINI_API_KEY / GOOGLE_API_KEY';
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    default:
      return undefined;
  }
}

/**
 * Retrieve or resolve API key for a provider or specific strand.
 * Resolution order:
 *  1. Per-strand credential reference (`apiKeyRef`, e.g. `strand:<name>`)
 *  2. Provider-level stored credential (for named cloud providers: openai, anthropic, google, openrouter)
 *  3. Environment variable fallback (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `OPENROUTER_API_KEY`)
 */
export async function resolveApiKey(
  provider: string,
  core: KnotsCore,
  apiKeyRef?: string,
): Promise<string | undefined> {
  // 1. Per-strand API key reference (allows independent keys per strand)
  if (apiKeyRef && apiKeyRef.trim().length > 0) {
    const strandKey = await core.credentials.getApiKey(apiKeyRef.trim());
    if (strandKey && strandKey.trim().length > 0) {
      return strandKey.trim();
    }
  }

  // 2. Provider-level credential fallback (avoid sharing across independent openai-compatible endpoints)
  const p = provider.toLowerCase();
  if (p !== 'ollama' && p !== 'openai-compatible') {
    const storedKey = await core.credentials.getApiKey(p);
    if (storedKey && storedKey.trim().length > 0) {
      return storedKey.trim();
    }
  }

  // 3. Environment variable fallback
  return resolveEnvApiKey(p);
}

export function resolveDefaultStrand(
  core: KnotsCore,
  knotLanes?: Record<string, string[]>,
): Strand {
  const globalLane = core.lanes.getByName('default');
  for (const name of [...(knotLanes?.default ?? []), ...(globalLane?.strand_order ?? [])]) {
    const strand = core.strands.getByName(name);
    if (strand) return strand;
  }

  const strands = core.strands.getAll();
  const strand = strands.find((item) => item.is_default) ?? strands[0];
  if (!strand) throw new Error('No strands configured. Add a model connection first.');
  return strand;
}
