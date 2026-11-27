export function renderLearning(tab, list, detail) {
  const { api, el, button, field, card, select, state } = window.studio;
  const lab = state.learning;
  const botSelect = () =>
    select(
      'Bot',
      state.knots.map((k) => [k.display_name || k.name, k.name]),
    );
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
    if (!['evaluate', 'improve'].includes(tab)) continue;
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
  if (!['evaluate', 'improve'].includes(tab))
    detail.append(el('p', 'Choose Create, Evaluate or Memory.'));
  list.append(
    el(
      'p',
      'Evaluations use immutable suite and bot snapshots. They never receive live action tools.',
      'muted',
    ),
  );
}
