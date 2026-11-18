import * as path from 'node:path';
import * as fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import type { KnotSpec, ModelCapability, ModelPreferences, PrivacyLevel } from '@knots/types';
import { loadKnot, validateKnotSpec, KnotLoadError } from '@knots/core';
import { getCliContext } from '../config.js';
import { renderTable } from '../ui/table.js';
import { promptInput, promptSelect, promptCheckbox, promptConfirm } from '../ui/prompt.js';

export function registerKnotCommands(program: Command): void {
  // knots list
  program
    .command('list')
    .description('List all knots in the library')
    .action(async () => {
      try {
        const ctx = getCliContext();
        const loadedKnots = ctx.core.knots.listLoaded();

        const rows = loadedKnots.map((k) => ({
          name: chalk.bold.cyan(k.spec.name),
          display: k.spec.display_name || chalk.dim('—'),
          description: k.spec.description
            ? k.spec.description.length > 50
              ? `${k.spec.description.slice(0, 47)}...`
              : k.spec.description
            : chalk.dim('—'),
          privacy: k.spec.model_preferences?.privacy
            ? chalk.magenta(k.spec.model_preferences.privacy)
            : chalk.dim('any'),
          tags: k.spec.tags && k.spec.tags.length > 0 ? chalk.dim(k.spec.tags.join(', ')) : chalk.dim('—'),
          version: chalk.gray(k.spec.version || '0.1.0'),
        }));

        renderTable({
          columns: [
            { key: 'name', header: 'Knot Name' },
            { key: 'display', header: 'Display Name' },
            { key: 'description', header: 'Description' },
            { key: 'privacy', header: 'Privacy' },
            { key: 'tags', header: 'Tags' },
            { key: 'version', header: 'Version', align: 'right' },
          ],
          rows,
          emptyMessage: 'No knots found in library. Use "knots create" to create one.',
        });
      } catch (err) {
        console.error(chalk.red(`Error listing knots: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots show <name>
  program
    .command('show <name>')
    .description("Show a knot's full definition")
    .action(async (name: string) => {
      try {
        const ctx = getCliContext();
        const loaded = ctx.core.knots.get(name);

        if (!loaded) {
          console.error(chalk.red(`Knot "${name}" not found in library.`));
          process.exitCode = 1;
          return;
        }

        const spec = loaded.spec;
        console.log(`\n${chalk.bold.cyan(spec.display_name || spec.name)} ${chalk.dim(`(v${spec.version})`)}`);
        console.log(chalk.gray('─'.repeat(60)));
        console.log(`${chalk.bold('Identifier:')}  ${spec.name}`);
        if (spec.description) {
          console.log(`${chalk.bold('Description:')} ${spec.description}`);
        }
        if (spec.tags && spec.tags.length > 0) {
          console.log(`${chalk.bold('Tags:')}        ${spec.tags.join(', ')}`);
        }

        if (spec.model_preferences) {
          console.log(`\n${chalk.bold.yellow('Model Preferences:')}`);
          if (spec.model_preferences.privacy) {
            console.log(`  Privacy:      ${spec.model_preferences.privacy}`);
          }
          if (spec.model_preferences.preferred_provider) {
            console.log(`  Provider:     ${spec.model_preferences.preferred_provider}`);
          }
          if (spec.model_preferences.preferred_model) {
            console.log(`  Model:        ${spec.model_preferences.preferred_model}`);
          }
          if (spec.model_preferences.max_cost_per_run !== undefined) {
            console.log(`  Max Cost:     $${spec.model_preferences.max_cost_per_run}`);
          }
          if (spec.model_preferences.preferred_capability?.length) {
            console.log(`  Capabilities: ${spec.model_preferences.preferred_capability.join(', ')}`);
          }
        }

        if (spec.lanes && Object.keys(spec.lanes).length > 0) {
          console.log(`\n${chalk.bold.yellow('Configured Lanes:')}`);
          for (const [laneName, strandList] of Object.entries(spec.lanes)) {
            console.log(`  ${chalk.cyan(laneName)}: ${strandList.join(' → ')}`);
          }
        }

        if (spec.rules && spec.rules.length > 0) {
          console.log(`\n${chalk.bold.yellow('Policy Rules:')}`);
          for (const rule of spec.rules) {
            const reason = rule.reason ? chalk.dim(` (${rule.reason})`) : '';
            console.log(`  ${rule.type.toUpperCase()} ${rule.scope}: ${rule.value}${reason}`);
          }
        }

        console.log(`\n${chalk.bold.green('Instructions / System Prompt:')}`);
        console.log(chalk.dim('┌' + '─'.repeat(58) + '┐'));
        const lines = spec.instructions.split('\n');
        for (const line of lines) {
          console.log(chalk.dim('│ ') + line);
        }
        console.log(chalk.dim('└' + '─'.repeat(58) + '┘'));

        if (loaded.meta?.filePath) {
          console.log(`\n${chalk.dim(`File location: ${loaded.meta.filePath}`)}`);
        }
      } catch (err) {
        console.error(chalk.red(`Error showing knot: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots create
  program
    .command('create')
    .description('Interactive knot creation wizard')
    .action(async () => {
      try {
        const ctx = getCliContext();

        console.log(chalk.bold.cyan('\n=== Create New Knot ===\n'));

        // 1. Name
        const name = await promptInput('Knot identifier (kebab-case):', undefined, (val) => {
          const trimmed = val.trim();
          if (trimmed.length === 0) return 'Identifier is required';
          if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) {
            return 'Must be lowercase kebab-case (e.g. code-reviewer, writer-bot)';
          }
          if (ctx.core.knots.get(trimmed)) {
            return `A knot named "${trimmed}" already exists`;
          }
          return true;
        });

        // 2. Display Name
        const displayName = await promptInput('Display name (human-friendly):', name);

        // 3. Description
        const description = await promptInput('Description:');

        // 4. Instructions
        const instructions = await promptInput('System prompt / instructions:', undefined, (val) =>
          val.trim().length > 0 ? true : 'Instructions cannot be empty',
        );

        // 5. Model preferences: Privacy
        const privacy = await promptSelect<PrivacyLevel>('Privacy preference:', [
          { name: 'Local preferred (try local models, fallback to cloud)', value: 'local_preferred' },
          { name: 'Local only (never use cloud APIs)', value: 'local_only' },
          { name: 'Cloud allowed (any model)', value: 'cloud_allowed' },
          { name: 'Any (no preference)', value: 'any' },
        ]);

        // 6. Capabilities
        const preferredCapabilities = await promptCheckbox<ModelCapability>(
          'Preferred capabilities (select all that apply):',
          [
            { name: 'Long context', value: 'long_context' },
            { name: 'Structured output', value: 'structured_output' },
            { name: 'JSON mode', value: 'json_mode' },
            { name: 'Vision / multimodal', value: 'vision' },
            { name: 'Code execution / reasoning', value: 'code_execution' },
            { name: 'Tool / function calling', value: 'tool_calling' },
          ],
        );

        // 7. Lanes
        const existingLanes = ctx.core.lanes.getAll();
        const lanes: Record<string, string[]> = {};
        if (existingLanes.length > 0) {
          const assignLane = await promptConfirm('Assign a default lane to this knot?', true);
          if (assignLane) {
            const laneName = await promptSelect(
              'Select lane:',
              existingLanes.map((l) => ({ name: `${l.name} (${l.strand_order.join(' → ')})`, value: l.name })),
            );
            const foundLane = existingLanes.find((l) => l.name === laneName);
            if (foundLane) {
              lanes['default'] = foundLane.strand_order;
            }
          }
        }

        // 8. Tags
        const tagsStr = await promptInput('Tags (comma-separated, optional):');
        const tags = tagsStr
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

        // Build Spec cleanly (omit undefined optional fields so AJV schema validation succeeds)
        const modelPreferences: ModelPreferences = { privacy };
        if (preferredCapabilities.length > 0) {
          modelPreferences.preferred_capability = preferredCapabilities;
        }

        const now = new Date().toISOString();
        const spec: KnotSpec = {
          version: '0.1.0',
          name,
          display_name: displayName || name,
          description,
          instructions,
          model_preferences: modelPreferences,
          created_at: now,
          updated_at: now,
        };

        if (Object.keys(lanes).length > 0) {
          spec.lanes = lanes;
        }
        if (tags.length > 0) {
          spec.tags = tags;
        }

        // Validate
        const validation = validateKnotSpec(spec);
        if (!validation.valid) {
          console.error(chalk.red('\nValidation failed:'));
          for (const err of validation.errors) {
            console.error(chalk.red(`  • ${err}`));
          }
          process.exitCode = 1;
          return;
        }

        // Save
        ctx.core.knots.save(spec);
        console.log(chalk.bold.green(`\n✔ Knot "${name}" created and saved to library!`));
      } catch (err) {
        console.error(chalk.red(`Error creating knot: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots validate <path>
  program
    .command('validate <path>')
    .description('Validate a knot YAML definition file')
    .action(async (filePath: string) => {
      try {
        const absPath = path.resolve(filePath);
        if (!fs.existsSync(absPath)) {
          console.error(chalk.red(`File not found: ${absPath}`));
          process.exitCode = 1;
          return;
        }

        try {
          const loaded = loadKnot(absPath);
          console.log(chalk.bold.green(`✔ Knot "${loaded.spec.name}" in ${filePath} is valid!`));
          console.log(chalk.dim(`  Version: ${loaded.spec.version}`));
          console.log(chalk.dim(`  Display Name: ${loaded.spec.display_name || loaded.spec.name}`));
          if (loaded.spec.instructions) {
            console.log(chalk.dim(`  Instructions: ${loaded.spec.instructions.length} characters`));
          }
        } catch (err) {
          if (err instanceof KnotLoadError && err.validationErrors && err.validationErrors.length > 0) {
            console.error(chalk.bold.red(`✖ Knot validation failed for ${filePath}:`));
            for (const vErr of err.validationErrors) {
              console.error(chalk.red(`  • ${vErr}`));
            }
          } else {
            console.error(chalk.red(`✖ Validation error: ${(err as Error).message}`));
          }
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red(`Error validating knot: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
