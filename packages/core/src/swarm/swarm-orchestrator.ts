import { v4 as uuidv4 } from 'uuid';
import type { KnotsCore } from '../index.js';
import { RoleManager } from './role-manager.js';
import { ToolExecutor, type ToolActionResult } from '../tools/index.js';
import { resolveApiKey } from '../connections.js';
import { createDefaultRegistry } from '@knots/providers';
import type {
  SwarmTeamPlan,
  SwarmBotAssignment,
  SwarmRunResult,
  AgentRole,
  RoleModelBinding,
} from '@knots/types';

export interface SwarmExecutionCallbacks {
  onPlanCreated?: (plan: SwarmTeamPlan) => void;
  onBotStarted?: (bot: SwarmBotAssignment) => void;
  onBotAction?: (botId: string, action: ToolActionResult) => void;
  onBotChunk?: (botId: string, chunk: string) => void;
  onBotCompleted?: (bot: SwarmBotAssignment) => void;
  onSynthesizing?: () => void;
  onDeliverableChunk?: (chunk: string) => void;
}

export class SwarmOrchestrator {
  private roleManager: RoleManager;
  private tools: ToolExecutor;
  private registry = createDefaultRegistry();

  constructor(private core: KnotsCore, workspaceRoot?: string) {
    this.roleManager = new RoleManager(core);
    this.tools = new ToolExecutor(workspaceRoot || core.dataDir);
  }

  getRoleManager(): RoleManager {
    return this.roleManager;
  }

  getTools(): ToolExecutor {
    return this.tools;
  }

  setWorkspace(dir: string): void {
    this.tools.setWorkspace(dir);
  }

  private async getProviderForBinding(binding: RoleModelBinding) {
    const apiKey = await resolveApiKey(binding.provider, this.core);
    return this.registry.createProvider(binding.provider, {
      endpoint: binding.endpoint,
      api_key: apiKey,
      default_model: binding.model,
    });
  }

  /**
   * Analyze the user prompt and dynamically architect the team of bots.
   */
  async planTeam(userPrompt: string): Promise<SwarmTeamPlan> {
    const orchestratorBinding = this.roleManager.getBinding('orchestrator');
    const provider = await this.getProviderForBinding(orchestratorBinding);

    const systemPrompt = `You are the Lead Swarm Architect.
Your task is to analyze the user's request and assemble an optimal, lean team of specialized AI bots with PC access to solve it.

Available bot roles:
- "coder": Can create/edit project files and build components on the user's PC.
- "researcher": Reads local project files and searches information.
- "reviewer": Audits code and can run terminal commands (tests, builds) to verify quality.

Instructions:
1. Break down what needs to be done.
2. Select 1 to 4 specialized bots (e.g. 2x coder, 1x researcher). Give each bot a clear name and specific mission.
3. Keep the team focused and non-redundant.

You MUST respond with valid JSON only in this exact schema:
{
  "strategy": "One sentence explaining why this team composition was chosen.",
  "bots": [
    {
      "id": "bot-1",
      "role": "coder" | "researcher" | "reviewer",
      "name": "Bot Title (e.g. Frontend Specialist, API Researcher)",
      "mission": "Clear, direct mission and instructions for this bot."
    }
  ]
}`;

    const response = await provider.sendMessageSync({
      model: orchestratorBinding.model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      response_format: 'json',
      temperature: 0.2,
    });

    let cleaned = response.content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    try {
      const parsed = JSON.parse(cleaned);
      const bots: SwarmBotAssignment[] = (parsed.bots || []).map((b: any, index: number) => ({
        id: b.id || `bot-${index + 1}`,
        role: (['coder', 'researcher', 'reviewer'].includes(b.role) ? b.role : 'coder') as AgentRole,
        name: b.name || `Specialist ${index + 1}`,
        mission: b.mission || userPrompt,
        status: 'pending' as const,
      }));

      if (bots.length === 0) {
        bots.push({
          id: 'bot-1',
          role: 'coder',
          name: 'Lead Specialist',
          mission: userPrompt,
          status: 'pending',
        });
      }

      return {
        id: uuidv4(),
        user_prompt: userPrompt,
        strategy: parsed.strategy || 'Assembled specialized bots for this task.',
        bots,
        created_at: new Date().toISOString(),
      };
    } catch {
      return {
        id: uuidv4(),
        user_prompt: userPrompt,
        strategy: 'Default dynamic delegation team.',
        bots: [
          {
            id: 'bot-1',
            role: 'coder',
            name: 'Lead Specialist',
            mission: userPrompt,
            status: 'pending',
          },
        ],
        created_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Run a bot with local PC tools (read_file, write_file, list_files, run_command)
   * in an action execution loop.
   */
  private async runBotWithTools(
    bot: SwarmBotAssignment,
    overallPrompt: string,
    callbacks?: SwarmExecutionCallbacks,
  ): Promise<string> {
    const binding = this.roleManager.getBinding(bot.role);
    const provider = await this.getProviderForBinding(binding);

    const systemPrompt = `You are ${bot.name}, a specialized ${bot.role.toUpperCase()} AI bot working in a multi-agent team.
Overall User Goal: "${overallPrompt}"
Your Specific Mission: "${bot.mission}"

You have real tools to access the project on the user's PC:
- list_files: {"action": "list_files", "path": "dir_path"} (inspect files)
- read_file: {"action": "read_file", "path": "file_path"} (read existing code/docs)
- write_file: {"action": "write_file", "path": "file_path", "content": "file_contents"} (create/update project files)
- run_command: {"action": "run_command", "command": "shell_command"} (run tests, builds, linter)
- final_answer: {"action": "final_answer", "summary": "Comprehensive summary of your work and results"}

Rules:
1. Always respond with ONE JSON action at a time.
2. Guardrails are active: You cannot access or modify critical system files outside the project workspace.
3. When your mission is done, call "final_answer".`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: `Start your mission now. Remember to respond strictly in JSON action format.`,
      },
    ];

    let turns = 0;
    const maxTurns = 8;
    let finalSummary = '';

    while (turns < maxTurns) {
      turns++;

      let response;
      try {
        response = await provider.sendMessageSync({
          model: binding.model,
          system: systemPrompt,
          messages,
          temperature: 0.2,
        });
      } catch (err: any) {
        return `Model error during execution: ${err.message}`;
      }

      const content = response.content.trim();
      messages.push({ role: 'assistant', content });

      // Clean JSON
      let cleaned = content;
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // If not JSON, treat content as text/final answer
        finalSummary = content;
        break;
      }

      if (parsed.action === 'final_answer') {
        finalSummary = parsed.summary || content;
        break;
      }

      // Execute Tool Action
      let result: ToolActionResult;
      if (parsed.action === 'write_file' && parsed.path && parsed.content !== undefined) {
        result = await this.tools.writeFile(parsed.path, parsed.content);
      } else if (parsed.action === 'read_file' && parsed.path) {
        result = await this.tools.readFile(parsed.path);
      } else if (parsed.action === 'list_files') {
        result = await this.tools.listFiles(parsed.path || '');
      } else if (parsed.action === 'run_command' && parsed.command) {
        result = await this.tools.runCommand(parsed.command);
      } else {
        result = {
          success: false,
          action: parsed.action || 'unknown',
          error: 'Invalid tool action or missing parameters.',
        };
      }

      callbacks?.onBotAction?.(bot.id, result);
      callbacks?.onBotChunk?.(
        bot.id,
        `\n[Tool: ${result.action} -> ${result.success ? 'Success' : 'Failed'} (${result.target || ''})]\n`,
      );

      // Feed observation back to bot
      const observation = result.success
        ? `Observation (${result.action}):\n${result.output}`
        : `Error (${result.action}):\n${result.error}`;

      messages.push({ role: 'user', content: observation });
    }

    return finalSummary || '(Task completed without summary)';
  }

  /**
   * Execute the team of bots in parallel using their assigned models and PC tools.
   */
  async executeTeam(
    plan: SwarmTeamPlan,
    callbacks?: SwarmExecutionCallbacks,
  ): Promise<SwarmRunResult> {
    const startTime = Date.now();
    callbacks?.onPlanCreated?.(plan);

    // 1. Run all bots in parallel with tools
    await Promise.all(
      plan.bots.map(async (bot) => {
        bot.status = 'running';
        callbacks?.onBotStarted?.(bot);

        const binding = this.roleManager.getBinding(bot.role);
        bot.model_used = `${binding.provider}:${binding.model}`;

        try {
          const output = await this.runBotWithTools(bot, plan.user_prompt, callbacks);
          bot.output = output;
          bot.status = 'completed';
          callbacks?.onBotCompleted?.(bot);
        } catch (err: any) {
          bot.status = 'failed';
          bot.output = `Error executing ${bot.name}: ${err?.message || String(err)}`;
          callbacks?.onBotCompleted?.(bot);
        }
      }),
    );

    // 2. Synthesize results with the Orchestrator
    callbacks?.onSynthesizing?.();
    const orchestratorBinding = this.roleManager.getBinding('orchestrator');
    const orchestratorProvider = await this.getProviderForBinding(orchestratorBinding);

    const botContributions = plan.bots
      .map(
        (b) =>
          `### [${b.name}] (Role: ${b.role})\n**Mission:** ${b.mission}\n\n**Output & Actions Summary:**\n${b.output || '(No output)'}`,
      )
      .join('\n\n---\n\n');

    const synthesisPrompt = `You are the Lead Orchestrator synthesizing the work of your multi-agent team.
Workspace Directory: "${this.tools.getWorkspace()}"

User's Original Request:
"${plan.user_prompt}"

Team's Work & Files Created:
${botContributions}

Instructions:
Consolidate and synthesize their work into one clean, polished, comprehensive deliverable for the user.
- Detail which files were created/modified.
- Explain the architecture and how to run or use the deliverable.
- Ensure the user has everything needed.`;

    let deliverable = '';
    try {
      const stream = orchestratorProvider.sendMessage({
        model: orchestratorBinding.model,
        messages: [{ role: 'user', content: synthesisPrompt }],
        temperature: 0.3,
      });

      for await (const chunk of stream) {
        if (chunk.delta) {
          deliverable += chunk.delta;
          callbacks?.onDeliverableChunk?.(chunk.delta);
        }
      }
    } catch (err: any) {
      deliverable = `# Execution Summary\n\n${botContributions}\n\n*(Note: Orchestrator synthesis encountered: ${err?.message})*`;
    }

    return {
      plan,
      deliverable,
      status: 'completed',
      duration_ms: Date.now() - startTime,
    };
  }

  async runTask(
    userPrompt: string,
    callbacks?: SwarmExecutionCallbacks,
  ): Promise<SwarmRunResult> {
    const plan = await this.planTeam(userPrompt);
    return this.executeTeam(plan, callbacks);
  }
}
