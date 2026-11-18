import { Command } from 'commander';
import chalk from 'chalk';
import type { ProviderType } from '@knots/types';
import { getModelCapabilities } from '@knots/providers';
import { getCliContext, getProviderForStrand } from '../config.js';
import { createSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';
import { promptInput, promptPassword, promptSelect, promptConfirm } from '../ui/prompt.js';

export function registerStrandCommands(program: Command): void {
  const strand = program.command('strand').description('Manage model connections (strands)');

  // knots strand add
  strand
    .command('add')
    .description('Configure a new model connection interactively')
    .action(async () => {
      try {
        const ctx = getCliContext();

        // 1. Pick provider
        const provider = await promptSelect<ProviderType>('Select provider type:', [
          { name: 'Ollama (Local models)', value: 'ollama' },
          { name: 'OpenAI (GPT-4o, o1, etc.)', value: 'openai' },
          { name: 'Anthropic (Claude 3.5, etc.)', value: 'anthropic' },
          { name: 'Google (Gemini 2.0 / 2.5)', value: 'google' },
        ]);

        // 2. Strand name
        const defaultName = `${provider}-strand`;
        const name = await promptInput('Enter strand name:', defaultName, (val) => {
          if (!val || val.trim().length === 0) return 'Name cannot be empty';
          if (ctx.core.strands.getByName(val.trim())) return `Strand "${val}" already exists`;
          return true;
        });

        let endpoint: string | undefined;
        let apiKey: string | undefined;

        // 3. Endpoint / Credentials
        if (provider === 'ollama') {
          endpoint = await promptInput('Enter Ollama endpoint:', 'http://localhost:11434');
        } else {
          const existingKey = await ctx.core.credentials.getApiKey(provider);
          if (existingKey) {
            const keep = await promptConfirm(`Saved API key found for ${provider}. Use saved key?`, true);
            if (keep) {
              apiKey = existingKey;
            } else {
              apiKey = await promptPassword(`Enter new API key for ${provider}:`, (v) =>
                v.length > 0 ? true : 'API key is required',
              );
              await ctx.core.credentials.setApiKey(provider, apiKey);
            }
          } else {
            apiKey = await promptPassword(`Enter API key for ${provider}:`, (v) =>
              v.length > 0 ? true : 'API key is required',
            );
            await ctx.core.credentials.setApiKey(provider, apiKey);
          }
        }

        // Temporary provider to test & list models
        const tempProvider = ctx.registry.createProvider(provider, {
          endpoint,
          api_key: apiKey,
        });

        // 4. Select model
        const spinner = createSpinner('Fetching available models...').start();
        let selectedModel = '';

        try {
          const models = await tempProvider.listModels();
          spinner.stop();

          if (models.length > 0) {
            const modelChoices = models.map((m) => ({
              name: `${m.name ?? m.id} ${m.description ? chalk.dim(`(${m.description})`) : ''}`,
              value: m.id,
            }));
            modelChoices.push({ name: 'Custom model name...', value: '__custom__' });

            const picked = await promptSelect('Select model:', modelChoices);
            if (picked === '__custom__') {
              selectedModel = await promptInput('Enter model identifier:', '');
            } else {
              selectedModel = picked;
            }
          } else {
            selectedModel = await promptInput('Enter model identifier:');
          }
        } catch {
          spinner.stop();
          const fallbackDefault =
            provider === 'ollama'
              ? 'llama3'
              : provider === 'openai'
                ? 'gpt-4o'
                : provider === 'anthropic'
                  ? 'claude-3-5-sonnet-20241022'
                  : 'gemini-2.0-flash';
          selectedModel = await promptInput('Enter model identifier:', fallbackDefault);
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

        // 6. Detect capabilities
        const capabilities = getModelCapabilities(provider, selectedModel);

        // 7. Save strand
        const isLocal = provider === 'ollama';
        ctx.core.strands.create({
          name,
          provider,
          model: selectedModel,
          endpoint,
          capabilities,
          is_local: isLocal,
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
          name: chalk.bold.cyan(s.name),
          provider: s.provider,
          model: chalk.magenta(s.model),
          type: s.is_local ? chalk.green('Local') : chalk.blue('Cloud'),
          endpoint: s.endpoint || chalk.dim('default'),
          capabilities: chalk.dim(s.capabilities.slice(0, 3).join(', ') + (s.capabilities.length > 3 ? '...' : '')),
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

        const spinner = createSpinner(`Testing connection to "${name}" (${strandObj.provider}:${strandObj.model})...`).start();
        const provider = await getProviderForStrand(strandObj, ctx);

        const startTime = Date.now();
        const result = await provider.testConnection();
        const latency = result.latency_ms ?? (Date.now() - startTime);

        if (result.success) {
          spinner.succeed(`Connection successful to "${name}"! Latency: ${chalk.bold.green(`${latency}ms`)}`);
        } else {
          spinner.fail(`Connection to "${name}" failed: ${result.error ?? 'Unknown error'}`);
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
