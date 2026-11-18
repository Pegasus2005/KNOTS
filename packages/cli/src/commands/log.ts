import { Command } from 'commander';
import chalk from 'chalk';
import type { RunStatus } from '@knots/types';
import { getCliContext } from '../config.js';
import { renderTable } from '../ui/table.js';

function formatStatus(status: RunStatus): string {
  switch (status) {
    case 'completed':
      return chalk.green('completed');
    case 'failed':
      return chalk.red('failed');
    case 'running':
      return chalk.yellow('running');
    case 'queued':
      return chalk.blue('queued');
    case 'cancelled':
      return chalk.gray('cancelled');
    case 'waiting_input':
      return chalk.magenta('waiting');
    case 'waiting_approval':
      return chalk.cyan('approval');
    default:
      return status;
  }
}

export function registerLogCommand(program: Command): void {
  program
    .command('log')
    .description('Show recent activity log (runs with knot, model, status, duration, tokens)')
    .option('-l, --limit <number>', 'Number of entries to show', '20')
    .option('-k, --knot <name>', 'Filter by knot identifier')
    .action(async (options: { limit: string; knot?: string }) => {
      try {
        const ctx = getCliContext();
        const parsedLimit = parseInt(options.limit, 10);
        const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

        const runs = options.knot
          ? ctx.core.runs.findByKnot(options.knot, limit)
          : ctx.core.runs.getAll(limit);

        const rows = runs.map((r) => {
          const idShort = r.id.length > 8 ? r.id.slice(0, 8) : r.id;
          const tokensStr =
            r.tokens_in !== undefined || r.tokens_out !== undefined
              ? `${r.tokens_in ?? 0}/${r.tokens_out ?? 0}`
              : chalk.dim('—');

          const durationStr = r.duration_ms !== undefined ? `${r.duration_ms}ms` : chalk.dim('—');
          const timeStr = r.started_at ? r.started_at.replace('T', ' ').slice(0, 19) : chalk.dim('—');

          return {
            id: chalk.dim(idShort),
            knot: chalk.bold.cyan(r.knot_name),
            strand: r.strand_name || chalk.dim('—'),
            model: r.model_used ? chalk.magenta(r.model_used) : chalk.dim('—'),
            status: formatStatus(r.status),
            duration: durationStr,
            tokens: tokensStr,
            started: timeStr,
          };
        });

        renderTable({
          columns: [
            { key: 'id', header: 'ID' },
            { key: 'knot', header: 'Knot' },
            { key: 'strand', header: 'Strand' },
            { key: 'model', header: 'Model' },
            { key: 'status', header: 'Status' },
            { key: 'duration', header: 'Duration', align: 'right' },
            { key: 'tokens', header: 'In/Out Tokens', align: 'right' },
            { key: 'started', header: 'Started At' },
          ],
          rows,
          emptyMessage: 'No runs recorded in activity log.',
        });
      } catch (err) {
        console.error(chalk.red(`Error retrieving activity log: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
