#!/usr/bin/env node
import { Command } from 'commander';
import { closeCliContext } from './config.js';
import { registerStrandCommands } from './commands/strand.js';
import { registerLaneCommands } from './commands/lane.js';
import { registerKnotCommands } from './commands/knot.js';
import { registerRunCommand } from './commands/run.js';
import { registerChatCommand } from './commands/chat.js';
import { registerCompareCommand } from './commands/compare.js';
import { registerLogCommand } from './commands/log.js';
import { registerKillCommand } from './commands/kill.js';
import { registerSwarmCommands } from './commands/swarm.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('knots')
    .description('KNOTS — Model-agnostic personal AI orchestration platform')
    .version('0.1.0');

  registerStrandCommands(program);
  registerLaneCommands(program);
  registerKnotCommands(program);
  registerRunCommand(program);
  registerChatCommand(program);
  registerCompareCommand(program);
  registerLogCommand(program);
  registerKillCommand(program);
  registerSwarmCommands(program);

  return program;
}

async function main(): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } finally {
    closeCliContext();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
  closeCliContext();
});
