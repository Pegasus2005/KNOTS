import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createCore, type KnotsCore } from '@knots/core';
import { ProviderRegistry, createDefaultRegistry, type ModelProvider } from '@knots/providers';
import type { Strand } from '@knots/types';

export interface CliContext {
  core: KnotsCore;
  registry: ProviderRegistry;
  dataDir: string;
}

let _context: CliContext | null = null;

/**
 * Resolve the KNOTS data directory (~/.knots on both Windows and POSIX).
 */
export function resolveDataDir(): string {
  const envDir = process.env.KNOTS_DATA_DIR;
  if (envDir && envDir.trim().length > 0) {
    return path.resolve(envDir.trim());
  }
  return path.join(os.homedir(), '.knots');
}

/**
 * Initialize and get the CLI context (core, provider registry, data dir).
 */
export function getCliContext(): CliContext {
  if (!_context) {
    const dataDir = resolveDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const core = createCore(dataDir);
    const registry = createDefaultRegistry();

    _context = {
      core,
      registry,
      dataDir,
    };
  }

  return _context;
}

/**
 * Close the shared CLI context and release database resources.
 */
export function closeCliContext(): void {
  if (_context) {
    _context.core.close();
    _context = null;
  }
}

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

/**
 * Instantiate a configured ModelProvider adapter for a given Strand.
 */
export async function getProviderForStrand(strand: Strand, context?: CliContext): Promise<ModelProvider> {
  const ctx = context ?? getCliContext();
  const apiKey = await resolveApiKey(strand.provider, ctx.core, strand.api_key_ref);

  return ctx.registry.createFromStrand(strand, {
    endpoint: strand.endpoint,
    api_key: apiKey,
    default_model: strand.model,
  });
}
