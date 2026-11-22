import { Command } from 'commander';
import chalk from 'chalk';
import { requestWorkerStop } from '@knots/core';
import { getCliContext } from '../config.js';

export function registerKillCommand(program: Command): void {
  program
    .command('kill')
    .description('Stop background worker jobs and disable further dispatch in this workspace')
    .action(() => {
      try {
        const { core } = getCliContext();
        requestWorkerStop(core);
        core.runManager.cancelAll('Kill switch triggered by user');
        console.log(
          chalk.bold.yellow(
            'Stop requested. Worker dispatch is disabled. The desktop worker aborts active requests and cancels queued work when it receives the command.',
          ),
        );
      } catch (error) {
        console.error(chalk.red(`Error requesting stop: ${(error as Error).message}`));
        process.exitCode = 1;
      }
    });
}
