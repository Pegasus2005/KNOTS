import { Command } from 'commander';
import chalk from 'chalk';
import type { TokenUsage, Strand } from '@knots/types';
import type { LoadedKnot } from '@knots/core';
import { getCliContext, getProviderForStrand, type CliContext } from '../config.js';
import { createSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';
import { promptInput } from '../ui/prompt.js';

export interface StrandComparisonResult {
  strand: Strand;
  model: string;
  output: string;
  durationMs: number;
  tokens?: TokenUsage;
  error?: string;
}

/**
 * Execute a prompt across multiple strands in parallel.
 */
export async function compareStrandsParallel(
  loadedKnot: LoadedKnot,
  input: string,
  context?: CliContext,
): Promise<StrandComparisonResult[]> {
  const ctx = context ?? getCliContext();
  const strands = ctx.core.strands.getAll();

  if (strands.length === 0) {
    throw new Error('No strands configured. Run "knots strand add" to configure strands before comparing.');
  }

  const spinner = createSpinner(`Comparing prompt across ${strands.length} strand(s) in parallel...`).start();

  const promises = strands.map(async (strand): Promise<StrandComparisonResult> => {
    const startTime = Date.now();
    try {
      const provider = await getProviderForStrand(strand, ctx);
      const res = await provider.sendMessageSync({
        messages: [{ role: 'user', content: input }],
        system: loadedKnot.spec.instructions,
        model: strand.model,
      });

      return {
        strand,
        model: res.model || strand.model,
        output: res.content,
        durationMs: Date.now() - startTime,
        tokens: res.usage,
      };
    } catch (err) {
      return {
        strand,
        model: strand.model,
        output: '',
        durationMs: Date.now() - startTime,
        error: (err as Error).message,
      };
    }
  });

  const results = await Promise.all(promises);
  spinner.stop();

  renderComparisonOutput(results, input);
  return results;
}

/**
 * Render comparison results side-by-side with metrics table and output cards.
 */
function renderComparisonOutput(results: StrandComparisonResult[], prompt: string): void {
  console.log(chalk.bold.cyan('\n=== Model Comparison Results ==='));
  console.log(chalk.dim(`Prompt: "${prompt}"\n`));

  // 1. Comparison Metrics Summary Table
  const tableRows = results.map((r) => ({
    strand: chalk.bold.cyan(r.strand.name),
    provider: r.strand.provider,
    model: chalk.magenta(r.model),
    latency: r.error ? chalk.red('Failed') : chalk.green(`${r.durationMs}ms`),
    tokensIn: r.tokens ? String(r.tokens.prompt_tokens) : chalk.dim('—'),
    tokensOut: r.tokens ? String(r.tokens.completion_tokens) : chalk.dim('—'),
    status: r.error ? chalk.red('Error') : chalk.green('Success'),
  }));

  renderTable({
    columns: [
      { key: 'strand', header: 'Strand' },
      { key: 'provider', header: 'Provider' },
      { key: 'model', header: 'Model' },
      { key: 'latency', header: 'Latency', align: 'right' },
      { key: 'tokensIn', header: 'Tokens In', align: 'right' },
      { key: 'tokensOut', header: 'Tokens Out', align: 'right' },
      { key: 'status', header: 'Status' },
    ],
    rows: tableRows,
  });

  // 2. Side-by-side or Panel Outputs
  console.log(chalk.bold.yellow('\n--- Outputs by Strand ---'));
  for (const r of results) {
    const header = `[ ${r.strand.name} • ${r.model} • ${r.durationMs}ms ]`;
    console.log('\n' + chalk.cyan('┌' + '─'.repeat(Math.max(60, header.length + 4)) + '┐'));
    console.log(chalk.cyan('│ ') + chalk.bold.white(header));
    console.log(chalk.cyan('├' + '─'.repeat(Math.max(60, header.length + 4)) + '┤'));

    if (r.error) {
      console.log(chalk.cyan('│ ') + chalk.red(`Error: ${r.error}`));
    } else {
      const lines = r.output.split('\n');
      for (const line of lines) {
        console.log(chalk.cyan('│ ') + line);
      }
    }
    console.log(chalk.cyan('└' + '─'.repeat(Math.max(60, header.length + 4)) + '┘'));
  }
}

export function registerCompareCommand(program: Command): void {
  program
    .command('compare <knot-name>')
    .description('Run the same prompt across all configured strands in parallel and compare outputs')
    .option('-i, --input <text>', 'The input prompt to compare')
    .action(async (knotName: string, options: { input?: string }) => {
      try {
        const ctx = getCliContext();
        const loadedKnot = ctx.core.knots.get(knotName);

        if (!loadedKnot) {
          console.error(chalk.red(`Knot "${knotName}" not found in library.`));
          process.exitCode = 1;
          return;
        }

        let input = options.input;
        if (!input) {
          input = await promptInput(`Enter prompt to compare across strands for ${loadedKnot.spec.display_name || knotName}:`);
        }

        if (!input || input.trim().length === 0) {
          console.error(chalk.red('Error: Comparison prompt cannot be empty.'));
          process.exitCode = 1;
          return;
        }

        await compareStrandsParallel(loadedKnot, input, ctx);
      } catch (err) {
        console.error(chalk.red(`Error comparing strands: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
