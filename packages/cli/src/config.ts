import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createCore, resolveApiKey, controlledProvider, type KnotsCore } from '@knots/core';
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

export {
  getStrandApiKeyRef,
  getProviderEnvVarName,
  resolveEnvApiKey,
  resolveApiKey,
} from '@knots/core';

/**
 * Instantiate a configured ModelProvider adapter for a given Strand.
 */
export async function getProviderForStrand(
  strand: Strand,
  context?: CliContext,
): Promise<ModelProvider> {
  const ctx = context ?? getCliContext();
  if (ctx.core.settings.get('worker_dispatch_enabled') === 'false')
    throw new Error(
      'Dispatch is stopped. Enable dispatch from the dashboard before running models.',
    );
  const apiKey = await resolveApiKey(strand.provider, ctx.core, strand.api_key_ref);

  return controlledProvider(
    ctx.core,
    ctx.registry.createFromStrand(strand, {
      endpoint: strand.endpoint,
      api_key: apiKey,
      default_model: strand.model,
    }),
  );
}
