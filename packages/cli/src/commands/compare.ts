import { knotSystemPrompt, type LoadedKnot } from '@knots/core';
import { Command } from 'commander';
import chalk from 'chalk';
import type { TokenUsage, Strand } from '@knots/types';
import { getCliContext, getProviderForStrand, type CliContext } from '../config.js';
import { createSpinner } from '../ui/spinner.js';
import { renderTable } from '../ui/table.js';
import { promptInput } from '../ui/prompt.js';

export interface StrandComparisonResult {
  runId: string;
  strand: Strand;
  model: string;
  output: string;
  durationMs: number;
  tokens?: TokenUsage;
  error?: string;
}

/**
 * Execute a prompt across multiple strands in parallel and persist each run in RunManager/RunStore.
 */
export async function compareStrandsParallel(
  loadedKnot: LoadedKnot,
  input: string,
  context?: CliContext,
  strandNames?: string[],
): Promise<StrandComparisonResult[]> {
  const ctx = context ?? getCliContext();
  let strands: Strand[];

  if (strandNames && strandNames.length > 0) {
    strands = [];
    for (const name of strandNames) {
      const found = ctx.core.strands.getByName(name);
      if (!found) {
        throw new Error(`Strand "${name}" not found. Run "knots strand list" to see configured strands.`);
      }
      strands.push(found);
    }
  } else {
    strands = ctx.core.strands.getAll();
  }

  if (strands.length === 0) {
    throw new Error('No strands configured. Run "knots strand add" to configure strands before comparing.');
  }

  const spinner = createSpinner(`Comparing prompt across ${strands.length} strand(s) in parallel...`).start();

  const promises = strands.map(async (strand): Promise<StrandComparisonResult> => {
    const runCtx = ctx.core.runManager.createRun({
      knotName: loadedKnot.spec.name,
      input,
      strandId: strand.id,
      strandName: strand.name,
      systemPrompt: knotSystemPrompt(loadedKnot.spec),
    });
    ctx.core.runManager.startRun(runCtx.runId);
    ctx.core.runs.update(runCtx.runId, {
      strand_id: strand.id,
      strand_name: strand.name,
      model_used: strand.model,
    });

    const startTime = Date.now();
    try {
      const provider = await getProviderForStrand(strand, ctx);
      const res = await provider.sendMessageSync({
        messages: [{ role: 'user', content: input }],
        system: knotSystemPrompt(loadedKnot.spec),
        model: strand.model,
      });

      const modelUsed = res.model || strand.model;
      const durationMs = Date.now() - startTime;

      ctx.core.runManager.completeRun(runCtx.runId, {
        output: res.content,
        modelUsed,
        tokensIn: res.usage?.prompt_tokens,
        tokensOut: res.usage?.completion_tokens,
      });

      return {
        runId: runCtx.runId,
        strand,
        model: modelUsed,
        output: res.content,
        durationMs,
        tokens: res.usage,
      };
    } catch (err) {
      const errorMessage = (err as Error).message;
      ctx.core.runManager.failRun(runCtx.runId, errorMessage);

      return {
        runId: runCtx.runId,
        strand,
        model: strand.model,
        output: '',
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  });

  let results: StrandComparisonResult[];
  try {
    results = await Promise.all(promises);
  } finally {
    spinner.stop();
  }

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

  // 2. Output Panels
  console.log(chalk.bold.yellow('\n--- Outputs by Strand ---'));
  for (const r of results) {
    const header = `[ ${r.strand.name} • ${r.model} • ${r.durationMs}ms ]`;
    const width = Math.max(60, header.length + 4);
    console.log('\n' + chalk.cyan('┌' + '─'.repeat(width) + '┐'));
    console.log(chalk.cyan('│ ') + chalk.bold.white(header));
    console.log(chalk.cyan('├' + '─'.repeat(width) + '┤'));

    if (r.error) {
      console.log(chalk.cyan('│ ') + chalk.red(`Error: ${r.error}`));
    } else {
      const lines = r.output.split('\n');
      for (const line of lines) {
        console.log(chalk.cyan('│ ') + line);
      }
    }
    console.log(chalk.cyan('└' + '─'.repeat(width) + '┘'));
  }
}

export function registerCompareCommand(program: Command): void {
  program
    .command('compare <knot-name>')
    .description('Run the same prompt across all configured strands in parallel and compare outputs')
    .option('-i, --input <text>', 'The input prompt to compare')
    .option('-s, --strands <names>', 'Comma-separated list of specific strands to compare')
    .action(async (knotName: string, options: { input?: string; strands?: string }) => {
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
          input = await promptInput(
            `Enter prompt to compare across strands for ${loadedKnot.spec.display_name || knotName}:`,
          );
        }

        if (!input || input.trim().length === 0) {
          console.error(chalk.red('Error: Comparison prompt cannot be empty.'));
          process.exitCode = 1;
          return;
        }

        const strandNames = options.strands
          ? options.strands
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
          : undefined;

        await compareStrandsParallel(loadedKnot, input, ctx, strandNames);
      } catch (err) {
        console.error(chalk.red(`Error comparing strands: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
