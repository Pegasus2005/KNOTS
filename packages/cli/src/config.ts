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
 * Retrieve or resolve API key for a provider.
 * Looks first in CredentialManager (keychain or encrypted file fallback),
 * then falls back to environment variables.
 */
export async function resolveApiKey(provider: string, core: KnotsCore): Promise<string | undefined> {
  const storedKey = await core.credentials.getApiKey(provider);
  if (storedKey && storedKey.trim().length > 0) {
    return storedKey.trim();
  }

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

  return undefined;
}

/**
 * Instantiate a configured ModelProvider adapter for a given Strand.
 */
export async function getProviderForStrand(strand: Strand, context?: CliContext): Promise<ModelProvider> {
  const ctx = context ?? getCliContext();
  const apiKey = await resolveApiKey(strand.provider, ctx.core);

  return ctx.registry.createProvider(strand.provider, {
    endpoint: strand.endpoint,
    api_key: apiKey,
    default_model: strand.model,
  });
}
