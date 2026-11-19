import { v4 as uuidv4 } from 'uuid';
import type { KnotsCore } from '../index.js';
import { RoleManager } from './role-manager.js';
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
  onBotChunk?: (botId: string, chunk: string) => void;
  onBotCompleted?: (bot: SwarmBotAssignment) => void;
  onSynthesizing?: () => void;
  onDeliverableChunk?: (chunk: string) => void;
}

export class SwarmOrchestrator {
  private roleManager: RoleManager;
  private registry = createDefaultRegistry();

  constructor(private core: KnotsCore) {
    this.roleManager = new RoleManager(core);
  }

  getRoleManager(): RoleManager {
    return this.roleManager;
  }

  /**
   * Helper to instantiate a ModelProvider for a given Role binding.
   */
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
Your task is to analyze the user's request and assemble an optimal, lean team of specialized AI bots to solve it.

Available bot roles:
- "coder": Writes clean code, scripts, frontend components, backend logic, tests, queries.
- "researcher": Researches information, architecture patterns, APIs, external libraries, competitor examples.
- "reviewer": Reviews plans, audits code for security & edge cases, verifies output quality.

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
          name: 'Primary Assistant',
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
      // Fallback if model did not output perfect JSON
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
   * Execute the team of bots in parallel using their assigned models,
   * then synthesize the final deliverable.
   */
  async executeTeam(
    plan: SwarmTeamPlan,
    callbacks?: SwarmExecutionCallbacks,
  ): Promise<SwarmRunResult> {
    const startTime = Date.now();
    callbacks?.onPlanCreated?.(plan);

    // 1. Run all bots in parallel with their role-specific models
    await Promise.all(
      plan.bots.map(async (bot) => {
        bot.status = 'running';
        callbacks?.onBotStarted?.(bot);

        const binding = this.roleManager.getBinding(bot.role);
        bot.model_used = `${binding.provider}:${binding.model}`;

        try {
          const provider = await this.getProviderForBinding(binding);
          const system = `You are ${bot.name}, a specialized ${bot.role.toUpperCase()} AI bot working in a team.
Context of the overall user goal: "${plan.user_prompt}"

Your specific mission:
${bot.mission}

Deliver thorough, high-quality, direct work. Do not include fluff. Focus entirely on completing your mission.`;

          const stream = provider.sendMessage({
            model: binding.model,
            system,
            messages: [{ role: 'user', content: bot.mission }],
            temperature: 0.4,
          });

          let fullOutput = '';
          for await (const chunk of stream) {
            if (chunk.delta) {
              fullOutput += chunk.delta;
              callbacks?.onBotChunk?.(bot.id, chunk.delta);
            }
          }

          bot.output = fullOutput;
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
          `### [${b.name}] (Role: ${b.role})\n**Mission:** ${b.mission}\n\n**Output:**\n${b.output || '(No output)'}`,
      )
      .join('\n\n---\n\n');

    const synthesisPrompt = `You are the Lead Orchestrator synthesizing the work of your multi-agent team.

User's Original Request:
"${plan.user_prompt}"

Here is the work produced by your specialized team:
${botContributions}

Instructions:
Consolidate, integrate, and synthesize their outputs into one clean, polished, comprehensive final deliverable for the user.
- If code was produced, organize it logically with explanations.
- If research was conducted, integrate the insights directly.
- Ensure the final deliverable completely satisfies the user's original request.`;

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

  /**
   * One-shot convenience method: Prompt -> Auto-Plan Team -> Execute -> Deliverable
   */
  async runTask(
    userPrompt: string,
    callbacks?: SwarmExecutionCallbacks,
  ): Promise<SwarmRunResult> {
    const plan = await this.planTeam(userPrompt);
    return this.executeTeam(plan, callbacks);
  }
}

