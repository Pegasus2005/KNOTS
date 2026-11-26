const api = window.knots;
const $ = (id) => document.getElementById(id);
const strandSelect = $('run-strand');
const providerSelect = $('provider');
const strandDialog = $('strand-dialog');
const nav = [...document.querySelectorAll('[data-view]')];
const tests = new Map();
let workspace = { knots: [], strands: [], runs: [] };
let selectedConversationId;
let conversationCache;
let conversationVersion = 0;
let conversationsSignature = '';
let historySignature = '';
let lastDisplayedRun;
let firstRefresh = true;
const isGlassbar = new URLSearchParams(location.search).get('surface') === 'glassbar';
document.body.classList.toggle('glassbar', isGlassbar);
$('glassbar-controls').hidden = !isGlassbar;
let activeRun;
let submitting = false;
let jobSignature = '';
let previewVersion = 0;
let pendingRemoval;
let grantedFolder;
let outputFolder;
let proposalSignature = '';
let callsSignature = '';
let routingStrand;
let selectedRunId;
let polling = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function action(text, handler, className = 'button quiet') {
  const button = element('button', text, className);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function message(id, text = '') {
  const target = $(id);
  target.textContent = text;
  target.hidden = !text;
}

function showView(view) {
  for (const button of nav) {
    const name = button.dataset.view;
    $(`view-${name}`).hidden = name !== view;
    if (name === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  $('breadcrumb').textContent =
    {
      run: 'KNOTS',
      plans: 'Task plans',
      strands: 'Connections',
    }[view] || view;
  message('workspace-error');
}

function options(select, first, items, value) {
  select.replaceChildren(
    new Option(first, ''),
    ...items.map(([label, id]) => new Option(label, id)),
  );
  if (items.some(([, id]) => id === value)) select.value = value;
}

function updateRunControls() {
  const running = submitting;
  strandSelect.disabled = running || !workspace.strands.length;
  $('prompt').readOnly = running;
  $('choose-output').disabled = running;
  $('choose-folder').disabled = running;
  $('submit-run').disabled =
    running ||
    Boolean(
      selectedConversationId &&
      workspace.runs.some(
        (run) =>
          run.conversationId === selectedConversationId &&
          !['completed', 'failed', 'cancelled'].includes(run.status),
      ),
    ) ||
    workspace.worker?.enabled === false ||
    !workspace.strands.length;
  $('cancel-run').hidden = !activeRun?.id || !['running', 'queued'].includes(workspace.runs.find((r) => r.id === activeRun.id)?.status || '');
  $('run-add-strand').hidden = Boolean(workspace.strands.length);
  $('run-setup').hidden = Boolean(workspace.strands.length);
}

async function updatePreview() {
  const version = ++previewVersion;
  const override = strandSelect.value;
  const summary = $('route-summary');
  summary.textContent = '';
  if (!workspace.strands.length) return;

  try {
    if (!override) {
      summary.textContent = 'Auto · provisions parallel agents as needed';
      return;
    }
    if (version !== previewVersion) return;
    const strand = workspace.strands.find((item) => item.id === override);
    if (strand) {
      summary.textContent = `${strand.name} · ${strand.model}${strand.is_local ? ' · Local' : ' · Remote'}`;
    }
  } catch (error) {
    if (version === previewVersion) summary.textContent = error.message;
  }
}

function renderStrands() {
  const list = $('strand-list');
  list.replaceChildren();
  if (!workspace.strands.length) {
    list.append(element('p', 'No model connections yet. Add a strand to run a knot.', 'muted'));
  }
  for (const strand of workspace.strands) {
    const card = element('article', undefined, 'card');
    const heading = element('div', undefined, 'card-heading');
    heading.append(element('h3', strand.name));
    if (workspace.defaultStrandId === strand.id) heading.append(element('span', 'Default', 'pill'));
    if (strand.is_local) heading.append(element('span', 'Local', 'pill connected'));
    card.append(heading, element('p', `${strand.provider} · ${strand.model}`, 'muted'));
    if (strand.endpoint) card.append(element('p', strand.endpoint, 'muted'));
    const actions = element('div', undefined, 'actions');
    const test = tests.get(strand.id);
    const feedback = element(
      'p',
      test?.text || '',
      `connection-result ${test?.failed ? 'notice error' : 'muted'}`,
    );
    feedback.setAttribute('role', 'status');
    const testButton = action(
      test?.pending ? 'Testing…' : 'Test connection',
      () => void testConnection(strand.id),
    );
    testButton.disabled = Boolean(test?.pending);
    actions.append(
      action('Use as default', async () => {
        try {
          await api.setDefaultStrand(strand.id);
          await refresh();
        } catch (error) {
          message('workspace-error', error.message);
        }
      }),
      testButton,
      action('Context & pricing', () => openRoutingDialog(strand)),
      action('Remove', () => {
        pendingRemoval = strand;
        $('remove-dialog').returnValue = '';
        $('remove-description').textContent = strand.references.length
          ? `${strand.name} is used by ${strand.references.join(', ')}. Those definitions will keep their references.`
          : `Remove ${strand.name} from this workspace?`;
        $('remove-dialog').showModal();
      }),
    );
    card.append(actions, feedback);
    list.append(card);
  }
}

async function testConnection(id) {
  tests.set(id, { pending: true, text: 'Checking the endpoint…' });
  renderStrands();
  try {
    const result = await api.testStrand(id);
    tests.set(id, {
      text: result.success ? 'Connection verified.' : result.error || 'Connection failed.',
      failed: !result.success,
    });
  } catch (error) {
    tests.set(id, { text: error.message, failed: true });
  }
  renderStrands();
}

function renderSubRuns(run) {
  const list = $('sub-runs');
  if (!list) return;
  list.replaceChildren();
  const subs = run.subRuns || [];
  if (!subs.length) return;
  const heading = element('p', `Parallel agents (${subs.length}):`, 'muted');
  list.append(heading);
  for (const sub of subs) {
    const label = sub.knot_name.replace(/^auto-/, '');
    list.append(
      element(
        'p',
        `${label} · ${sub.status.replaceAll('_', ' ')}${sub.model_used ? ' · ' + sub.model_used : ''}`,
        'muted',
      ),
    );
  }
  if (run.peerMessages?.length) {
    const peers = element('details');
    peers.append(
      element('summary', `Peer messages (${run.peerMessages.length})`),
      ...run.peerMessages.map((msg) =>
        element('p', `${msg.from_task_id} → ${msg.to_task_id || '@all'}: ${msg.body}`, 'muted'),
      ),
    );
    list.append(peers);
  }
}

function renderProposals(run) {
  const proposals = run.proposals ?? [];
  const signature = JSON.stringify([proposals, run.status, run.job?.needsAccess]);
  if (signature === proposalSignature) return;
  proposalSignature = signature;
  const list = $('run-proposals');
  list.replaceChildren();
  for (const proposal of proposals) {
    const item = element('section', undefined, 'proposal');
    item.append(
      element(
        'h3',
        proposal.state === 'pending' ? 'Review proposed file' : `File · ${proposal.state}`,
      ),
    );
    item.append(element('p', proposal.destination, 'muted'));
    const details = element('details');
    details.open = proposal.state === 'pending';
    details.append(
      element('summary', 'Exact file contents'),
      element('pre', proposal.content, 'proposal-content'),
    );
    item.append(details);
    if (proposal.error) item.append(element('p', proposal.error, 'notice error'));
    if (proposal.state === 'pending' && run.status === 'waiting_approval') {
      const controls = element('div', undefined, 'setup');
      for (const [label, approve] of [
        ['Approve and create', true],
        ['Reject', false],
      ]) {
        controls.append(
          action(
            label,
            async (event) => {
              event.currentTarget.disabled = true;
              try {
                await api.decideAction(proposal.id, approve);
                await pollRuns();
              } catch (error) {
                message('workspace-error', error.message);
                event.currentTarget.disabled = false;
              }
            },
            `button ${approve ? 'primary' : 'quiet'}`,
          ),
        );
      }
      item.append(controls);
    }
    if (proposal.state === 'uncertain' && run.status === 'paused') {
      for (const [label, mode] of [
        ['Verify existing file', 'verify'],
        ['Confirm absent and request fresh approval', 'retry'],
      ]) {
        item.append(
          action(label, () =>
            jobAction(async () => {
              const grants = await renewJobGrants(run);
              await api.reconcileAction(run.id, proposal.id, mode, grants);
            }),
          ),
        );
      }
    }
    list.append(item);
  }
}

function renderCalls(run) {
  const calls = run.calls ?? [];
  const signature = JSON.stringify(calls);
  if (signature === callsSignature) return;
  callsSignature = signature;
  const list = $('model-calls');
  list.replaceChildren();
  if (!calls.length) return;
  list.append(element('h3', 'Models and usage'));
  for (const call of calls) {
    const row = element('div', undefined, 'model-call');
    row.append(element('p', `${call.stage} → ${call.strand_name} · ${call.model}`));
    const usage =
      call.tokens_in === null
        ? 'Usage unavailable'
        : `${call.tokens_in} input / ${call.tokens_out ?? 0} output tokens`;
    const price =
      call.cost_usd === null
        ? 'Cost unknown'
        : `$${call.cost_usd.toFixed(6)} · ${call.cost_source === 'usage' ? 'configured rates × reported usage' : 'estimated API cost'}`;
    row.append(element('p', `${call.reason} · ${call.status} · ${usage} · ${price}`, 'muted'));
    if (call.error) row.append(element('p', call.error, 'muted'));
    list.append(row);
  }
}

function displayRun(run) {
  const scroll = $('chat-scroll');
  const follow =
    lastDisplayedRun !== run.id ||
    scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 100;
  lastDisplayedRun = run.id;
  selectedConversationId = run.conversationId || undefined;
  if (selectedConversationId && conversationCache?.id !== selectedConversationId)
    void loadConversation(selectedConversationId);
  if (conversationCache?.id === selectedConversationId) {
    const index = conversationCache.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) conversationCache.runs[index] = run;
  }
  renderConversationHistory(run.id);
  $('chat-welcome').hidden = true;
  $('current-user-message').hidden = false;
  $('current-user-message').textContent = run.input;
  $('result-title').textContent =
    run.knot_name === 'auto'
      ? 'Autonomous team'
      : workspace.knots.find((knot) => knot.name === run.knot_name)?.display_name || run.knot_name;

  $('teach-run').hidden =
    run.knot_name === 'auto' || run.status !== 'completed' || run.purpose !== 'task';
  $('teach-run').onclick = () => openTeaching(run.knot_name, run);
  $('run-activity').textContent = (run.activity || []).join('\n');
  message('result-model', [run.strand_name, run.model_used].filter(Boolean).join(' · '));
  showOutput(run.output || run.error || (run.status === 'running' ? 'Working…' : ''));
  if (run.error && run.output) showOutput(run.output + '\n\n' + run.error);
  setRunStatus(run.status[0].toUpperCase() + run.status.slice(1).replaceAll('_', ' '), run.status);
  renderSubRuns(run);
  renderMcpActions(run);
  renderJobControls(run);
  renderProposals(run);
  renderCalls(run);
  if (follow)
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight;
    });
  activeRun = ['running', 'queued', 'waiting_approval'].includes(run.status)
    ? { id: run.id }
    : undefined;
  updateRunControls();
}

async function pollRuns() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const data = await api.workspace();
    workspace.conversations = data.conversations;
    renderConversations();
    workspace.runs = data.runs;
    workspace.worker = data.worker;
    workspace.plans = data.plans;
    workspace.mcpServers = data.mcpServers;
    renderPlans();
    renderWorker();
    const run = workspace.runs.find((item) => item.id === (selectedRunId || activeRun?.id));
    if (run) displayRun(run);
  } catch (error) {
    message('workspace-error', error.message);
  } finally {
    polling = false;
  }
}

async function refresh() {
  try {
    workspace = await api.workspace();
    const count = workspace.strands.length;
    $('connection-count').textContent = `${count} saved ${count === 1 ? 'strand' : 'strands'}`;
    options(
      strandSelect,
      'Auto · best model per agent',
      workspace.strands.map((strand) => [`${strand.name} · ${strand.model}`, strand.id]),
      strandSelect.value,
    );
    renderConversations();
    renderWorker();
    renderPlans();
    renderStrands();
    renderMcpServers();
    updateRunControls();
    void updatePreview();
    const running = workspace.runs.find(
      (run) =>
        (!run.purpose || run.purpose === 'task') &&
        ['queued', 'running', 'waiting_approval', 'paused', 'waiting_input'].includes(run.status),
    );
    if (firstRefresh && !selectedRunId && running) {
      selectedRunId = running.id;
      displayRun(running);
    } else {
      const selected = workspace.runs.find((run) => run.id === selectedRunId);
      if (selected) displayRun(selected);
    }
    firstRefresh = false;
    return true;
  } catch (error) {
    message('workspace-error', error.message);
    return false;
  }
}

function setRunStatus(label, status = '') {
  document.querySelector('.result-card').hidden = false;
  $('run-status').textContent = label;
  $('run-status').className = `pill ${status}`;
}

function showOutput(text, empty = false) {
  $('result-text').textContent = text;
  $('result-text').classList.toggle('empty', empty);
}

function finish() {
  activeRun = undefined;
  updateRunControls();
  void refresh();
}

$('run-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = $('prompt').value.trim();
  if (submitting || !prompt) return;
  submitting = true;
  selectedRunId = undefined;

  const requestId = crypto.randomUUID();
  activeRun = { requestId };
  const input = {
    conversationId: selectedConversationId,
    knotName: 'auto',
    strandId: strandSelect.value || undefined,
    prompt,
    requestId,
    folder: grantedFolder,
    outputFolder,
  };
  setRunStatus('Queued', 'queued');
  message('result-model');
  showOutput('');
  $('sub-runs').replaceChildren();
  proposalSignature = '';
  $('run-proposals').replaceChildren();
  callsSignature = '';
  $('model-calls').replaceChildren();
  updateRunControls();

  try {
    const run = await api.startRun(input);
    selectedConversationId = run.conversationId;
    conversationCache = await api.getConversation(run.conversationId);
    $('prompt').value = '';
    selectedRunId = run.runId;
    activeRun = { id: run.runId, strandName: run.strandName };
    void pollRuns();
    message(
      'result-model',
      strandSelect.value
        ? `${run.strandName} · ${run.model}`
        : 'Auto · provisioning parallel agents',
    );
    updateRunControls();
  } catch (error) {
    showOutput(error.message);
    setRunStatus('Failed', 'failed');
    finish();
  } finally {
    submitting = false;
    updateRunControls();
  }
});

$('cancel-run').addEventListener('click', async () => {
  if (!activeRun?.id) return;
  try {
    await api.cancelRun(activeRun.id);
    await pollRuns();
  } catch (error) {
    message('workspace-error', error.message);
  }
});

function routingValues(form) {
  const result = {};
  for (const [field, key] of [
    ['contextWindow', 'context_window'],
    ['inputPrice', 'input_usd_per_million'],
    ['outputPrice', 'output_usd_per_million'],
  ]) {
    const value = form.elements.namedItem(field).value.trim();
    if (value) result[key] = Number(value);
  }
  return result;
}

function openRoutingDialog(strand) {
  routingStrand = strand.id;
  const form = $('routing-form');
  form.elements.contextWindow.value = strand.routing?.context_window ?? '';
  form.elements.inputPrice.value = strand.routing?.input_usd_per_million ?? '';
  form.elements.outputPrice.value = strand.routing?.output_usd_per_million ?? '';
  $('routing-name').textContent = `${strand.name} · ${strand.model}`;
  message('routing-error');
  $('routing-dialog').showModal();
}
$('close-routing').addEventListener('click', () => $('routing-dialog').close());
$('routing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type=submit]');
  button.disabled = true;
  try {
    await api.setStrandRouting(routingStrand, routingValues(event.currentTarget));
    $('routing-dialog').close();
    await refresh();
  } catch (error) {
    message('routing-error', error.message);
  } finally {
    button.disabled = false;
  }
});

function providerFields() {
  const provider = providerSelect.value;
  const endpoint = $('endpoint');
  const usesEndpoint = provider === 'ollama' || provider === 'openai-compatible';
  $('endpoint-field').hidden = !usesEndpoint;
  endpoint.disabled = !usesEndpoint;
  endpoint.required = provider === 'openai-compatible';
  endpoint.placeholder =
    provider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234/v1';
  $('key-field').hidden = provider === 'ollama';
  $('key-field').querySelector('input').disabled = provider === 'ollama';
  $('strand-model').placeholder =
    provider === 'ollama' ? 'e.g. llama3.1:8b' : 'Enter the provider model ID';
}

function openStrandDialog() {
  $('strand-form').reset();
  providerFields();
  message('strand-error');
  strandDialog.showModal();
}

$('strand-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('save-strand');
  const input = Object.fromEntries(new FormData(form));
  input.routing = routingValues(form);
  button.disabled = true;
  message('strand-error');
  try {
    const id = await api.addStrand(input);
    form.reset();
    strandDialog.close();
    showView('strands');
    await refresh();
    await testConnection(id);
  } catch (error) {
    message('strand-error', error.message);
  } finally {
    button.disabled = false;
  }
});

$('remove-dialog').addEventListener('close', async (event) => {
  if (event.currentTarget.returnValue !== 'remove' || !pendingRemoval) return;
  const strand = pendingRemoval;
  pendingRemoval = undefined;
  try {
    await api.removeStrand(strand.id);
    tests.delete(strand.id);
    await refresh();
  } catch (error) {
    message('workspace-error', error.message);
  }
});

for (const button of nav) button.addEventListener('click', () => showView(button.dataset.view));
$('run-add-strand').addEventListener('click', openStrandDialog);
$('add-strand').addEventListener('click', openStrandDialog);
$('close-strand').addEventListener('click', () => strandDialog.close());
providerSelect.addEventListener('change', providerFields);
$('choose-output').addEventListener('click', async () => {
  try {
    const folder = await api.chooseFolder();
    if (folder) {
      outputFolder = folder;
      $('output-path').textContent = folder;
      updateRunControls();
    }
  } catch (error) {
    message('workspace-error', error.message);
  }
});
$('choose-folder').addEventListener('click', async () => {
  try {
    const folder = await api.chooseFolder();
    if (folder) {
      grantedFolder = folder;
      $('folder-path').textContent = folder;
      updateRunControls();
    }
  } catch (error) {
    message('workspace-error', error.message);
  }
});
strandSelect.addEventListener('change', () => void updatePreview());

void refresh().then((success) => api.ready?.(success));

setInterval(() => void pollRuns(), 750);

let teachingKnot;
let teachingSource;
let teachingSignature = '';
let teachingPolling = false;
const teachingDialog = $('teaching-dialog');
$('teaching-close').onclick = () => teachingDialog.close();
async function openTeaching(name, run) {
  teachingKnot = name;
  teachingSource = run;
  teachingSignature = '';
  $('teaching-form').hidden = !run;
  $('teaching-input').value = run?.input || '';
  $('teaching-correction').value = run?.output || '';
  $('teaching-note').value = '';
  message('teaching-error', '');
  teachingDialog.showModal();
  await pollTeaching();
}
async function teachingAction(fn) {
  try {
    await fn();
    message('teaching-error', '');
    teachingSignature = '';
    await pollTeaching();
    await refresh();
  } catch (error) {
    message('teaching-error', error.message);
  }
}
$('teaching-form').onsubmit = async (event) => {
  event.preventDefault();
  $('teaching-generate').disabled = true;
  await teachingAction(async () => {
    await api.teachingCreate({
      runId: teachingSource.id,
      exampleInput: $('teaching-input').value,
      correction: $('teaching-correction').value,
      note: $('teaching-note').value,
    });
    $('teaching-form').hidden = true;
  });
  $('teaching-generate').disabled = false;
};
async function pollTeaching() {
  if (!teachingDialog.open || teachingPolling) return;
  teachingPolling = true;
  try {
    const changes = (await api.teachingList()).filter((row) => row.knot_name === teachingKnot);
    const signature = JSON.stringify(changes);
    if (signature === teachingSignature) return;
    teachingSignature = signature;
    const history = $('teaching-history');
    history.replaceChildren();
    if (!changes.length)
      history.append(
        element(
          'p',
          'No saved corrections yet. Open a completed task and choose Teach this knot.',
          'muted',
        ),
      );
    for (const change of changes) {
      const card = element('section', undefined, 'teaching-change');
      card.append(
        element('h3', `Instruction change · ${change.state}`),
        element('p', `Source task ${change.source_run_id} · ${change.note}`, 'muted'),
      );
      const source = element('details');
      source.append(
        element('summary', 'Original task input and result'),
        element('pre', change.source?.input || 'Source unavailable'),
        element('pre', change.source?.output || ''),
      );
      card.append(source);
      const evidence = element('details');
      evidence.append(
        element('summary', 'Saved example and correction'),
        element('pre', change.example_input),
        element('h4', 'Corrected result'),
        element('pre', change.correction),
      );
      const before = element('details');
      before.append(
        element('summary', 'Original instructions'),
        element('pre', change.base.instructions),
      );
      card.append(evidence, before);
      if (change.proposed)
        card.append(element('h4', 'Proposed instructions'), element('pre', change.proposed));
      if (change.state === 'generating')
        card.append(
          action('Cancel proposal', () =>
            teachingAction(() => api.teachingDecide(change.id, 'reject')),
          ),
        );
      if (change.state === 'paused') {
        card.append(
          element('p', 'The proposal job is paused at a saved checkpoint.', 'muted'),
          action('Resume proposal', () =>
            teachingAction(() => api.resumeRun(change.generation.id)),
          ),
          action('Reject proposal', () =>
            teachingAction(() => api.teachingDecide(change.id, 'reject')),
          ),
        );
      }
      if (change.state === 'failed')
        card.append(
          element(
            'p',
            change.generation?.error ||
              'The model did not return valid instruction JSON. The saved correction remains available.',
            'muted',
          ),
        );
      if (change.state === 'ready') {
        const form = element('form');
        const model = element('select');
        model.setAttribute('aria-label', 'Model for both replays');
        options(
          model,
          'Choose a model for both replays',
          workspace.strands.map((strand) => [strand.name + ' · ' + strand.model, strand.id]),
        );
        model.required = true;
        form.append(
          element('h4', 'Compare on saved examples'),
          element(
            'p',
            'Each selected example starts two model calls, with separate run budgets. Choose a different source task for a held-out check. Outputs need your assessment.',
            'muted',
          ),
          model,
        );
        for (const example of changes) {
          const label = element('label');
          const checkbox = element('input');
          checkbox.type = 'checkbox';
          checkbox.value = example.id;
          checkbox.checked = example.id === change.id;
          label.append(
            checkbox,
            document.createTextNode(
              example.note +
                (example.source_run_id === change.source_run_id
                  ? ' · source task'
                  : ' · different source task'),
            ),
          );
          form.append(label);
        }
        const compare = element('button', 'Run text comparisons', 'button quiet');
        compare.type = 'submit';
        form.append(compare);
        form.onsubmit = (event) => {
          event.preventDefault();
          compare.disabled = true;
          void teachingAction(() =>
            api.teachingEvaluate(
              change.id,
              [...form.querySelectorAll('input:checked')].map((input) => input.value),
              model.value,
            ),
          ).finally(() => {
            compare.disabled = false;
          });
        };
        card.append(
          form,
          action('Accept instructions', () =>
            teachingAction(() => api.teachingDecide(change.id, 'accept')),
          ),
          action('Reject proposal', () =>
            teachingAction(() => api.teachingDecide(change.id, 'reject')),
          ),
        );
      }
      if (change.state === 'accepted')
        card.append(
          action('Revert instructions', () =>
            teachingAction(() => api.teachingDecide(change.id, 'revert')),
          ),
        );
      for (const comparison of change.evaluations) {
        const detail = element('details');
        detail.open = true;
        detail.append(
          element(
            'summary',
            `Comparison · ${changes.find((example) => example.id === comparison.example_id)?.note || comparison.example_id}`,
          ),
        );
        for (const [label, run] of [
          ['Original', comparison.before],
          ['Proposed', comparison.after],
        ]) {
          detail.append(
            element('h4', `${label} · ${run?.status || 'unavailable'} · ${run?.model_used || ''}`),
            element('pre', [run?.output, run?.error].filter(Boolean).join('\n\n') || 'Waiting…'),
          );
          if (run && ['queued', 'running'].includes(run.status))
            detail.append(
              action('Cancel replay', () => teachingAction(() => api.cancelRun(run.id))),
            );
        }
        if ([comparison.before, comparison.after].every((run) => run?.status === 'completed')) {
          const assessment = element('select');
          assessment.setAttribute('aria-label', 'Your comparison assessment');
          options(
            assessment,
            'Your assessment',
            [
              ['Original is better', 'before'],
              ['Proposed is better', 'after'],
              ['About the same', 'tie'],
              ['Unsure', 'unsure'],
            ],
            comparison.assessment || '',
          );
          assessment.onchange = () => {
            if (assessment.value)
              void teachingAction(() => api.teachingAssess(comparison.id, assessment.value));
          };
          detail.append(assessment);
        }
        card.append(detail);
      }
      history.append(card);
    }
  } catch (error) {
    message('teaching-error', error.message);
  } finally {
    teachingPolling = false;
  }
}
setInterval(() => {
  if (!document.hidden) void pollTeaching();
}, 1000);

function renderWorker() {
  const control = workspace.worker;
  if (!control) return;
  $('worker-summary').textContent = control.enabled
    ? `${control.running}/${control.concurrency} worker slots · ${control.queued} queued`
    : 'Dispatch stopped';
  $('worker-stop').hidden = !control.enabled;
  $('worker-enable').hidden = control.enabled;
  updateRunControls();
}
async function jobAction(fn) {
  try {
    await fn();
    message('workspace-error', '');
    await refresh();
  } catch (error) {
    message('workspace-error', error.message);
  }
}
async function renewJobGrants(run) {
  if (!run.job?.needsAccess) return undefined;
  const grants = {};
  for (const [path, key] of [
    [run.job.folder, 'folder'],
    [run.job.outputFolder, 'outputFolder'],
  ]) {
    if (!path) continue;
    const selected = await api.chooseFolder();
    if (!selected) throw new Error('Folder renewal cancelled. The job remains paused.');
    grants[key] = selected;
  }
  return grants;
}
function renderJobControls(run) {
  const signature = JSON.stringify([
    run.id,
    run.status,
    run.job,
    run.proposals?.map((proposal) => [proposal.id, proposal.state]),
    run.mcpActions?.map((action) => [action.id, action.state]),
    workspace.worker?.enabled,
  ]);
  if (signature === jobSignature) return;
  jobSignature = signature;
  const controls = $('job-controls');
  controls.replaceChildren();
  if (run.job?.sources?.length)
    controls.append(
      element(
        'p',
        'References: ' +
          run.job.sources.map((source) => `[${source.citation}] ${source.name}`).join(' · '),
        'muted',
      ),
    );
  if (!run.job || ['completed', 'failed', 'cancelled'].includes(run.status)) return;

  if (run.job.reason) controls.append(element('p', run.job.reason, 'muted'));
  if (['running', 'queued', 'waiting_approval'].includes(run.status)) {
    controls.append(action('Pause job', () => jobAction(() => api.pauseRun(run.id))));
  }
  if (run.status === 'paused') {
    if (run.job.needsAccess)
      controls.append(
        element(
          'p',
          `Renew the original folders: ${[run.job.folder, run.job.outputFolder].filter(Boolean).join(' · ')}`,
          'muted',
        ),
      );
    const resume = action(run.job.needsAccess ? 'Renew access and resume' : 'Resume job', () =>
      jobAction(async () => api.resumeRun(run.id, await renewJobGrants(run))),
    );
    resume.disabled =
      Boolean(run.job.settling) ||
      workspace.worker?.enabled === false ||
      (run.proposals || []).some((proposal) => proposal.state === 'uncertain') ||
      (run.mcpActions || []).some((action) => action.state === 'uncertain');
    if (run.job.settling)
      controls.append(element('p', 'Waiting for the model request to stop…', 'muted'));
    controls.append(resume);
  }
  if (run.status === 'waiting_input') {
    const form = element('form');
    const label = element('label', run.job.question || 'The knot needs more information');
    const reply = element('textarea');
    reply.required = true;
    reply.maxLength = 64000;
    reply.rows = 3;
    label.append(reply);
    const send = element(
      'button',
      run.job.needsAccess ? 'Renew access and send answer' : 'Send answer and continue',
      'button quiet',
    );
    send.type = 'submit';
    send.disabled = workspace.worker?.enabled === false;
    form.append(label, send);
    form.onsubmit = (event) => {
      event.preventDefault();
      send.disabled = true;
      void jobAction(async () =>
        api.resumeRun(run.id, await renewJobGrants(run), reply.value),
      ).finally(() => {
        send.disabled = false;
      });
    };
    controls.append(form);
  }
  controls.append(action('Cancel job', () => jobAction(() => api.cancelRun(run.id))));
}
$('worker-stop').onclick = () => jobAction(() => api.stopWorker());
$('worker-enable').onclick = () => jobAction(() => api.enableWorker());

let plansSignature = '';
const planAccess = new Map();
$('plan-form').onsubmit = (event) => {
  event.preventDefault();
  $('draft-plan').disabled = true;
  void jobAction(() => api.createPlan($('plan-goal').value, $('plan-privacy').value)).finally(
    () => {
      $('draft-plan').disabled = false;
    },
  );
};
function renderPlans() {
  const plans = workspace.plans || [];
  const signature = JSON.stringify(plans);
  if (signature === plansSignature) return;
  plansSignature = signature;
  const list = $('task-plans');
  list.replaceChildren();
  for (const plan of plans) {
    const card = element('article', undefined, 'plan-card');
    card.append(element('h3', `${plan.definition?.summary || plan.goal} · ${plan.status}`));
    if (plan.error) card.append(element('p', plan.error, 'notice error'));
    if (plan.status === 'generating' && plan.generation?.status === 'paused')
      card.append(action('Resume planning', () => jobAction(() => api.resumePlan(plan.id))));
    for (const task of plan.definition?.tasks || []) {
      const record = plan.tasks.find((item) => item.task_id === task.id);
      const knot = plan.knots.find((item) => item.name === task.knotName);
      const detail = element('details');
      detail.append(
        element(
          'summary',
          `${task.title} · ${task.knotName} · ${record?.run?.status || record?.state || 'draft'}`,
        ),
        element('p', task.prompt),
        element('p', `Expected: ${task.expectedOutput}`),
        element('p', `Depends on: ${task.dependsOn.join(', ') || 'nothing'}`, 'muted'),
      );
      if (record?.run?.output) detail.append(element('pre', record.run.output));
      if (record?.run?.error) detail.append(element('p', record.run.error, 'muted'));
      if (record?.run_id)
        detail.append(
          action('Inspect task', () => {
            selectedRunId = record.run_id;
            const run = workspace.runs.find((item) => item.id === record.run_id);
            if (run) displayRun(run);
          }),
        );
      if (['draft', 'paused'].includes(plan.status) && record?.run?.status !== 'completed') {
        for (const [needed, key, label] of [
          [
            knot?.tools?.some((tool) => ['list_files', 'read_file'].includes(tool)),
            'folder',
            'Grant input folder',
          ],
          [knot?.tools?.includes('create_file'), 'outputFolder', 'Grant output folder'],
        ]) {
          if (!needed) continue;
          detail.append(
            action(label, () =>
              jobAction(async () => {
                const folder = await api.chooseFolder();
                if (!folder) return;
                const access = planAccess.get(plan.id) || {};
                access[task.id] = { ...access[task.id], [key]: folder };
                planAccess.set(plan.id, access);
                plansSignature = '';
                renderPlans();
              }),
            ),
            element(
              'p',
              planAccess.get(plan.id)?.[task.id]?.[key] ||
                record?.scope?.[key] ||
                'Access required before execution',
              'muted',
            ),
          );
        }
      }
      card.append(detail);
    }
    if (plan.status === 'draft') {
      const edit = element('details');
      const text = element('textarea');
      text.value = JSON.stringify(plan.definition, null, 2);
      text.rows = 12;
      text.setAttribute('aria-label', 'Edit task plan JSON');
      edit.append(
        element('summary', 'Edit plan'),
        text,
        action('Save draft edits', () =>
          jobAction(() => api.editPlan(plan.id, JSON.parse(text.value))),
        ),
      );
      card.append(edit);
      card.append(
        action('Approve and run plan', () =>
          jobAction(() => api.approvePlan(plan.id, planAccess.get(plan.id))),
        ),
      );
    }
    if (plan.status === 'paused')
      card.append(
        action('Resume plan', () =>
          jobAction(() => api.resumePlan(plan.id, planAccess.get(plan.id))),
        ),
      );
    if (plan.status === 'active')
      card.append(action('Pause plan', () => jobAction(() => api.pausePlan(plan.id))));
    if (!['completed', 'cancelled', 'rejected', 'failed'].includes(plan.status))
      card.append(
        action(plan.status === 'draft' ? 'Reject plan' : 'Cancel plan', () =>
          jobAction(() => api.cancelTaskPlan(plan.id)),
        ),
      );
    if ((plan.messages && plan.messages.length) || plan.status === 'active') {
      const board = element('details');
      board.open = Boolean(plan.messages?.length);
      board.append(
        element('summary', `Bot message board (${plan.messages?.length || 0})`),
      );
      if (!plan.messages?.length) {
        board.append(element('p', 'No peer messages yet.', 'muted'));
      } else {
        for (const msg of plan.messages) {
          board.append(
            element(
              'p',
              `${msg.from_task_id} → ${msg.to_task_id || '@all'}: ${msg.body}`,
              'muted',
            ),
          );
        }
      }
      if (plan.status === 'active') {
        const msgForm = element('form');
        const to = element('select');
        options(
          to,
          'Broadcast (@all)',
          (plan.definition?.tasks || []).map((t) => [`${t.title} (${t.id})`, t.id]),
        );
        const body = element('input');
        body.placeholder = 'Send a coordination note to bots in this plan…';
        body.required = true;
        body.maxLength = 4000;
        const send = element('button', 'Post note', 'button quiet');
        msgForm.append(to, body, send);
        msgForm.onsubmit = (event) => {
          event.preventDefault();
          void jobAction(async () => {
            await api.postPlanMessage({
              planId: plan.id,
              toTaskId: to.value || undefined,
              body: body.value,
              privacy: plan.privacy,
            });
            body.value = '';
          });
        };
        board.append(msgForm);
      }
      card.append(board);
    }
    list.append(card);
  }
}

$('mcp-form').onsubmit = (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  void jobAction(async () => {
    await api.saveMcpServer(Object.fromEntries(new FormData(form)));
    form.reset();
  });
};
function renderMcpServers() {
  const list = $('mcp-server-list');
  list.replaceChildren();
  for (const server of workspace.mcpServers || []) {
    const row = element('p', `${server.name} · ${server.endpoint}`);
    row.append(
      action('Inspect tools', () =>
        jobAction(async () => {
          $('mcp-catalog').textContent = JSON.stringify(
            await api.inspectMcpServer(server.name),
            null,
            2,
          );
        }),
      ),
      action('Remove connection', () => jobAction(() => api.removeMcpServer(server.name))),
    );
    list.append(row);
  }
}
let mcpSignature = '';
function renderMcpActions(run) {
  const signature = JSON.stringify([run.id, run.status, run.mcpActions]);
  if (signature === mcpSignature) return;
  mcpSignature = signature;
  const list = $('mcp-actions');
  list.replaceChildren();
  for (const receipt of run.mcpActions || []) {
    const card = element('section', undefined, 'proposal');
    card.append(
      element('h3', `MCP · ${receipt.server}/${receipt.name} · ${receipt.state}`),
      element('p', receipt.endpoint, 'muted'),
      element('pre', receipt.arguments),
    );
    if (receipt.result) card.append(element('pre', receipt.result));
    if (receipt.error) card.append(element('p', receipt.error, 'muted'));
    if (receipt.state === 'pending' && run.status === 'waiting_approval')
      card.append(
        action('Approve MCP call', () => jobAction(() => api.decideMcpAction(receipt.id, true))),
        action('Reject MCP call', () => jobAction(() => api.decideMcpAction(receipt.id, false))),
      );
    if (receipt.state === 'uncertain' && run.status === 'paused') {
      const form = element('form');
      const label = element(
        'label',
        'Inspect the remote service, then record its actual outcome. This does not retry the call.',
      );
      const result = element('textarea');
      result.required = true;
      result.maxLength = 64000;
      label.append(result);
      const send = element('button', 'Record verified outcome', 'button quiet');
      form.append(label, send);
      form.onsubmit = (event) => {
        event.preventDefault();
        void jobAction(() => api.reconcileMcpAction(run.id, receipt.id, result.value));
      };
      card.append(form);
    }
    list.append(card);
  }
}

function newChat() {
  historySignature = '';
  conversationVersion++;
  selectedConversationId = undefined;
  selectedRunId = undefined;
  conversationCache = undefined;
  activeRun = undefined;
  grantedFolder = undefined;
  outputFolder = undefined;
  $('prompt').value = '';
  $('conversation-history').replaceChildren();
  $('current-user-message').hidden = true;
  document.querySelector('.result-card').hidden = true;
  $('chat-welcome').hidden = false;
  jobSignature = '';
  conversationsSignature = '';
  showView('run');
  renderConversations();
  updateRunControls();
  $('prompt').focus();
}
function renderConversations() {
  const signature = JSON.stringify([workspace.conversations, selectedConversationId]);
  if (signature === conversationsSignature) return;
  conversationsSignature = signature;
  options(
    $('glassbar-chat'),
    'New chat',
    (workspace.conversations || []).map((chat) => [chat.title, chat.id]),
    selectedConversationId,
  );
  const list = $('conversation-list');
  list.replaceChildren();
  for (const chat of workspace.conversations || []) {
    const button = action(
      chat.title,
      () => {
        void loadConversation(chat.id);
      },
      'chat-link',
    );
    button.title = chat.title;
    button.setAttribute('aria-current', chat.id === selectedConversationId ? 'page' : 'false');
    list.append(button);
  }
}
function renderConversationHistory(currentId) {
  const signature = JSON.stringify([
    selectedConversationId,
    currentId,
    conversationCache?.runs
      .filter((run) => run.id !== currentId)
      .map((run) => [run.id, run.input, run.output, run.error]),
  ]);
  if (signature === historySignature) return;
  historySignature = signature;
  const list = $('conversation-history');
  list.replaceChildren();
  if (!selectedConversationId || conversationCache?.id !== selectedConversationId) return;
  for (const run of conversationCache.runs) {
    if (run.id === currentId) break;
    list.append(
      element('div', run.input, 'chat-message user-message'),
      element('div', run.output || run.error || run.status, 'chat-message assistant-message'),
    );
  }
}
async function loadConversation(id) {
  const version = ++conversationVersion;
  try {
    const chat = await api.getConversation(id);
    if (version !== conversationVersion) return;
    conversationCache = chat;
    selectedConversationId = id;
    const run = chat.runs.at(-1);
    if (run) {
      selectedRunId = run.id;
      displayRun(run);
    }
    showView('run');
    renderConversations();
    updateRunControls();
  } catch (error) {
    message('workspace-error', error.message);
  }
}
async function selectRun(id) {
  try {
    const run = await api.getRun(id);
    if (run.conversationId) {
      await loadConversation(run.conversationId);
    } else {
      conversationVersion++;
      selectedConversationId = undefined;
      conversationCache = undefined;
      selectedRunId = id;
      showView('run');
      displayRun(run);
    }
  } catch (error) {
    message('workspace-error', error.message);
  }
}
$('new-chat').onclick = newChat;
$('open-dashboard').onclick = () => api.showDashboard(selectedRunId);
$('hide-glassbar').onclick = () => api.hideGlassbar();
api.onSelectRun?.((id) => {
  void refresh().then(() => selectRun(id));
});
$('prompt').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!$('submit-run').disabled) $('run-form').requestSubmit();
  }
});

$('glassbar-new-chat').onclick = newChat;
if (api.surfaceStatus)
  void api
    .surfaceStatus()
    .then((status) => {
      document.querySelector('.sidebar-foot').title = status.registered
        ? `Quick bar: ${status.shortcut}`
        : 'Shortcut unavailable; open the quick bar from the tray.';
    })
    .catch(() => {});

$('glassbar-chat').onchange = (event) => {
  if (event.currentTarget.value) void loadConversation(event.currentTarget.value);
  else newChat();
};
