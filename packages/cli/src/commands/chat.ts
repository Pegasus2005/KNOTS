import { knotSystemPrompt } from '@knots/core';
import * as readline from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import type { ModelMessage, Strand, TokenUsage } from '@knots/types';
import { getCliContext, getProviderForStrand } from '../config.js';
import { resolveStrand } from './run.js';
import { printAttribution } from '../ui/stream.js';
import { compareStrandsParallel } from './compare.js';

export function registerChatCommand(program: Command): void {
  program
    .command('chat <knot-name>')
    .description('Interactive multi-turn chat REPL with a knot')
    .option('-s, --strand <name>', 'Initial strand to use for chat')
    .action(async (knotName: string, options: { strand?: string }) => {
      const ctx = getCliContext();

      try {
        // 1. Resolve knot
        const loadedKnot = ctx.core.knots.get(knotName);
        if (!loadedKnot) {
          console.error(chalk.red(`Knot "${knotName}" not found in library.`));
          process.exitCode = 1;
          return;
        }

        // 2. Resolve initial strand
        let currentStrand: Strand = resolveStrand(options.strand, loadedKnot.spec.lanes);

        // 3. Welcome banner (dynamic width to avoid overflow)
        const titleLine = `KNOTS Chat: ${loadedKnot.spec.display_name || loadedKnot.spec.name}`;
        const strandLine = `Active Strand: ${currentStrand.name} (${currentStrand.provider}:${currentStrand.model})`;
        const boxInnerWidth = Math.max(60, titleLine.length + 4, strandLine.length + 4);

        console.log('\n' + chalk.cyan('╔' + '═'.repeat(boxInnerWidth) + '╗'));
        console.log(
          chalk.cyan('║  ') +
          chalk.bold.white(titleLine) +
          ' '.repeat(boxInnerWidth - titleLine.length - 2) +
          chalk.cyan('║'),
        );
        console.log(
          chalk.cyan('║  ') +
          chalk.dim(strandLine) +
          ' '.repeat(boxInnerWidth - strandLine.length - 2) +
          chalk.cyan('║'),
        );
        console.log(chalk.cyan('╚' + '═'.repeat(boxInnerWidth) + '╝'));
        console.log(chalk.dim('\nCommands:'));
        console.log(chalk.dim('  /swap <strand>   Switch model connection mid-chat'));
        console.log(chalk.dim('  /compare         Rerun last message on all strands'));
        console.log(chalk.dim('  /status          Show current strand details'));
        console.log(chalk.dim('  /history         Show message count & turns'));
        console.log(chalk.dim('  /quit, /exit     Exit chat\n'));

        const history: ModelMessage[] = [];
        let lastUserMessage = '';

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: chalk.bold.green('you > '),
        });

        const closed = new Promise<void>((resolve) => {
          rl.once('close', () => resolve());
        });

        rl.on('SIGINT', () => {
          console.log(chalk.dim('\nExiting chat session. Goodbye!'));
          rl.close();
        });

        rl.prompt();

        rl.on('line', async (line: string) => {
          const raw = line.trim();
          if (!raw) {
            rl.prompt();
            return;
          }

          // Handle Slash Commands
          if (raw.startsWith('/')) {
            const [cmd, ...args] = raw.split(/\s+/);
            const lowerCmd = cmd.toLowerCase();

            if (lowerCmd === '/quit' || lowerCmd === '/exit') {
              console.log(chalk.dim('\nExiting chat session. Goodbye!'));
              rl.close();
              return;
            }

            if (lowerCmd === '/status') {
              console.log(chalk.cyan('\n--- Chat Status ---'));
              console.log(`${chalk.bold('Knot:')}     ${loadedKnot.spec.display_name || loadedKnot.spec.name}`);
              console.log(
                `${chalk.bold('Strand:')}   ${currentStrand.name} (${currentStrand.provider}:${currentStrand.model})`,
              );
              console.log(`${chalk.bold('Type:')}     ${currentStrand.is_local ? 'Local' : 'Cloud'}`);
              if (currentStrand.endpoint) {
                console.log(`${chalk.bold('Endpoint:')} ${currentStrand.endpoint}`);
              }
              console.log(`${chalk.bold('Turns:')}    ${history.filter((m) => m.role === 'user').length}`);
              console.log(chalk.cyan('-------------------\n'));
              rl.prompt();
              return;
            }

            if (lowerCmd === '/history') {
              console.log(
                chalk.cyan(
                  `\nConversation history: ${history.length} messages (${history.filter((m) => m.role === 'user').length} user turns).\n`,
                ),
              );
              rl.prompt();
              return;
            }

            if (lowerCmd === '/swap') {
              const targetStrandName = args[0];
              if (!targetStrandName) {
                console.log(chalk.yellow('Usage: /swap <strand-name>'));
                rl.prompt();
                return;
              }

              const newStrand = ctx.core.strands.getByName(targetStrandName);
              if (!newStrand) {
                console.log(
                  chalk.red(`Strand "${targetStrandName}" not found. Run "knots strand list" to see options.`),
                );
                rl.prompt();
                return;
              }

              currentStrand = newStrand;
              console.log(
                chalk.bold.green(
                  `✔ Swapped to strand "${currentStrand.name}" (${currentStrand.provider}:${currentStrand.model})\n`,
                ),
              );
              rl.prompt();
              return;
            }

            if (lowerCmd === '/compare') {
              if (!lastUserMessage) {
                console.log(chalk.yellow('No previous user message to compare. Send a prompt first!\n'));
                rl.prompt();
                return;
              }

              console.log(chalk.bold.cyan('\nRe-running last message on all configured strands...\n'));
              rl.pause();
              try {
                await compareStrandsParallel(loadedKnot, lastUserMessage, ctx);
              } catch (cErr) {
                console.error(chalk.red(`Comparison failed: ${(cErr as Error).message}`));
              }
              rl.resume();
              console.log('');
              rl.prompt();
              return;
            }

            console.log(
              chalk.yellow(`Unknown command: ${cmd}. Available: /swap, /compare, /status, /history, /quit\n`),
            );
            rl.prompt();
            return;
          }

          // Normal chat turn
          lastUserMessage = raw;
          history.push({ role: 'user', content: raw });

          const runCtx = ctx.core.runManager.createRun({
            knotName: loadedKnot.spec.name,
            input: raw,
            strandId: currentStrand.id,
            strandName: currentStrand.name,
            systemPrompt: knotSystemPrompt(loadedKnot.spec),
          });
          ctx.core.runManager.startRun(runCtx.runId);
          ctx.core.runs.update(runCtx.runId, {
            strand_id: currentStrand.id,
            strand_name: currentStrand.name,
            model_used: currentStrand.model,
          });

          rl.pause();

          try {
            const provider = await getProviderForStrand(currentStrand, ctx);
            process.stdout.write(
              chalk.bold.magenta(`\n${loadedKnot.spec.display_name || knotName} (${currentStrand.name}) > `),
            );

            let responseText = '';
            let finalUsage: TokenUsage | undefined;
            let modelUsed = currentStrand.model;
            const startTime = Date.now();

            const stream = provider.sendMessage({
              messages: [...history],
              system: knotSystemPrompt(loadedKnot.spec),
              model: currentStrand.model,
              stream: true,
            });

            for await (const chunk of stream) {
              if (chunk.delta) {
                process.stdout.write(chunk.delta);
                responseText += chunk.delta;
                ctx.core.runManager.progressRun(runCtx.runId, chunk.delta);
              }
              if (chunk.is_final) {
                if (chunk.usage) finalUsage = chunk.usage;
                if (chunk.model) modelUsed = chunk.model;
              }
            }

            if (!responseText.endsWith('\n')) {
              process.stdout.write('\n');
            }

            const durationMs = Date.now() - startTime;
            history.push({ role: 'assistant', content: responseText });

            ctx.core.runManager.completeRun(runCtx.runId, {
              output: responseText,
              modelUsed,
              tokensIn: finalUsage?.prompt_tokens,
              tokensOut: finalUsage?.completion_tokens,
            });

            printAttribution({
              strandName: currentStrand.name,
              model: modelUsed,
              durationMs,
              tokens: finalUsage,
            });
            console.log('');
          } catch (err) {
            ctx.core.runManager.failRun(runCtx.runId, (err as Error).message);
            console.error(chalk.red(`\nError: ${(err as Error).message}\n`));
          } finally {
            rl.resume();
            rl.prompt();
          }
        });

        await closed;
      } catch (err) {
        console.error(chalk.red(`Error starting chat: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
