import { Command } from 'commander';
import chalk from 'chalk';
import type { Strand, TokenUsage } from '@knots/types';
import { getCliContext, getProviderForStrand } from '../config.js';
import { createSpinner } from '../ui/spinner.js';
import { printAttribution } from '../ui/stream.js';
import { promptInput } from '../ui/prompt.js';

/**
 * Read piped input from stdin if available.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');

    process.stdin.on('readable', () => {
      let chunk: string | null;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      resolve(data.trim());
    });

    // Fallback timer in case stdin is open but empty
    setTimeout(() => {
      resolve(data.trim());
    }, 200);
  });
}

/**
 * Resolve which strand to use based on CLI flag, knot lanes, default lane, or any available strand.
 */
export function resolveStrand(
  forcedStrandName: string | undefined,
  knotLanes: Record<string, string[]> | undefined,
): Strand {
  const ctx = getCliContext();

  // 1. Explicit --strand flag
  if (forcedStrandName) {
    const s = ctx.core.strands.getByName(forcedStrandName);
    if (!s) {
      throw new Error(`Specified strand "${forcedStrandName}" does not exist. Run "knots strand list" to see options.`);
    }
    return s;
  }

  // 2. Knot-specific default lane
  if (knotLanes?.default && knotLanes.default.length > 0) {
    for (const name of knotLanes.default) {
      const s = ctx.core.strands.getByName(name);
      if (s) return s;
    }
  }

  // 3. Global default lane
  const globalDefault = ctx.core.lanes.getByName('default');
  if (globalDefault && globalDefault.strand_order.length > 0) {
    for (const name of globalDefault.strand_order) {
      const s = ctx.core.strands.getByName(name);
      if (s) return s;
    }
  }

  // 4. Any configured strand
  const allStrands = ctx.core.strands.getAll();
  if (allStrands.length > 0) {
    return allStrands[0];
  }

  throw new Error('No strands configured. Run "knots strand add" to configure a model connection first.');
}

export function registerRunCommand(program: Command): void {
  program
    .command('run <knot-name>')
    .description("Run a knot with a prompt/task (a 'pull')")
    .option('-s, --strand <name>', 'Force a specific strand for execution')
    .option('-i, --input <text>', 'The input prompt/task')
    .option('--json', 'Output results as JSON')
    .action(async (knotName: string, options: { strand?: string; input?: string; json?: boolean }) => {
      const ctx = getCliContext();
      let runId: string | undefined;

      try {
        // 1. Resolve Knot
        const loadedKnot = ctx.core.knots.get(knotName);
        if (!loadedKnot) {
          console.error(chalk.red(`Knot "${knotName}" not found in library. Use "knots list" to view knots.`));
          process.exitCode = 1;
          return;
        }

        // 2. Resolve Input (arg -> stdin -> prompt)
        let input = options.input;
        if (!input) {
          input = await readStdin();
        }
        if (!input) {
          input = await promptInput(`Enter prompt for ${loadedKnot.spec.display_name || knotName}:`);
        }
        if (!input || input.trim().length === 0) {
          console.error(chalk.red('Error: Prompt input cannot be empty.'));
          process.exitCode = 1;
          return;
        }

        // 3. Resolve Strand
        const strand = resolveStrand(options.strand, loadedKnot.spec.lanes);

        // 4. Create and start Run in RunManager
        const runContext = ctx.core.runManager.createRun({
          knotName: loadedKnot.spec.name,
          input,
          strandId: strand.id,
          strandName: strand.name,
          systemPrompt: loadedKnot.spec.instructions,
        });
        runId = runContext.runId;
        ctx.core.runManager.startRun(runId);

        // 5. Instantiate Provider
        const provider = await getProviderForStrand(strand, ctx);

        const startTime = Date.now();
        let fullOutput = '';
        let finalUsage: TokenUsage | undefined;
        let modelUsed = strand.model;

        if (options.json) {
          // JSON mode: execute sync or stream silently
          const response = await provider.sendMessageSync({
            messages: [{ role: 'user', content: input }],
            system: loadedKnot.spec.instructions,
            model: strand.model,
          });

          fullOutput = response.content;
          finalUsage = response.usage;
          modelUsed = response.model;

          const durationMs = Date.now() - startTime;
          ctx.core.runManager.completeRun(runId, {
            output: fullOutput,
            modelUsed,
            tokensIn: finalUsage?.prompt_tokens,
            tokensOut: finalUsage?.completion_tokens,
          });

          const resultJson = {
            id: runId,
            knot: loadedKnot.spec.name,
            strand: strand.name,
            provider: strand.provider,
            model: modelUsed,
            status: 'completed',
            input,
            output: fullOutput,
            duration_ms: durationMs,
            usage: finalUsage,
          };

          console.log(JSON.stringify(resultJson, null, 2));
        } else {
          // Streaming terminal mode
          const spinner = createSpinner(`Running "${knotName}" via ${strand.name} (${strand.model})...`).start();
          let isFirstChunk = true;

          const stream = provider.sendMessage({
            messages: [{ role: 'user', content: input }],
            system: loadedKnot.spec.instructions,
            model: strand.model,
            stream: true,
          });

          for await (const chunk of stream) {
            if (isFirstChunk) {
              spinner.stop();
              isFirstChunk = false;
            }

            if (chunk.delta) {
              process.stdout.write(chunk.delta);
              fullOutput += chunk.delta;
              ctx.core.runManager.progressRun(runId, chunk.delta);
            }

            if (chunk.is_final) {
              if (chunk.usage) finalUsage = chunk.usage;
              if (chunk.model) modelUsed = chunk.model;
            }
          }

          if (isFirstChunk) {
            spinner.stop();
          }

          if (!fullOutput.endsWith('\n')) {
            process.stdout.write('\n');
          }

          const durationMs = Date.now() - startTime;
          ctx.core.runManager.completeRun(runId, {
            output: fullOutput,
            modelUsed,
            tokensIn: finalUsage?.prompt_tokens,
            tokensOut: finalUsage?.completion_tokens,
          });

          printAttribution({
            strandName: strand.name,
            model: modelUsed,
            durationMs,
            tokens: finalUsage,
          });
        }
      } catch (err) {
        if (runId) {
          ctx.core.runManager.failRun(runId, (err as Error).message);
        }
        console.error(chalk.red(`\nRun failed: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
