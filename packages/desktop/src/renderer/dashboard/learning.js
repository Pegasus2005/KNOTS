export function renderLearning(tab, list, detail) {
  const { api, el, button, field, card, select, state } = window.studio;
  const lab = state.learning;
  const botSelect = () =>
    select(
      'Bot',
      state.knots.map((k) => [k.display_name || k.name, k.name]),
    );
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
    if (tab !== 'evaluate') continue;
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
  if (!['evaluate'].includes(tab)) detail.append(el('p', 'Choose Create, Evaluate or Memory.'));
  list.append(
    el(
      'p',
      'Evaluations use immutable suite and bot snapshots. They never receive live action tools.',
      'muted',
    ),
  );
}
