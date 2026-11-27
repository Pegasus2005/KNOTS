import { randomUUID } from 'node:crypto';
import type { EvaluationCase, EvaluationSuite, KnotSpec } from '@knots/types';
import type { KnotsCore } from './index.js';
import { fingerprint, boundedText } from './bot-creation.js';
import { KnotWorker } from './run/worker.js';
import { KnotTeaching } from './teaching.js';
import { callReceipts, type ProviderResolver } from './routing/router.js';

interface Attempt {
  key: string;
  caseId: string;
  strandId: string;
  variant: string;
  runId?: string;
  assessment?: 'pass' | 'fail' | 'unsure';
}
export interface EvaluationBatch {
  id: string;
  suite: EvaluationSuite;
  definitions: Record<string, KnotSpec>;
  strands: { id: string; hash: string; name: string }[];
  attempts: Attempt[];
  budgetUsd: number;
  maxCalls: number;
  cancelled: boolean;
  error?: string;
  createdAt: string;
  proposalId?: string;
}
export class LearningLab {
  constructor(
    private core: KnotsCore,
    private worker: KnotWorker,
    private resolve: ProviderResolver,
  ) {}
  private get db() {
    return this.core.database.getDb();
  }
  put<T extends { id: string }>(kind: string, value: T) {
    this.db
      .prepare(
        'INSERT INTO lab_records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE kind=excluded.kind',
      )
      .run(value.id, kind, JSON.stringify(value));
  }
  get<T>(kind: string, id: string): T {
    const row = this.db
      .prepare('SELECT data FROM lab_records WHERE id=? AND kind=?')
      .get(id, kind) as { data: string } | undefined;
    if (!row) throw new Error(`${kind} not found.`);
    return JSON.parse(row.data) as T;
  }
  records<T>(kind: string): T[] {
    return (
      this.db
        .prepare('SELECT data FROM lab_records WHERE kind=? ORDER BY rowid DESC')
        .all(kind) as { data: string }[]
    ).map((row) => JSON.parse(row.data) as T);
  }
  current(name: string) {
    if (!this.core.knots.list().includes(name)) throw new Error('Bot not found.');
    return this.core.knots.get(name, { resolveKnowledgeRefs: false })!.spec;
  }
  sourcePolicy(runId: string): KnotSpec[] {
    const snapshot = this.db.prepare('SELECT spec FROM run_snapshots WHERE run_id=?').get(runId) as
      { spec: string } | undefined;
    if (!snapshot) throw new Error('Source run has no policy snapshot.');
    const job = this.db.prepare('SELECT envelope FROM worker_jobs WHERE run_id=?').get(runId) as
      { envelope: string } | undefined;
    return [
      JSON.parse(snapshot.spec),
      ...(job ? (JSON.parse(job.envelope).input.constraints ?? []) : []),
    ];
  }
  saveSuite(input: {
    name: string;
    knotName: string;
    cases: EvaluationCase[];
    privacy: string;
    previousId?: string;
    approved: boolean;
  }) {
    if (input.approved !== true) throw new Error('Explicitly approve the evaluation cases.');
    const base = this.current(input.knotName);
    if (!Array.isArray(input.cases) || !input.cases.length || input.cases.length > 5)
      throw new Error('Use 1–5 cases per suite.');
    const policy: KnotSpec[] = [
      base,
      {
        ...base,
        tools: [],
        knowledge_refs: [],
        model_preferences: {
          privacy: input.privacy === 'local_only' ? 'local_only' : 'cloud_allowed',
        },
      },
    ];
    const seen = new Set<string>();
    const cases = input.cases.map((item): EvaluationCase => {
      if (!['improvement', 'holdout'].includes(item.split))
        throw new Error('Assign each case to improvement or holdout.');
      const id = item.id || randomUUID();
      if (seen.has(id)) throw new Error('Duplicate case ID.');
      seen.add(id);
      if (item.sourceRunId) policy.push(...this.sourcePolicy(item.sourceRunId));
      if (!Array.isArray(item.contains) || item.contains.length > 10)
        throw new Error('Use at most ten required substrings.');
      return {
        id,
        input: boundedText(item.input, 'Case input', 16000),
        criteria: boundedText(item.criteria, 'Criteria', 2000),
        split: item.split,
        contains: item.contains.map((v) => boundedText(v, 'Required text', 1000)),
        exact:
          item.exact === undefined ? undefined : boundedText(item.exact, 'Exact output', 16000),
        json: item.json === true,
        sourceRunId: item.sourceRunId,
      };
    });
    const previous = input.previousId
      ? this.get<EvaluationSuite>('suite', input.previousId)
      : undefined;
    if (previous && previous.knotName !== base.name)
      throw new Error('Suite revisions must use the same bot.');
    if (previous) policy.push(...previous.policy);
    const suite: EvaluationSuite = {
      id: randomUUID(),
      name: boundedText(input.name, 'Suite name', 120),
      knotName: base.name,
      version: (previous?.version ?? 0) + 1,
      previousId: previous?.id,
      cases,
      policy,
      botHash: fingerprint(base),
      createdAt: new Date().toISOString(),
    };
    this.put('suite', suite);
    return suite.id;
  }
  async evaluate(
    input: {
      suiteId: string;
      strandIds: string[];
      budgetUsd: number;
      maxCalls: number;
      proposalId?: string;
    },
    definitions?: Record<string, KnotSpec>,
    extraPolicies: KnotSpec[] = [],
  ) {
    const suite = this.get<EvaluationSuite>('suite', input.suiteId),
      base = this.current(suite.knotName);
    if (
      !Array.isArray(input.strandIds) ||
      !input.strandIds.length ||
      input.strandIds.length > 3 ||
      new Set(input.strandIds).size !== input.strandIds.length
    )
      throw new Error('Choose 1–3 distinct strands.');
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0 || input.budgetUsd > 100)
      throw new Error('Choose a batch budget between $0 and $100.');
    const variants = definitions ?? { current: base };
    const calls = suite.cases.length * input.strandIds.length * Object.keys(variants).length;
    if (
      !Number.isInteger(input.maxCalls) ||
      input.maxCalls < 1 ||
      input.maxCalls > 30 ||
      calls > input.maxCalls
    )
      throw new Error(`This comparison needs ${calls} calls; adjust the call limit (maximum 30).`);
    const policies = [base, ...suite.policy, ...Object.values(variants), ...extraPolicies];
    const evaluationSuite = { ...suite, policy: [...suite.policy, ...extraPolicies] };
    const strands = input.strandIds.map((id) => {
      const strand = this.core.strands.getById(id);
      if (!strand) throw new Error('Strand not found.');
      if (!strand.is_local && policies.some((p) => p.model_preferences?.privacy === 'local_only'))
        throw new Error('Local-only cases cannot be sent to a cloud strand.');
      if (
        !strand.is_local &&
        (strand.routing?.input_usd_per_million === undefined ||
          strand.routing?.output_usd_per_million === undefined)
      )
        throw new Error(
          'Configure pricing before budgeted evaluation. Unknown cost cannot be ranked as free.',
        );
      return { id, hash: fingerprint(strand), name: strand.name };
    });
    const batch: EvaluationBatch = {
      id: randomUUID(),
      suite: evaluationSuite,
      definitions: variants,
      strands,
      attempts: [],
      budgetUsd: input.budgetUsd,
      maxCalls: input.maxCalls,
      cancelled: false,
      createdAt: new Date().toISOString(),
      proposalId: input.proposalId,
    };
    for (const example of suite.cases)
      for (const strand of strands)
        for (const variant of Object.keys(variants))
          batch.attempts.push({
            key: randomUUID(),
            caseId: example.id,
            strandId: strand.id,
            variant,
          });
    this.put('evaluation', batch);
    await this.enqueue(batch.id);
    return batch.id;
  }
  async enqueue(id: string) {
    let batch = this.get<EvaluationBatch>('evaluation', id);
    if (batch.cancelled) throw new Error('This comparison was cancelled.');
    try {
      for (const attempt of batch.attempts) {
        batch = this.get<EvaluationBatch>('evaluation', id);
        if (batch.cancelled) return;
        const stored = batch.attempts.find((a) => a.key === attempt.key)!;
        if (stored.runId) continue;
        const strand = this.core.strands.getById(attempt.strandId),
          snapshot = batch.strands.find((s) => s.id === attempt.strandId)!;
        if (!strand || fingerprint(strand) !== snapshot.hash)
          throw new Error('A strand changed; start a fresh comparison.');
        const example = batch.suite.cases.find((c) => c.id === attempt.caseId)!,
          base = batch.definitions[attempt.variant];
        const runId = await this.worker.start(
          {
            submissionKey: `evaluation:${id}:${attempt.key}`,
            knot: {
              ...base,
              tools: [],
              integrations: undefined,
              knowledge_refs: [],
              model_preferences: {
                ...base.model_preferences,
                max_output_tokens: Math.min(
                  base.model_preferences?.max_output_tokens ?? 1024,
                  2048,
                ),
                max_cost_per_run: batch.budgetUsd / batch.attempts.length,
              },
            },
            constraints: [
              ...batch.suite.policy,
              this.current(batch.suite.knotName),
              ...Object.values(batch.definitions),
            ],
            purpose: 'evaluation',
            strand,
            pinnedStrandId: strand.id,
            prompt: example.input,
          },
          this.resolve,
        );
        // Reload after await so a concurrent cancellation/assessment is preserved.
        batch = this.get<EvaluationBatch>('evaluation', id);
        batch.attempts.find((a) => a.key === attempt.key)!.runId = runId;
        this.put('evaluation', batch);
        if (batch.cancelled) {
          this.worker.cancel(runId);
          return;
        }
      }
    } catch (error) {
      batch = this.get<EvaluationBatch>('evaluation', id);
      batch.error = error instanceof Error ? error.message : String(error);
      this.put('evaluation', batch);
      throw error;
    }
  }
  cancel(id: string) {
    const batch = this.get<EvaluationBatch>('evaluation', id);
    batch.cancelled = true;
    this.put('evaluation', batch);
    for (const a of batch.attempts) if (a.runId) this.worker.cancel(a.runId);
  }
  assess(id: string, key: string, assessment: string) {
    if (!['pass', 'fail', 'unsure'].includes(assessment)) throw new Error('Invalid assessment.');
    const batch = this.get<EvaluationBatch>('evaluation', id),
      attempt = batch.attempts.find((a) => a.key === key);
    if (!attempt?.runId || this.core.runs.getById(attempt.runId)?.status !== 'completed')
      throw new Error('Assess a completed result.');
    attempt.assessment = assessment as Attempt['assessment'];
    this.put('evaluation', batch);
  }
  result(batch: EvaluationBatch) {
    return {
      ...batch,
      stale: fingerprint(this.current(batch.suite.knotName)) !== batch.suite.botHash,
      attempts: batch.attempts.map((a) => {
        const run = a.runId ? this.core.runs.getById(a.runId) : undefined,
          example = batch.suite.cases.find((c) => c.id === a.caseId)!;
        const checks: { name: string; passed: boolean }[] = [];
        if (run?.status === 'completed') {
          for (const value of example.contains)
            checks.push({ name: `Contains ${value}`, passed: (run.output ?? '').includes(value) });
          if (example.exact !== undefined)
            checks.push({ name: 'Exact match', passed: run.output === example.exact });
          if (example.json) {
            let passed = true;
            try {
              JSON.parse(run.output ?? '');
            } catch {
              passed = false;
            }
            checks.push({ name: 'Valid JSON', passed });
          }
        }
        const verdict =
          run?.status !== 'completed'
            ? 'unverified'
            : checks.some((c) => !c.passed) || a.assessment === 'fail'
              ? 'fail'
              : a.assessment === 'pass'
                ? 'pass'
                : 'needs_review';
        return {
          ...a,
          run,
          example,
          checks,
          verdict,
          calls: a.runId ? callReceipts(this.core, a.runId) : [],
        };
      }),
    };
  }
  async propose(input: {
    runId: string;
    correction?: string;
    note: string;
    automatic?: boolean;
    budgetUsd: number;
  }) {
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0 || input.budgetUsd > 10)
      throw new Error('Choose an analysis budget from $0 to $10.');
    const run = this.core.runs.getById(input.runId);
    if (run?.status !== 'completed') throw new Error('Select a completed reusable-bot task.');
    const base = this.current(run.knot_name);
    const teaching = new KnotTeaching(this.core, this.worker, this.resolve);
    const changeId = await teaching.create({
      runId: run.id,
      exampleInput: run.input,
      correction: input.automatic
        ? 'No verified correction supplied. Identify a conservative possible improvement; it must be tested and reviewed. Do not assume the existing answer is correct.'
        : boundedText(input.correction, 'Correction'),
      note: boundedText(input.note, 'Improvement goal', 2000),
      budgetUsd: input.budgetUsd,
    });
    this.put('proposal', {
      id: changeId,
      automatic: input.automatic === true,
      deferred: false,
      sourceRunId: run.id,
      baseHash: fingerprint(base),
    });
    return changeId;
  }
  proposals() {
    const teaching = new KnotTeaching(this.core, this.worker, this.resolve);
    return this.records<{
      id: string;
      automatic: boolean;
      deferred: boolean;
      sourceRunId: string;
      baseHash: string;
    }>('proposal').map((meta) => {
      const change = teaching.list().find((c) => c.id === meta.id)!;
      let stale = true;
      try {
        stale =
          change.status === 'draft' &&
          fingerprint(this.current(change.knot_name)) !== meta.baseHash;
      } catch {}
      return { ...meta, ...change, stale };
    });
  }
  defer(id: string, deferred: boolean) {
    const proposal = this.get<{ id: string; deferred: boolean }>('proposal', id);
    proposal.deferred = deferred === true;
    this.put('proposal', proposal);
  }
  async evaluateProposal(input: {
    proposalId: string;
    suiteId: string;
    strandIds: string[];
    budgetUsd: number;
    maxCalls: number;
  }) {
    const proposal = this.proposals().find((p) => p.id === input.proposalId);
    if (!proposal || proposal.stale || !proposal.proposed || proposal.status !== 'draft')
      throw new Error('Select a current ready proposal.');
    const suite = this.get<EvaluationSuite>('suite', input.suiteId);
    if (suite.knotName !== proposal.knot_name) throw new Error('Choose a suite for this bot.');
    if (!suite.cases.some((c) => c.split === 'holdout'))
      throw new Error('Add a held-out case before comparing a proposal.');
    if (
      suite.cases.some(
        (c) =>
          c.split === 'holdout' &&
          (c.input === proposal.example_input || c.sourceRunId === proposal.source_run_id),
      )
    )
      throw new Error('A source correction cannot also be held-out evidence.');
    return this.evaluate(
      input,
      { before: proposal.base, after: { ...proposal.base, instructions: proposal.proposed } },
      this.sourcePolicy(proposal.source_run_id),
    );
  }
  decideProposal(id: string, action: string) {
    const proposal = this.proposals().find((p) => p.id === id);
    if (!proposal) throw new Error('Proposal not found.');
    if (action === 'accept') {
      if (proposal.stale) throw new Error('The bot changed; generate a fresh proposal.');
      const valid = this.records<EvaluationBatch>('evaluation')
        .filter(
          (b) =>
            b.proposalId === id &&
            !b.cancelled &&
            !b.error &&
            b.suite.cases.some((c) => c.split === 'holdout'),
        )
        .some((b) => {
          if (
            fingerprint(b.definitions.before) !== fingerprint(proposal.base) ||
            b.definitions.after.instructions !== proposal.proposed
          )
            return false;
          const attempts = this.result(b).attempts;
          return (
            attempts.length === b.attempts.length &&
            attempts.every(
              (a) =>
                a.run?.status === 'completed' &&
                a.assessment &&
                a.assessment !== 'unsure' &&
                (a.variant !== 'after' || a.verdict === 'pass'),
            )
          );
        });
      if (!valid)
        throw new Error(
          'Complete and assess a before/after comparison with passing candidate results and held-out evidence before accepting.',
        );
    }
    new KnotTeaching(this.core, this.worker, this.resolve).decide(id, action);
  }
  list() {
    return {
      proposals: this.proposals(),
      suites: this.records<EvaluationSuite>('suite'),
      evaluations: this.records<EvaluationBatch>('evaluation').map((b) => {
        try {
          return this.result(b);
        } catch {
          return { ...b, stale: true, attempts: [] };
        }
      }),
    };
  }
}
