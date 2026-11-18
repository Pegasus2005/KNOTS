import { Command } from 'commander';
import chalk from 'chalk';
import { getCliContext } from '../config.js';

export function registerKillCommand(program: Command): void {
  program
    .command('kill')
    .description('Kill switch: immediately cancel all running operations and active pulls')
    .action(async () => {
      try {
        const ctx = getCliContext();

        // 1. Cancel in-memory active runs via RunManager (also marks them cancelled in DB)
        const cancelledMemory = ctx.core.runManager.cancelAll('Kill switch triggered by user');

        // 2. Also mark any remaining database records still in active statuses as cancelled
        const activeDbRuns = [
          ...ctx.core.runs.findByStatus('running'),
          ...ctx.core.runs.findByStatus('queued'),
          ...ctx.core.runs.findByStatus('waiting_input'),
          ...ctx.core.runs.findByStatus('waiting_approval'),
        ];

        let cancelledDb = 0;
        const now = new Date().toISOString();
        for (const run of activeDbRuns) {
          ctx.core.runs.update(run.id, {
            status: 'cancelled',
            error: 'Kill switch triggered by user',
            completed_at: now,
          });
          cancelledDb++;
        }

        const totalCancelled = cancelledMemory + cancelledDb;

        if (totalCancelled > 0) {
          console.log(
            chalk.bold.red(
              `\n🛑 Kill switch activated: Stopped and cancelled ${totalCancelled} active operation(s).`,
            ),
          );
        } else {
          console.log(chalk.bold.yellow('\nNo active runs or operations were found running.'));
        }
      } catch (err) {
        console.error(chalk.red(`Error executing kill switch: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
