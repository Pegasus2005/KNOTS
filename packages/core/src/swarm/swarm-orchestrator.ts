import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import os from 'node:os';
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
    this.tools = new ToolExecutor(workspaceRoot || process.cwd());
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
   * Helper to parse JSON action blocks from model output, handling markdown,
   * leading thoughts, and embedded JSON blocks.
   */
  private extractActionJson(text: string): any {
    const trimmed = text.trim();
    // 1. Direct parse
    try {
      return JSON.parse(trimmed);
    } catch {}

    // 2. Fenced code block: ```json { ... } ```
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {}
    }

    // 3. Find first JSON object with an "action" field
    const actionMatch = trimmed.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+"[\s\S]*?\}/);
    if (actionMatch) {
      try {
        return JSON.parse(actionMatch[0]);
      } catch {}
    }

    return null;
  }

  /**
   * Run a bot with local PC tools (find_files, list_files, read_file, write_file, run_command)
   * in an autonomous action execution loop.
   */
  private async runBotWithTools(
    bot: SwarmBotAssignment,
    overallPrompt: string,
    callbacks?: SwarmExecutionCallbacks,
  ): Promise<string> {
    const binding = this.roleManager.getBinding(bot.role);
    const provider = await this.getProviderForBinding(binding);

    const workspace = this.tools.getWorkspace();
    const initialFiles = await this.tools.listFiles('');
    const topLevelFiles = initialFiles.output || '(empty)';

    const systemPrompt = `You are ${bot.name}, a specialized ${bot.role.toUpperCase()} AI bot working in an autonomous multi-agent team.
Overall Goal: "${overallPrompt}"
Your Specific Mission: "${bot.mission}"

PC Target Locations:
- User Desktop: ${path.join(os.homedir(), 'Desktop').replace(/\\/g, '/')}
- User Downloads: ${path.join(os.homedir(), 'Downloads').replace(/\\/g, '/')}
- User Documents: ${path.join(os.homedir(), 'Documents').replace(/\\/g, '/')}
- Project Workspace: ${workspace.replace(/\\/g, '/')}

Top-level files/directories in workspace:
${topLevelFiles}

You have real tools to access PC files, edit code, and browse the live internet:
- find_files: {"action": "find_files", "query": "filename_or_keyword"} (Search files recursively anywhere on PC, Desktop, or workspace)
- read_file: {"action": "read_file", "path": "file_path"} (Read any file on PC, including code, text, docs, and PDFs)
- edit_file: {"action": "edit_file", "path": "file_path", "target": "old_code", "replacement": "new_code"} (Edit existing file in-place)
- write_file: {"action": "write_file", "path": "file_path", "content": "file_contents"} (Create or overwrite a file)
- web_search: {"action": "web_search", "query": "search_terms"} (Search live internet for answers, docs, or libraries)
- fetch_url: {"action": "fetch_url", "url": "https://..."} (Fetch and read live webpage content)
- run_command: {"action": "run_command", "command": "shell_command"} (Run terminal commands: build, test, lint, python, node)
- final_answer: {"action": "final_answer", "summary": "Comprehensive detailed output, summary of file contents, or solution"}

CRITICAL RULES:
1. DESTINATION PRECISION: If the user asks for a file on their Desktop, write ONLY to the Desktop ("Desktop/<filename>"). Do NOT create a duplicate copy inside the project folder.
2. PC & INTERNET ACCESS: You have full access to user files across the PC and internet search.
3. OUTPUT STRICT JSON: Output one JSON action block per turn.
4. When finished with your mission, call final_answer with the complete result.`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'user',
        content: `Start your mission now. Explore the workspace, locate the relevant files using find_files or read_file, and execute your actions. Respond with your first JSON action.`,
      },
    ];

    let turns = 0;
    const maxTurns = 15;
    let toolsExecutedCount = 0;
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

      const parsed = this.extractActionJson(content);

      if (!parsed || !parsed.action) {
        // Stream the bot's thoughts to the UI
        callbacks?.onBotChunk?.(bot.id, `\n${content}\n`);

        // If turn limit near, accept content
        if (turns >= maxTurns - 1) {
          finalSummary = content;
          break;
        }

        // Prompt model to execute an action instead of exiting
        messages.push({
          role: 'user',
          content: `Please proceed by executing an action using JSON: {"action": "find_files" | "read_file" | "list_files" | "write_file" | "run_command", ...}.`,
        });
        continue;
      }

      // Check if bot called final_answer
      if (parsed.action === 'final_answer') {
        // Reject premature exit if no tools were used and early turn
        if (toolsExecutedCount === 0 && turns < 3) {
          callbacks?.onBotChunk?.(bot.id, `\n[Investigating project files before finishing...]\n`);
          messages.push({
            role: 'user',
            content: `You haven't inspected or touched any files yet. Please use find_files or read_file to inspect the workspace files and complete your mission before calling final_answer.`,
          });
          continue;
        }

        finalSummary = parsed.summary || content;
        callbacks?.onBotChunk?.(bot.id, `\n[Mission Completed]: ${finalSummary}\n`);
        break;
      }

      // Execute Tool Action
      let result: ToolActionResult;
      if (parsed.action === 'find_files') {
        result = await this.tools.findFiles(parsed.query || parsed.pattern || '');
      } else if (parsed.action === 'read_file' && parsed.path) {
        result = await this.tools.readFile(parsed.path, overallPrompt);
      } else if (parsed.action === 'edit_file' && parsed.path && parsed.target !== undefined && parsed.replacement !== undefined) {
        result = await this.tools.editFile(parsed.path, parsed.target, parsed.replacement, overallPrompt);
      } else if (parsed.action === 'write_file' && parsed.path && parsed.content !== undefined) {
        result = await this.tools.writeFile(parsed.path, parsed.content, overallPrompt);
      } else if (parsed.action === 'list_files') {
        result = await this.tools.listFiles(parsed.path || '');
      } else if (parsed.action === 'web_search' && parsed.query) {
        result = await this.tools.webSearch(parsed.query);
      } else if (parsed.action === 'fetch_url' && parsed.url) {
        result = await this.tools.fetchUrl(parsed.url);
      } else if (parsed.action === 'run_command' && parsed.command) {
        result = await this.tools.runCommand(parsed.command);
      } else {
        result = {
          success: false,
          action: parsed.action || 'unknown',
          error: 'Unrecognized tool action or missing parameters.',
        };
      }

      toolsExecutedCount++;
      callbacks?.onBotAction?.(bot.id, result);
      const icon = result.success ? '✓' : '✗';
      callbacks?.onBotChunk?.(
        bot.id,
        `\n[${result.action.toUpperCase()}] ${result.target || ''} -> ${icon}\n`,
      );

      // Feed observation back to bot
      const observation = result.success
        ? `Observation (${result.action} -> success):\n${result.output}`
        : `Observation (${result.action} -> error):\n${result.error}`;

      messages.push({ role: 'user', content: observation });
    }

    return finalSummary || '(Mission completed)';
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

Team's Work & Files Created/Read:
${botContributions}

Instructions:
Consolidate and synthesize their work into one clean, polished, comprehensive deliverable for the user.
- If the user asked for a summary, analysis, code, or answer, present the actual complete findings and results prominently.
- Detail which files were created, modified, or read.
- Ensure the deliverable is directly answering what the user asked for.`;

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
