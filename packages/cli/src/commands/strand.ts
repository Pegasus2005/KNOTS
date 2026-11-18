import { Command } from 'commander';
import chalk from 'chalk';
import type { ModelInfo, ProviderType } from '@knots/types';
import {
  OpenRouterAdapter,
  OPENROUTER_DEFAULT_BASE_URL,
  getModelCapabilities,
  listKnownModels,
} from '@knots/providers';
import {
  getCliContext,
  getProviderForStrand,
  getStrandApiKeyRef,
  getProviderEnvVarName,
  resolveEnvApiKey,
} from '../config.js';
import { createSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';
import { promptInput, promptPassword, promptSelect, promptConfirm } from '../ui/prompt.js';

const FALLBACK_DEFAULT_MODELS: Record<ProviderType, string> = {
  ollama: 'llama3',
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.5-flash',
  openrouter: 'openai/gpt-4o',
  'openai-compatible': '',
};

/**
 * Determine whether a custom endpoint URL points to a local / private-network host.
 */
function isLocalEndpoint(endpoint?: string): boolean {
  if (!endpoint) return false;
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.')
    );
  } catch {
    return false;
  }
}

/**
 * Format provider type cleanly for table output.
 */
function formatProviderBadge(provider: ProviderType): string {
  switch (provider) {
    case 'ollama':
      return chalk.green('ollama');
    case 'openai':
      return chalk.cyan('openai');
    case 'anthropic':
      return chalk.yellow('anthropic');
    case 'google':
      return chalk.blue('google');
    case 'openrouter':
      return chalk.magenta('openrouter');
    case 'openai-compatible':
      return chalk.white('openai-compatible');
    default:
      return provider;
  }
}

/**
 * Interactive model picker with filtering for large catalogs like OpenRouter (500+ models).
 */
async function pickOpenRouterModel(models: ModelInfo[]): Promise<string> {
  const MAX_DISPLAY = 40;

  while (true) {
    const query = await promptInput(
      `Filter OpenRouter models (${models.length} available, e.g. "claude", "gpt-4", "gemini", or blank for top ${MAX_DISPLAY}):`,
      '',
    );

    const needle = query.toLowerCase();
    const filtered = needle
      ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(needle) ||
          (m.name && m.name.toLowerCase().includes(needle)),
      )
      : models;

    if (filtered.length === 0) {
      const action = await promptSelect<'retry' | 'manual'>(
        `No models matched "${query}". What would you like to do?`,
        [
          { name: 'Try another filter', value: 'retry' },
          { name: 'Enter model identifier manually', value: 'manual' },
        ],
      );
      if (action === 'manual') {
        return promptInput('Enter OpenRouter model identifier (e.g. openai/gpt-4o):', 'openai/gpt-4o', (v) =>
          v.trim().length > 0 ? true : 'Model identifier cannot be empty',
        );
      }
      continue;
    }

    const shown = filtered.slice(0, MAX_DISPLAY);
    const choices: Array<{ name: string; value: string }> = shown.map((m) => {
      const ctxInfo = m.context_length ? chalk.dim(` [${Math.round(m.context_length / 1000)}k ctx]`) : '';
      const label = m.name && m.name !== m.id ? `${m.id} — ${chalk.dim(m.name)}${ctxInfo}` : `${m.id}${ctxInfo}`;
      return { name: label, value: m.id };
    });

    if (filtered.length > MAX_DISPLAY) {
      choices.push({
        name: chalk.yellow(`Filter again (${filtered.length - MAX_DISPLAY} more matches)...`),
        value: '__filter__',
      });
    } else if (needle) {
      choices.push({ name: chalk.yellow('Filter again...'), value: '__filter__' });
    }
    choices.push({ name: 'Custom model name...', value: '__custom__' });

    const picked = await promptSelect('Select OpenRouter model:', choices);
    if (picked === '__filter__') {
      continue;
    }
    if (picked === '__custom__') {
      return promptInput('Enter OpenRouter model identifier (e.g. anthropic/claude-3.5-sonnet):', 'openai/gpt-4o', (v) =>
        v.trim().length > 0 ? true : 'Model identifier cannot be empty',
      );
    }
    return picked;
  }
}

/**
 * Resolve and store API key for cloud providers (`openai`, `anthropic`, `google`, `openrouter`).
 * Stores per-strand key under `strand:<name>` (`api_key_ref`) when saved so multiple strands
 * can hold independent keys without overwriting each other.
 */
async function promptCloudApiKey(
  provider: ProviderType,
  strandName: string,
  credentials: {
    getApiKey(key: string): Promise<string | null>;
    setApiKey(key: string, apiKey: string): Promise<void>;
  },
): Promise<{ apiKey: string; apiKeyRef?: string }> {
  const envKey = resolveEnvApiKey(provider);
  const envVarName = getProviderEnvVarName(provider);
  const existingProviderKey = await credentials.getApiKey(provider);
  const strandKeyRef = getStrandApiKeyRef(strandName);

  const keyOptions: Array<{ name: string; value: 'new' | 'saved' | 'env' }> = [];
  if (envKey && envVarName) {
    keyOptions.push({ name: `Use environment variable (${envVarName})`, value: 'env' });
  }
  if (existingProviderKey) {
    keyOptions.push({ name: `Reuse saved ${provider} API key (copied to this strand)`, value: 'saved' });
  }
  keyOptions.push({ name: `Enter a dedicated API key for "${strandName}"`, value: 'new' });

  let choice: 'new' | 'saved' | 'env' = 'new';
  if (keyOptions.length > 1) {
    choice = await promptSelect<'new' | 'saved' | 'env'>(`Select API key source for ${provider}:`, keyOptions);
  }

  if (choice === 'env' && envKey) {
    const saveToKeychain = await promptConfirm(
      `Save the key from ${envVarName} to secure storage for "${strandName}"? (No = read env at runtime)`,
      false,
    );
    if (saveToKeychain) {
      await credentials.setApiKey(strandKeyRef, envKey);
      return { apiKey: envKey, apiKeyRef: strandKeyRef };
    }
    return { apiKey: envKey, apiKeyRef: undefined };
  }

  if (choice === 'saved' && existingProviderKey) {
    await credentials.setApiKey(strandKeyRef, existingProviderKey);
    return { apiKey: existingProviderKey, apiKeyRef: strandKeyRef };
  }

  const enteredKey = await promptPassword(`Enter API key for ${provider} (${strandName}):`, (v) =>
    v.trim().length > 0 ? true : 'API key is required',
  );
  await credentials.setApiKey(strandKeyRef, enteredKey);
  return { apiKey: enteredKey, apiKeyRef: strandKeyRef };
}

export function registerStrandCommands(program: Command): void {
  const strand = program.command('strand').description('Manage model connections (strands)');

  // knots strand add
  strand
    .command('add')
    .description('Configure a new model connection interactively')
    .action(async () => {
      try {
        const ctx = getCliContext();

        // 1. Pick provider (all 6 supported provider types)
        const provider = await promptSelect<ProviderType>('Select provider type:', [
          { name: 'Ollama (Local models)', value: 'ollama' },
          { name: 'OpenAI (GPT-4o, o1, o3, etc.)', value: 'openai' },
          { name: 'Anthropic (Claude Sonnet 4, Claude 3.5, etc.)', value: 'anthropic' },
          { name: 'Google (Gemini 2.5, Gemini 2.0, etc.)', value: 'google' },
          { name: 'OpenRouter (500+ models via one API key)', value: 'openrouter' },
          { name: 'OpenAI-Compatible (LM Studio, vLLM, Groq, Together, Mistral, etc.)', value: 'openai-compatible' },
        ]);

        // 2. Strand name
        const defaultName = `${provider}-strand`;
        const name = await promptInput('Enter strand name:', defaultName, (val) => {
          const trimmed = val.trim();
          if (trimmed.length === 0) return 'Name cannot be empty';
          if (ctx.core.strands.getByName(trimmed)) return `Strand "${trimmed}" already exists`;
          return true;
        });

        let endpoint: string | undefined;
        let apiKey: string | undefined;
        let apiKeyRef: string | undefined;

        // 3. Endpoint & Credentials per provider type
        if (provider === 'ollama') {
          endpoint = await promptInput('Enter Ollama endpoint:', 'http://localhost:11434', (val) =>
            /^https?:\/\/.+/.test(val.trim()) ? true : 'Endpoint must be a valid http:// or https:// URL',
          );
        } else if (provider === 'openai-compatible') {
          endpoint = await promptInput(
            'Enter OpenAI-compatible base URL (e.g. http://localhost:1234/v1 or https://api.groq.com/openai/v1):',
            'http://localhost:1234/v1',
            (val) => (/^https?:\/\/.+/.test(val.trim()) ? true : 'Base URL must be a valid http:// or https:// URL'),
          );

          const optionalKey = await promptPassword(
            'Enter API key (optional — press Enter to skip for local servers):',
          );
          if (optionalKey.length > 0) {
            apiKey = optionalKey;
            apiKeyRef = getStrandApiKeyRef(name);
            await ctx.core.credentials.setApiKey(apiKeyRef, apiKey);
          }
        } else if (provider === 'openrouter') {
          const resolved = await promptCloudApiKey(provider, name, ctx.core.credentials);
          apiKey = resolved.apiKey;
          apiKeyRef = resolved.apiKeyRef;

          const customEndpoint = await promptInput(
            'Enter OpenRouter base URL (leave default for standard OpenRouter):',
            OPENROUTER_DEFAULT_BASE_URL,
            (val) => (/^https?:\/\/.+/.test(val.trim()) ? true : 'Base URL must be a valid http:// or https:// URL'),
          );
          if (customEndpoint !== OPENROUTER_DEFAULT_BASE_URL) {
            endpoint = customEndpoint;
          }
        } else {
          // openai, anthropic, google
          const resolved = await promptCloudApiKey(provider, name, ctx.core.credentials);
          apiKey = resolved.apiKey;
          apiKeyRef = resolved.apiKeyRef;
        }

        // Instantiate temporary provider adapter to list models & test connection
        const tempProvider =
          provider === 'openrouter'
            ? new OpenRouterAdapter({
              api_key: apiKey,
              endpoint,
            })
            : ctx.registry.createProvider(provider, {
              endpoint,
              api_key: apiKey,
            });

        // 4. Select model
        let selectedModel = '';

        if (provider === 'openrouter') {
          const spinner = createSpinner('Fetching OpenRouter model catalog...').start();
          try {
            const models = await tempProvider.listModels();
            spinner.stop();

            if (models.length > 0) {
              selectedModel = await pickOpenRouterModel(models);
            } else {
              selectedModel = await promptInput(
                'Enter OpenRouter model identifier:',
                FALLBACK_DEFAULT_MODELS.openrouter,
                (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
              );
            }
          } catch (err) {
            spinner.warn(`Could not fetch OpenRouter catalog: ${(err as Error).message}`);
            selectedModel = await promptInput(
              'Enter OpenRouter model identifier manually (e.g. openai/gpt-4o):',
              FALLBACK_DEFAULT_MODELS.openrouter,
              (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
            );
          }
        } else if (provider === 'openai-compatible') {
          const spinner = createSpinner(`Querying models at ${endpoint}...`).start();
          try {
            const models = await tempProvider.listModels();
            spinner.stop();

            if (models.length > 0) {
              const modelChoices = models.map((m) => ({
                name: m.name ?? m.id,
                value: m.id,
              }));
              modelChoices.push({ name: 'Custom model name...', value: '__custom__' });

              const picked = await promptSelect('Select model:', modelChoices);
              if (picked === '__custom__') {
                selectedModel = await promptInput('Enter model identifier:', '', (v) =>
                  v.trim().length > 0 ? true : 'Model identifier cannot be empty',
                );
              } else {
                selectedModel = picked;
              }
            } else {
              selectedModel = await promptInput('Enter model identifier:', '', (v) =>
                v.trim().length > 0 ? true : 'Model identifier cannot be empty',
              );
            }
          } catch {
            spinner.stop();
            selectedModel = await promptInput(
              'Enter model identifier (e.g. llama-3.3-70b-versatile, mistral-large-latest, local-model):',
              '',
              (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
            );
          }
        } else {
          // ollama, openai, anthropic, google
          const fetchLabel =
            provider === 'ollama'
              ? `Fetching installed Ollama models from ${endpoint}/api/tags...`
              : `Fetching available ${provider} models...`;
          const spinner = createSpinner(fetchLabel).start();

          try {
            const models = await tempProvider.listModels();
            spinner.stop();

            if (models.length > 0) {
              const modelChoices = models.map((m) => ({
                name: `${m.name ?? m.id}${m.description ? ` ${chalk.dim(`(${m.description})`)}` : ''}`,
                value: m.id,
              }));
              modelChoices.push({ name: 'Custom model name...', value: '__custom__' });

              const picked = await promptSelect('Select model:', modelChoices);
              if (picked === '__custom__') {
                selectedModel = await promptInput('Enter model identifier:', FALLBACK_DEFAULT_MODELS[provider], (v) =>
                  v.trim().length > 0 ? true : 'Model identifier cannot be empty',
                );
              } else {
                selectedModel = picked;
              }
            } else {
              selectedModel = await promptInput(
                'No models found. Enter model identifier manually:',
                FALLBACK_DEFAULT_MODELS[provider],
                (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
              );
            }
          } catch {
            spinner.stop();
            if (provider === 'ollama') {
              console.log(
                chalk.yellow('Could not reach Ollama at /api/tags (server may be offline). Falling back to manual entry.'),
              );
              selectedModel = await promptInput(
                'Enter Ollama model identifier:',
                FALLBACK_DEFAULT_MODELS.ollama,
                (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
              );
            } else {
              // Fall back to known model choices from @knots/providers capability DB + custom option
              const known = listKnownModels().filter((k) => k.provider === provider);
              if (known.length > 0) {
                const knownChoices = known.map((k) => ({ name: k.model, value: k.model }));
                knownChoices.push({ name: 'Custom model name...', value: '__custom__' });

                const picked = await promptSelect('Select known model:', knownChoices);
                if (picked === '__custom__') {
                  selectedModel = await promptInput(
                    'Enter model identifier:',
                    FALLBACK_DEFAULT_MODELS[provider],
                    (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
                  );
                } else {
                  selectedModel = picked;
                }
              } else {
                selectedModel = await promptInput(
                  'Enter model identifier:',
                  FALLBACK_DEFAULT_MODELS[provider],
                  (v) => (v.trim().length > 0 ? true : 'Model identifier cannot be empty'),
                );
              }
            }
          }
        }

        // 5. Test connection
        const testSpinner = createSpinner(`Testing connection to ${provider}:${selectedModel}...`).start();
        try {
          const result = await tempProvider.testConnection();
          if (result.success) {
            testSpinner.succeed(
              `Connection successful! ${result.latency_ms !== undefined ? chalk.dim(`(${result.latency_ms}ms)`) : ''}`,
            );
          } else {
            testSpinner.warn(`Connection test warning: ${result.error ?? 'Unknown error'}`);
          }
        } catch (err) {
          testSpinner.warn(`Connection test failed: ${(err as Error).message}`);
        }

        // 6. Detect capabilities (uses dynamic OpenRouter cache when fetched)
        const capabilities = tempProvider.getCapabilities(selectedModel) ?? getModelCapabilities(provider, selectedModel);

        // 7. Save strand
        const isLocal =
          provider === 'ollama' || (provider === 'openai-compatible' && isLocalEndpoint(endpoint));
        const existingCount = ctx.core.strands.getAll().length;

        ctx.core.strands.create({
          name,
          provider,
          model: selectedModel,
          endpoint,
          api_key_ref: apiKeyRef,
          capabilities,
          is_local: isLocal,
          is_default: existingCount === 0,
        });

        console.log(chalk.bold.green(`\n✔ Strand "${name}" added successfully!`));
      } catch (err) {
        console.error(chalk.red(`Error adding strand: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots strand list
  strand
    .command('list')
    .description('List all configured strands')
    .action(async () => {
      try {
        const ctx = getCliContext();
        const strands = ctx.core.strands.getAll();

        const rows = strands.map((s) => ({
          name: chalk.bold.cyan(s.name) + (s.is_default ? chalk.yellow(' ★') : ''),
          provider: formatProviderBadge(s.provider),
          model: chalk.magenta(s.model),
          type: s.is_local ? chalk.green('Local') : chalk.blue('Cloud'),
          endpoint: s.endpoint || chalk.dim('default'),
          capabilities: chalk.dim(
            s.capabilities.slice(0, 3).join(', ') + (s.capabilities.length > 3 ? '...' : ''),
          ),
        }));

        renderTable({
          columns: [
            { key: 'name', header: 'Strand Name' },
            { key: 'provider', header: 'Provider' },
            { key: 'model', header: 'Model' },
            { key: 'type', header: 'Type' },
            { key: 'endpoint', header: 'Endpoint' },
            { key: 'capabilities', header: 'Capabilities' },
          ],
          rows,
          emptyMessage: 'No strands configured. Use "knots strand add" to add one.',
        });
      } catch (err) {
        console.error(chalk.red(`Error listing strands: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots strand test <name>
  strand
    .command('test <name>')
    .description("Test a strand's connection and measure latency")
    .action(async (name: string) => {
      try {
        const ctx = getCliContext();
        const strandObj = ctx.core.strands.getByName(name);

        if (!strandObj) {
          console.error(chalk.red(`Strand "${name}" not found.`));
          process.exitCode = 1;
          return;
        }

        const spinner = createSpinner(
          `Testing connection to "${name}" (${strandObj.provider}:${strandObj.model})...`,
        ).start();

        try {
          const provider = await getProviderForStrand(strandObj, ctx);

          const startTime = Date.now();
          const result = await provider.testConnection();
          const latency = result.latency_ms ?? Date.now() - startTime;

          if (result.success) {
            spinner.succeed(`Connection successful to "${name}"! Latency: ${chalk.bold.green(`${latency}ms`)}`);
          } else {
            spinner.fail(`Connection to "${name}" failed: ${result.error ?? 'Unknown error'}`);
            process.exitCode = 1;
          }
        } catch (err) {
          spinner.fail(`Connection to "${name}" failed: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red(`Error testing strand: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots strand remove <name>
  strand
    .command('remove <name>')
    .description('Remove a configured strand')
    .action(async (name: string) => {
      try {
        const ctx = getCliContext();
        const strandObj = ctx.core.strands.getByName(name);

        if (!strandObj) {
          console.error(chalk.red(`Strand "${name}" not found.`));
          process.exitCode = 1;
          return;
        }

        ctx.core.strands.delete(strandObj.id);

        // Clean up per-strand API key if stored under strand:<name>
        if (strandObj.api_key_ref && strandObj.api_key_ref.startsWith('strand:')) {
          await ctx.core.credentials.deleteApiKey(strandObj.api_key_ref);
        }

        // Also clean up any lane referencing this strand
        const lanes = ctx.core.lanes.getAll();
        for (const lane of lanes) {
          if (lane.strand_order.includes(name)) {
            const updated = lane.strand_order.filter((s) => s !== name);
            ctx.core.lanes.update(lane.id, { strand_order: updated });
          }
        }

        console.log(chalk.green(`✔ Strand "${name}" removed.`));
      } catch (err) {
        console.error(chalk.red(`Error removing strand: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
