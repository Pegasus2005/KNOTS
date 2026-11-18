import { Command } from 'commander';
import chalk from 'chalk';
import { getCliContext } from '../config.js';
import { renderTable } from '../ui/table.js';

export function registerLaneCommands(program: Command): void {
  const lane = program.command('lane').description('Manage model routing preferences (lanes)');

  // knots lane set <name> <strands>
  lane
    .command('set <name> <strands>')
    .description('Create or update a lane with an ordered list of comma-separated strands')
    .action(async (name: string, strandsStr: string) => {
      try {
        const ctx = getCliContext();
        const strandOrder = strandsStr
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (strandOrder.length === 0) {
          console.error(chalk.red('Error: At least one strand must be specified.'));
          process.exitCode = 1;
          return;
        }

        // Validate that specified strands exist
        const missingStrands = strandOrder.filter((s) => !ctx.core.strands.getByName(s));
        if (missingStrands.length > 0) {
          console.warn(
            chalk.yellow(
              `Warning: The following strands are not yet configured: ${missingStrands.join(', ')}. Run "knots strand add" to configure them.`,
            ),
          );
        }

        const existingLane = ctx.core.lanes.getByName(name);
        if (existingLane) {
          ctx.core.lanes.update(existingLane.id, { strand_order: strandOrder });
          console.log(
            chalk.green(
              `✔ Lane "${chalk.bold(name)}" updated: ${strandOrder.map((s) => chalk.cyan(s)).join(' → ')}`,
            ),
          );
        } else {
          ctx.core.lanes.create({ name, strand_order: strandOrder });
          console.log(
            chalk.green(
              `✔ Lane "${chalk.bold(name)}" created: ${strandOrder.map((s) => chalk.cyan(s)).join(' → ')}`,
            ),
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error setting lane: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots lane list
  lane
    .command('list')
    .description('List all configured lanes and their strand orders')
    .action(async () => {
      try {
        const ctx = getCliContext();
        const lanes = ctx.core.lanes.getAll();

        const rows = lanes.map((l) => ({
          name: chalk.bold.cyan(l.name),
          order: l.strand_order.length > 0
            ? l.strand_order.map((s) => chalk.green(s)).join(chalk.gray(' → '))
            : chalk.dim('(empty)'),
          count: l.strand_order.length,
        }));

        renderTable({
          columns: [
            { key: 'name', header: 'Lane Name' },
            { key: 'order', header: 'Strand Order (Fallback Priority)' },
            { key: 'count', header: 'Strands', align: 'right' },
          ],
          rows,
          emptyMessage: 'No lanes configured. Use "knots lane set <name> <strand1,strand2,...>" to create one.',
        });
      } catch (err) {
        console.error(chalk.red(`Error listing lanes: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });

  // knots lane remove <name>
  lane
    .command('remove <name>')
    .description('Remove a configured lane')
    .action(async (name: string) => {
      try {
        const ctx = getCliContext();
        const existing = ctx.core.lanes.getByName(name);

        if (!existing) {
          console.error(chalk.red(`Lane "${name}" not found.`));
          process.exitCode = 1;
          return;
        }

        ctx.core.lanes.delete(existing.id);
        console.log(chalk.green(`✔ Lane "${name}" removed.`));
      } catch (err) {
        console.error(chalk.red(`Error removing lane: ${(err as Error).message}`));
        process.exitCode = 1;
      }
    });
}
