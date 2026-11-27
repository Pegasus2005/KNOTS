const reviewedRecommendations = new Map();
let exportedPlaybook = '';
export function renderLearning(tab, list, detail) {
  const { api, el, button, field, card, select, state } = window.studio;
  const lab = state.learning;
  const botSelect = () =>
    select(
      'Bot',
      state.knots.map((k) => [k.display_name || k.name, k.name]),
    );
  if (tab === 'models') {
    const form = card('Audition models on the same cases'),
      suite = select(
        'Approved suite',
        lab.suites.map((s) => [s.name, s.id]),
      ),
      models = state.strands.map((s) => [`${s.name} · ${s.model}`, s.id]),
      first = select('First model', models),
      second = select('Second model', models),
      third = select('Optional third model', [['None', ''], ...models]),
      budget = field('Maximum batch budget USD', '0');
    if (models.length > 1) second.input.value = models[1][1];
    form.append(
      suite.wrapper,
      first.wrapper,
      second.wrapper,
      third.wrapper,
      budget.wrapper,
      el(
        'p',
        'Up to three eligible models. Cloud pricing is required. Elapsed time includes queueing; this is not a controlled provider-latency benchmark. Review each result before recommending a model.',
        'muted',
      ),
      button(
        'Start bounded audition',
        () =>
          api.labEvaluate({
            suiteId: suite.input.value,
            strandIds: [first.input.value, second.input.value, third.input.value].filter(Boolean),
            budgetUsd: Number(budget.input.value),
            maxCalls: 15,
          }),
        true,
      ),
    );
    detail.append(form);
    for (const report of lab.auditions) {
      const n = card(
        `${report.knotName || 'Audition'} · ${report.stale ? 'stale' : 'evidence ready for review'}`,
      );
      for (const model of report.candidates)
        n.append(
          el(
            'p',
            `${model.name}: ${model.passed ? 'all cases passed' : model.reviewed ? 'reviewed, not passing' : 'needs completed results and assessment'} · Cost ${model.costUsd === undefined ? 'unknown' : model.costUsd.toFixed(6) + ' USD'} · Mean run elapsed ${model.elapsedMs ?? '?'} ms`,
          ),
        );
      const priority = select('Optimize', [
          ['Quality', 'quality'],
          ['Cost', 'cost'],
          ['Elapsed time', 'latency'],
        ]),
        stage = select('Apply preference to', [
          ['Delivery', 'deliver'],
          ['Inspection', 'inspect'],
          ['Both stages', 'both'],
        ]);
      n.append(
        priority.wrapper,
        stage.wrapper,
        button('Review recommendation', async () => {
          const recommendation = await api.labRecommend(report.id, priority.input.value);
          reviewedRecommendations.set(report.id, recommendation);
        }),
      );
      const reviewed = reviewedRecommendations.get(report.id);
      if (reviewed)
        n.append(
          el('p', `${reviewed.name}: ${reviewed.reason}`),
          button(
            'Apply this reviewed preference',
            () => api.labApply(report.id, reviewed.strandId, reviewed.priority, stage.input.value),
            true,
          ),
        );
      detail.append(n);
    }
  }
  if (tab === 'playbook') {
    const entries = state.playbooks.entries,
      editing = entries.find((e) => e.id === window.studio.selected);
    const n = card(editing ? 'Revise guidance' : 'Add scoped guidance'),
      bot = botSelect(),
      kind = select('Kind', [
        ['Preference', 'preference'],
        ['Lesson', 'lesson'],
        ['Procedure', 'procedure'],
      ]),
      scope = field('Scope keywords (* for all tasks of this bot)', editing?.scope || ''),
      content = field('Guidance', editing?.content || '', true),
      source = field('Source run ID (optional)', editing?.sourceRunId || ''),
      steps = field(
        'Procedure steps · JSON array',
        JSON.stringify(editing?.steps || [], null, 2),
        true,
      );
    if (editing) {
      bot.input.value = editing.knotName;
      kind.input.value = editing.kind;
    }
    n.append(
      bot.wrapper,
      kind.wrapper,
      scope.wrapper,
      content.wrapper,
      source.wrapper,
      steps.wrapper,
      el(
        'p',
        'Guidance cannot grant tools or override your task. Conflicting active entries require explicit revision. Forgetting stops future retrieval; earlier run checkpoints retain their evidence.',
        'muted',
      ),
      button(
        'Review and save active guidance',
        () =>
          api.playbooksSave({
            knotName: bot.input.value,
            kind: kind.input.value,
            scope: scope.input.value,
            content: content.input.value,
            sourceRunId: source.input.value || undefined,
            steps: JSON.parse(steps.input.value),
            supersedes: editing?.id,
            enabled: true,
          }),
        true,
      ),
    );
    detail.append(n);
    for (const entry of entries) {
      const row = card(
        `${entry.knotName} · ${entry.kind} · v${entry.version} · ${entry.enabled ? 'active' : 'disabled'}`,
      );
      row.append(
        el(
          'p',
          `Scope: ${entry.scope} · ${entry.imported ? 'imported, untrusted' : 'locally reviewed'} · Source ${entry.sourceRunId || 'manual'}`,
        ),
        el('pre', entry.content),
        button('Revise', () => {
          window.studio.selected = entry.id;
        }),
        button(entry.enabled ? 'Disable' : 'Enable after review', () =>
          api.playbooksEnable(entry.id, !entry.enabled),
        ),
        button('Forget', () => api.playbooksForget(entry.id)),
        button('Review and export this entry', async () => {
          exportedPlaybook = JSON.stringify(await api.playbooksExport([entry.id], true), null, 2);
        }),
      );
      if (entry.kind === 'procedure') {
        const fixture = field(
          'Isolated fixture · files and exact expected outputs',
          JSON.stringify(
            { files: { 'input.txt': 'Example' }, expected: { 'report.md': 'Summary' } },
            null,
            2,
          ),
          true,
        );
        row.append(
          el(
            'p',
            'Runs a deterministic virtual-file simulation only. No filesystem, network or real tool effects.',
            'muted',
          ),
          fixture.wrapper,
          button('Test virtual procedure', () =>
            api.playbooksFixture(entry.id, JSON.parse(fixture.input.value)),
          ),
        );
        for (const result of state.playbooks.fixtures.filter((f) => f.entryId === entry.id))
          row.append(
            el('p', `${result.passed ? 'Fixture passed' : 'Fixture failed'} · ${result.scope}`),
            el(
              'pre',
              JSON.stringify(
                { checks: result.checks, error: result.error, transcript: result.transcript },
                null,
                2,
              ),
            ),
          );
      }
      detail.append(row);
    }
    const sharing = card('Review portable guidance'),
      out = field('Selected export · inspect for sensitive content', exportedPlaybook, true),
      incoming = field('Paste a playbook package to review', '', true),
      target = botSelect();
    sharing.append(
      out.wrapper,
      target.wrapper,
      incoming.wrapper,
      el(
        'p',
        'Import creates disabled, local-only, untrusted entries without grants or credentials. Inspect before enabling.',
        'muted',
      ),
      button('I reviewed this package: import disabled', () =>
        api.playbooksImport(target.input.value, JSON.parse(incoming.input.value), true),
      ),
    );
    detail.append(sharing);
  }
  if (tab === 'improve') {
    const form = card('Teach from a completed run');
    const eligible = state.runs.filter(
      (r) =>
        r.status === 'completed' &&
        r.purpose === 'task' &&
        state.knots.some((k) => k.name === r.knot_name),
    );
    const source = select(
        'Source task',
        eligible.map((r) => [`${r.knot_name}: ${r.input.slice(0, 60)}`, r.id]),
      ),
      note = field('What should improve?', '', true),
      correction = field('Your corrected result (leave blank for opt-in analysis)', '', true),
      budget = field('Maximum analysis budget USD', '0');
    form.append(
      source.wrapper,
      note.wrapper,
      correction.wrapper,
      budget.wrapper,
      el(
        'p',
        'Analyze only the selected run. Automatic analysis is a hypothesis, not verified learning. It never sees held-out cases and never adopts a change.',
        'muted',
      ),
      button(
        'Propose from my correction',
        () =>
          api.labPropose({
            runId: source.input.value,
            note: note.input.value,
            correction: correction.input.value,
            budgetUsd: Number(budget.input.value),
          }),
        true,
      ),
      button('Opt in: analyze selected run', () =>
        api.labPropose({
          runId: source.input.value,
          note: note.input.value,
          automatic: true,
          budgetUsd: Number(budget.input.value),
        }),
      ),
    );
    detail.append(form);
    for (const proposal of lab.proposals ?? []) {
      const n = card(
        `${proposal.knot_name} · ${proposal.stale ? 'stale' : proposal.state}${proposal.deferred ? ' · deferred' : ''}`,
      );
      n.append(
        el(
          'p',
          `${proposal.automatic ? 'Model-suggested hypothesis' : 'User correction'} · Source ${proposal.source_run_id}`,
        ),
        el('pre', proposal.note),
        el('h3', 'Current / base instructions'),
        el('pre', proposal.base.instructions),
        el('h3', 'Proposed instructions'),
        el(
          'pre',
          proposal.proposed || proposal.generation?.error || proposal.generation?.status || '',
        ),
      );
      if (proposal.status === 'draft') {
        n.append(
          button(proposal.deferred ? 'Return to inbox' : 'Defer', () =>
            api.labDefer(proposal.id, !proposal.deferred),
          ),
          button('Reject', () => api.labDecideProposal(proposal.id, 'reject')),
        );
        if (proposal.proposed && !proposal.stale) {
          const suite = select(
              'Approved suite (must include held-out cases)',
              lab.suites
                .filter((s) => s.knotName === proposal.knot_name)
                .map((s) => [s.name, s.id]),
            ),
            strand = select(
              'Comparison model',
              state.strands.map((s) => [s.name, s.id]),
            ),
            cost = field('Maximum comparison budget USD', '0');
          n.append(
            suite.wrapper,
            strand.wrapper,
            cost.wrapper,
            button('Compare before and after', () =>
              api.labCompareProposal({
                proposalId: proposal.id,
                suiteId: suite.input.value,
                strandIds: [strand.input.value],
                budgetUsd: Number(cost.input.value),
                maxCalls: 10,
              }),
            ),
            button(
              'Accept tested change',
              () => api.labDecideProposal(proposal.id, 'accept'),
              true,
            ),
          );
        }
      }
      if (proposal.status === 'accepted')
        n.append(
          button('Revert accepted instructions', () =>
            api.labDecideProposal(proposal.id, 'revert'),
          ),
        );
      if (proposal.generation?.status === 'paused')
        n.append(button('Resume proposal', () => api.resumeRun(proposal.generation.id)));
      if (['running', 'queued'].includes(proposal.generation?.status))
        n.append(button('Cancel analysis', () => api.cancelRun(proposal.generation.id)));
      detail.append(n);
    }
  }
  if (tab === 'evaluate') {
    const create = card('Save a reusable evaluation suite'),
      name = field('Suite name'),
      bot = botSelect(),
      privacy = select('Case privacy', [
        ['Local only', 'local_only'],
        ['Cloud allowed', 'cloud_allowed'],
      ]);
    const cases = field(
      'Cases · JSON array',
      JSON.stringify(
        [
          {
            input: 'Write a short report',
            split: 'improvement',
            criteria: 'Clear sections',
            contains: ['Summary'],
          },
          {
            input: 'Write a weekly update',
            split: 'holdout',
            criteria: 'Clear sections',
            contains: ['Summary'],
          },
        ],
        null,
        2,
      ),
      true,
    );
    create.append(
      name.wrapper,
      bot.wrapper,
      privacy.wrapper,
      cases.wrapper,
      el(
        'p',
        'Review and approve these cases. Held-out inputs and answers never enter improvement generation. Text-only evaluations disable tools; passing assertions still needs your assessment.',
        'muted',
      ),
      button(
        'Approve and save cases',
        () =>
          api.labSaveSuite({
            name: name.input.value,
            knotName: bot.input.value,
            cases: JSON.parse(cases.input.value),
            privacy: privacy.input.value,
            approved: true,
          }),
        true,
      ),
    );
    detail.append(create);
    for (const suite of lab.suites) {
      const n = card(`${suite.name} · version ${suite.version}`),
        strand = select(
          'Model',
          state.strands.map((s) => [`${s.name} · ${s.model}`, s.id]),
        ),
        budget = field('Maximum batch budget USD (pricing required for cloud)', '0');
      n.append(
        el('p', `${suite.knotName} · ${suite.cases.length} approved cases`),
        el('pre', JSON.stringify(suite.cases, null, 2)),
        strand.wrapper,
        budget.wrapper,
        button(
          `Run ${suite.cases.length} text evaluations`,
          () =>
            api.labEvaluate({
              suiteId: suite.id,
              strandIds: [strand.input.value],
              budgetUsd: Number(budget.input.value),
              maxCalls: suite.cases.length,
            }),
          true,
        ),
      );
      detail.append(n);
    }
  }
  for (const batch of lab.evaluations ?? []) {
    if (!['evaluate', 'improve', 'models'].includes(tab)) continue;
    if (tab === 'models' && batch.strands.length < 2) continue;
    const n = card(`${batch.suite.name} · ${batch.cancelled ? 'cancelled' : 'comparison'}`);
    n.append(
      el(
        'p',
        `Budget $${batch.budgetUsd} · ${batch.attempts.length} calls · ${batch.stale ? 'bot changed since suite creation' : 'current suite definition'}`,
      ),
    );
    if (batch.error) n.append(el('p', batch.error, 'notice error'));
    n.append(
      button('Cancel remaining work', () => api.labCancel(batch.id)),
      button('Finish enqueueing after interruption', () => api.labEnqueue(batch.id)),
    );
    for (const a of batch.attempts) {
      n.append(
        el(
          'h3',
          `${a.variant} · ${a.example.split} · ${a.run?.status || 'not queued'} · ${a.verdict}`,
        ),
        el('p', a.example.criteria),
        el('pre', a.run?.output || a.run?.error || ''),
        el('p', a.checks.map((c) => `${c.passed ? '✓' : '×'} ${c.name}`).join(' · ')),
        el(
          'p',
          `Latency ${a.run?.duration_ms ?? '?'} ms · Cost ${a.calls.some((c) => c.cost_usd === null) ? 'unknown' : a.calls.reduce((v, c) => v + (c.cost_usd ?? 0), 0).toFixed(6)} USD`,
        ),
      );
      if (a.run?.status === 'completed')
        for (const grade of ['pass', 'fail', 'unsure'])
          n.append(button(`Assess ${grade}`, () => api.labAssess(batch.id, a.key, grade)));
      if (a.run?.status === 'paused')
        n.append(button('Resume evaluation', () => api.resumeRun(a.run.id)));
    }
    detail.append(n);
  }
  if (!['evaluate', 'improve', 'playbook', 'models'].includes(tab))
    detail.append(el('p', 'Choose Create, Evaluate or Memory.'));
  list.append(
    el(
      'p',
      'Evaluations use immutable suite and bot snapshots. They never receive live action tools.',
      'muted',
    ),
  );
}
