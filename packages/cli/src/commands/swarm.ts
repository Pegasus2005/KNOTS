import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getCliContext } from '../config.js';
import type { AgentRole, SwarmTeamPlan, SwarmBotAssignment } from '@knots/types';

const ROLE_ICONS: Record<string, string> = {
  orchestrator: '🧠',
  coder: '💻',
  researcher: '🌐',
  reviewer: '✍️',
};

export function registerSwarmCommands(program: Command): void {
  // Main task execution: knots task "Build me a landing page"
  program
    .command('task <prompt...>')
    .description('Run a prompt with the autonomous multi-agent swarm')
    .action(async (promptParts: string[]) => {
      const userPrompt = promptParts.join(' ').trim();
      if (!userPrompt) {
        console.error(chalk.red('Please provide a task or prompt.'));
        process.exitCode = 1;
        return;
      }

      const { core } = getCliContext();
      console.log(chalk.bold.yellow('\n⚡ KNOTS Multi-Agent Swarm\n'));

      const spinner = ora('🧠 Orchestrator is analyzing prompt & designing team...').start();

      try {
        const result = await core.swarm.runTask(userPrompt, {
          onPlanCreated: (plan: SwarmTeamPlan) => {
            spinner.succeed(chalk.green(`Team assembled (${plan.bots.length} specialized bots)`));
            console.log(chalk.gray(`Strategy: ${plan.strategy}\n`));

            console.log(chalk.bold('Team Composition:'));
            plan.bots.forEach((b: SwarmBotAssignment) => {
              const icon = ROLE_ICONS[b.role] || '🤖';
              console.log(`  ${icon} ${chalk.cyan(b.name)} [${chalk.magenta(b.role.toUpperCase())}] — ${chalk.gray(b.mission)}`);
            });
            console.log('');
            spinner.start('Bots executing their missions in parallel...');
          },
          onBotStarted: (bot: SwarmBotAssignment) => {
            // bot started
          },
          onBotCompleted: (bot: SwarmBotAssignment) => {
            console.log(`  ${chalk.green('✓')} ${bot.name} finished.`);
          },
          onSynthesizing: () => {
            spinner.start('🧠 Orchestrator is synthesizing final deliverable...');
          },
        });

        spinner.succeed(chalk.green('Task completed successfully!\n'));

        console.log(chalk.bold.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.bold.yellow('📦 FINAL DELIVERABLE:'));
        console.log(chalk.bold.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
        console.log(result.deliverable);
        console.log('\n' + chalk.gray(`Duration: ${(result.duration_ms / 1000).toFixed(1)}s`));
      } catch (err: any) {
        spinner.fail(chalk.red('Swarm execution failed'));
        console.error(chalk.red(err?.message || String(err)));
        process.exitCode = 1;
      }
    });

  // Keys command: knots keys set <provider> <key>
  const keysCmd = program.command('keys').description('Manage API keys');

  keysCmd
    .command('set <provider> <key>')
    .description('Save an API key securely (e.g. openrouter, openai, anthropic, google)')
    .action(async (provider: string, key: string) => {
      const { core } = getCliContext();
      await core.credentials.setApiKey(provider.toLowerCase(), key.trim());
      console.log(chalk.green(`✓ Saved API key for ${provider}`));
    });

  keysCmd
    .command('list')
    .description('Check which provider keys are configured')
    .action(async () => {
      const { core } = getCliContext();
      const providers = ['openrouter', 'anthropic', 'openai', 'google', 'ollama'];
      console.log(chalk.bold('\nConfigured API Keys:'));
      for (const p of providers) {
        const key = await core.credentials.getApiKey(p);
        const status = key ? chalk.green('Configured (Keyring)') : chalk.gray('Not set');
        console.log(`  ${p.padEnd(12)}: ${status}`);
      }
      console.log('');
    });

  // Roles command: knots roles set <role> <provider> <model>
  const rolesCmd = program.command('roles').description('Manage model assignments for swarm roles');

  rolesCmd
    .command('list')
    .description('List current role assignments')
    .action(() => {
      const { core } = getCliContext();
      const bindings = core.roles.getAllBindings();
      console.log(chalk.bold('\nSwarm Role Assignments:'));
      Object.entries(bindings).forEach(([role, b]) => {
        const icon = ROLE_ICONS[role] || '🤖';
        console.log(`  ${icon} ${role.padEnd(14)}: ${chalk.cyan(b.provider)} / ${chalk.yellow(b.model)}`);
      });
      console.log('');
    });

  rolesCmd
    .command('set <role> <provider> <model>')
    .description('Assign a model to a role (e.g. coder openrouter anthropic/claude-3.5-sonnet)')
    .action((role: string, provider: string, model: string) => {
      const { core } = getCliContext();
      core.roles.setBinding(role as AgentRole, {
        role: role as AgentRole,
        provider: provider as any,
        model,
        label: `${provider}:${model}`,
      });
      console.log(chalk.green(`✓ Assigned ${role} to ${provider}/${model}`));
    });
}

