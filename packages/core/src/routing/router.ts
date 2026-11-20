import { v4 as uuid } from 'uuid';
import type { KnotSpec, ModelProvider, ModelMessage, Strand, TokenUsage } from '@knots/types';
import type { KnotsCore } from '../index.js';

export type ProviderResolver = (strand: Strand) => Promise<ModelProvider>;
export type RouteStage = 'inspect' | 'deliver';

export interface CallReceipt {
  id: string;
  run_id: string;
  strand_id: string;
  strand_name: string;
  model: string;
  stage: RouteStage;
  reason: string;
  status: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  cost_source: 'unknown' | 'estimated' | 'usage';
  error: string | null;
}

export function callReceipts(core: KnotsCore, runId: string): CallReceipt[] {
  return core.database
    .getDb()
    .prepare('SELECT * FROM model_calls WHERE run_id = ? ORDER BY created_at, rowid')
    .all(runId) as CallReceipt[];
}

interface RoutedCall {
  runId: string;
  knot: KnotSpec;
  stage: RouteStage;
  pin?: string;
  messages: ModelMessage[];
  system: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  onReset: () => void;
  record: (message: string) => void;
}

const DEFAULT_MAX_OUTPUT = 2048;
const FALLBACK_CODES = new Set([
  'auth_error',
  'rate_limit',
  'model_not_found',
  'connection_error',
  'timeout',
  'context_length_exceeded',
  'server_error',
]);

function rates(strand: Strand): { input: number; output: number } | undefined {
  const config = strand.routing;
  if (config?.input_usd_per_million !== undefined && config.output_usd_per_million !== undefined) {
    return { input: config.input_usd_per_million, output: config.output_usd_per_million };
  }
  return strand.is_local ? { input: 0, output: 0 } : undefined;
}

function ruleFailure(knot: KnotSpec, strand: Strand, capabilities: string[]): string | undefined {
  if (knot.model_preferences?.privacy === 'local_only' && !strand.is_local)
    return 'local-only rule';
  for (const scope of ['provider', 'model', 'capability'] as const) {
    const rules = (knot.rules ?? []).filter((rule) => rule.scope === scope);
    const values = scope === 'capability' ? capabilities : [strand[scope]];
    if (rules.some((rule) => rule.type === 'deny' && values.includes(rule.value)))
      return `denied ${scope}`;
    const allow = rules.filter((rule) => rule.type === 'allow');
    if (allow.length && !allow.some((rule) => values.includes(rule.value)))
      return `outside allowed ${scope}`;
    if (rules.some((rule) => rule.type === 'require' && !values.includes(rule.value)))
      return `missing required ${scope}`;
  }
}

export class ModelRouter {
  constructor(
    private readonly core: KnotsCore,
    private readonly resolve: ProviderResolver,
  ) {}

  async call(input: RoutedCall): Promise<{ text: string; model: string }> {
    const { knot, stage, signal } = input;
    const maxOutput = knot.model_preferences?.max_output_tokens ?? DEFAULT_MAX_OUTPUT;
    const all = this.core.strands.getAll();
    const stageLane = knot.lanes?.[stage]?.length
      ? knot.lanes[stage]
      : (this.core.lanes.getByName(stage)?.strand_order ?? []);
    const defaults = knot.lanes?.default?.length
      ? knot.lanes.default
      : (this.core.lanes.getByName('default')?.strand_order ?? []);
    const workspaceDefault = this.core.settings.get('default_strand_id');
    const order = [
      ...new Set([
        ...stageLane,
        ...defaults,
        ...all
          .filter((strand) => strand.id === workspaceDefault || strand.is_default)
          .map((strand) => strand.name),
        ...all.map((strand) => strand.name),
      ]),
    ];
    const candidates = input.pin
      ? all.filter((strand) => strand.id === input.pin)
      : order.map((name) => all.find((strand) => strand.name === name)!).filter(Boolean);
    // Count bytes and framing conservatively when no tokenizer is available.
    const inputEstimate =
      new TextEncoder().encode(input.system + JSON.stringify(input.messages)).length +
      128 * (input.messages.length + 1);
    const receipts = callReceipts(this.core, input.runId);
    let reserved = receipts.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
    const rejected: string[] = [];
    const eligible: { strand: Strand; provider: ModelProvider; score: number }[] = [];

    for (const strand of candidates) {
      signal.throwIfAborted();
      // Filter privacy before resolving credentials or constructing an adapter.
      if (knot.model_preferences?.privacy === 'local_only' && !strand.is_local) {
        rejected.push(`${strand.name}: local-only rule`);
        continue;
      }
      try {
        const provider = await this.resolve(strand);
        const capabilities = [
          ...new Set([...strand.capabilities, ...(provider.getCapabilities?.(strand.model) ?? [])]),
        ];
        const failure = ruleFailure(knot, strand, capabilities);
        if (failure) {
          rejected.push(`${strand.name}: ${failure}`);
          continue;
        }
        if (
          strand.routing?.context_window &&
          inputEstimate + maxOutput > strand.routing.context_window
        ) {
          rejected.push(`${strand.name}: configured context window is too small`);
          continue;
        }
        const preferred = knot.model_preferences;
        const score =
          (preferred?.privacy === 'local_preferred' && strand.is_local ? 100 : 0) +
          (stageLane.includes(strand.name) ? 50 : 0) +
          (preferred?.preferred_provider === strand.provider ? 10 : 0) +
          (preferred?.preferred_model === strand.model ? 10 : 0) +
          (preferred?.preferred_capability ?? []).filter((capability) =>
            capabilities.includes(capability),
          ).length;
        eligible.push({ strand, provider, score });
      } catch (error) {
        signal.throwIfAborted();
        rejected.push(`${strand.name}: connection could not be prepared`);
      }
    }
    eligible.sort((a, b) => {
      const rank = (name: string) => {
        const stageIndex = stageLane.indexOf(name);
        if (stageIndex >= 0) return stageIndex;
        const defaultIndex = defaults.indexOf(name);
        return defaultIndex >= 0 ? stageLane.length + defaultIndex : Number.MAX_SAFE_INTEGER;
      };
      const aRank = rank(a.strand.name);
      const bRank = rank(b.strand.name);
      return aRank - bRank || b.score - a.score;
    });
    for (const rejection of rejected) input.record(`Routing skipped · ${rejection}`);

    for (const { strand, provider } of eligible) {
      signal.throwIfAborted();
      const price = rates(strand);
      const estimate = price
        ? (inputEstimate * price.input + maxOutput * price.output) / 1e6
        : null;
      if (estimate !== null && !Number.isFinite(estimate)) {
        rejected.push(`${strand.name}: configured prices produce an invalid estimate`);
        continue;
      }
      const budget = knot.model_preferences?.max_cost_per_run;
      if (budget !== undefined && (estimate === null || reserved + estimate > budget + 1e-12)) {
        rejected.push(
          `${strand.name}: ${estimate === null ? 'pricing required for budget enforcement' : 'run budget would be exceeded'}`,
        );
        input.record(`Routing skipped · ${rejected[rejected.length - 1]}`);
        continue;
      }
      const id = uuid();
      const reason = input.pin
        ? 'Explicit run override'
        : stageLane.includes(strand.name)
          ? `Ordered ${stage} lane`
          : knot.model_preferences?.privacy === 'local_preferred' && strand.is_local
            ? 'Local preference'
            : 'Eligible model preference or workspace default';
      const db = this.core.database.getDb();
      db.prepare(
        "INSERT INTO model_calls (id, run_id, strand_id, strand_name, model, stage, reason, status, cost_usd, cost_source) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)",
      ).run(
        id,
        input.runId,
        strand.id,
        strand.name,
        strand.model,
        stage,
        reason,
        estimate,
        estimate === null ? 'unknown' : 'estimated',
      );
      const run = this.core.runManager.getContext(input.runId)!;
      run.strandId = strand.id;
      run.strandName = strand.name;
      this.core.runs.update(input.runId, {
        strand_id: strand.id,
        strand_name: strand.name,
        model_used: strand.model,
      });
      input.record(`Route · ${stage} → ${strand.name} · ${reason}`);

      let text = '';
      let usage: TokenUsage | undefined;
      let model = strand.model;
      try {
        for await (const chunk of provider.sendMessage({
          model,
          system: input.system,
          messages: input.messages,
          max_tokens: maxOutput,
          stream: true,
          signal,
        })) {
          signal.throwIfAborted();
          text += chunk.delta;
          if (chunk.delta) input.onDelta(chunk.delta);
          // Providers report cumulative usage, not per-chunk increments.
          if (
            chunk.usage &&
            [chunk.usage.prompt_tokens, chunk.usage.completion_tokens].every(
              (value) => Number.isFinite(value) && value >= 0,
            )
          )
            usage = chunk.usage;
          model = chunk.model ?? model;
          if (chunk.finish_reason === 'length')
            throw new Error('The model reached the output limit.');
        }
        if (!text.trim()) throw new Error('The model returned an empty response.');
        const cost =
          price && usage
            ? (usage.prompt_tokens * price.input + usage.completion_tokens * price.output) / 1e6
            : estimate;
        db.prepare(
          "UPDATE model_calls SET status = 'completed', model = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?, cost_source = ? WHERE id = ?",
        ).run(
          model,
          usage?.prompt_tokens ?? null,
          usage?.completion_tokens ?? null,
          cost,
          usage && price ? 'usage' : cost === null ? 'unknown' : 'estimated',
          id,
        );
        this.updateTotals(input.runId);
        if (
          budget !== undefined &&
          callReceipts(this.core, input.runId).reduce(
            (sum, call) => sum + (call.cost_usd ?? 0),
            0,
          ) >
            budget + 1e-12
        ) {
          throw new Error(
            'Reported usage exceeded the run budget. No further model or tool action will run.',
          );
        }
        return { text, model };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Failed attempts keep the reserved estimate if billing usage is unavailable.
        db.prepare('UPDATE model_calls SET status = ?, error = ? WHERE id = ?').run(
          signal.aborted ? 'cancelled' : 'failed',
          message,
          id,
        );
        this.updateTotals(input.runId);
        signal.throwIfAborted();
        const code = (error as { code?: string })?.code;
        if (input.pin || !code || !FALLBACK_CODES.has(code)) throw error;
        reserved += estimate ?? 0;
        rejected.push(`${strand.name}: ${code}`);
        input.record(`Fallback · ${strand.name} failed (${code}); retrying only this model call`);
        input.onReset();
      }
    }
    throw new Error(
      `No eligible strand for ${stage}. ${rejected.join('; ') || 'Connect a model first.'}`,
    );
  }

  private updateTotals(runId: string): void {
    const calls = callReceipts(this.core, runId);
    const tokensIn = calls.reduce((sum, call) => sum + (call.tokens_in ?? 0), 0);
    const tokensOut = calls.reduce((sum, call) => sum + (call.tokens_out ?? 0), 0);
    const cost = calls.every((call) => call.cost_usd !== null)
      ? calls.reduce((sum, call) => sum + call.cost_usd!, 0)
      : undefined;
    const run = this.core.runManager.getContext(runId);
    if (run) {
      run.tokensIn = tokensIn;
      run.tokensOut = tokensOut;
      run.cost = cost;
    }
    this.core.runs.update(runId, {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost: cost ?? null,
    });
  }
}
