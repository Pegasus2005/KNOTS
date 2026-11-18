const api = window.knots;
const $ = (id) => document.getElementById(id);
const knotSelect = $('run-knot');
const strandSelect = $('run-strand');
const providerSelect = $('provider');
const strandDialog = $('strand-dialog');
const knotDialog = $('knot-dialog');
const knotForm = $('knot-form');
const nav = [...document.querySelectorAll('[data-view]')];
const tests = new Map();
let workspace = { knots: [], strands: [], runs: [] };
let activeRun;
let previewVersion = 0;
let pendingRemoval;
let grantedFolder;
let selectedRunId;
let polling = false;
let editingKnot;
let customKnotId = false;

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
  $('breadcrumb').textContent = `Workspace / ${view[0].toUpperCase()}${view.slice(1)}`;
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
  const running = Boolean(activeRun);
  knotSelect.disabled = running || !workspace.knots.length;
  strandSelect.disabled = running || !workspace.strands.length;
  const needsFolder = workspace.knots.find((knot) => knot.name === knotSelect.value)?.tools?.length;
  $('folder-controls').hidden = !needsFolder;
  $('choose-folder').disabled = running;
  $('submit-run').disabled =
    running || !knotSelect.value || !workspace.strands.length || (needsFolder && !grantedFolder);
  $('cancel-run').hidden = !activeRun?.id;
  $('run-create-knot').hidden = Boolean(workspace.knots.length);
  $('run-add-sample').hidden = Boolean(workspace.knots.length);
  $('run-add-strand').hidden = Boolean(workspace.strands.length);
  $('run-setup').hidden = Boolean(workspace.knots.length && workspace.strands.length);
}

async function updatePreview() {
  const version = ++previewVersion;
  const knot = knotSelect.value;
  const override = strandSelect.value;
  const summary = $('route-summary');
  summary.textContent = '';
  if (!knot || !workspace.strands.length) return;

  try {
    const id = override || (await api.preview(knot));
    if (version !== previewVersion) return;
    const strand = workspace.strands.find((item) => item.id === id);
    if (strand) {
      summary.textContent = `${strand.name} · ${strand.model}${strand.is_local ? ' · Local' : ' · Remote'}`;
    }
  } catch (error) {
    if (version === previewVersion) summary.textContent = error.message;
  }
}

function renderKnots() {
  const list = $('knot-list');
  $('knots-add-sample').hidden = workspace.knots.some((knot) => knot.name === 'contract-reviewer');
  list.replaceChildren();
  if (!workspace.knots.length) {
    list.append(element('p', 'No knots in this workspace yet.', 'muted'));
  }
  for (const knot of workspace.knots) {
    const card = element('article', undefined, 'card');
    card.append(element('h3', knot.display_name || knot.name));
    if (knot.description) card.append(element('p', knot.description, 'muted'));
    if (knot.lanes?.default?.length) {
      card.append(
        element('p', `Default strand order · ${knot.lanes.default.join(' → ')}`, 'muted'),
      );
    }
    const details = element('details');
    details.append(element('summary', 'Instructions'), element('p', knot.instructions));
    if (knot.expected_output) {
      details.append(element('p', `Expected result · ${knot.expected_output}`, 'muted'));
    }
    const actions = element('div', undefined, 'actions');
    actions.append(
      action('Open in Run ↗', () => {
        if (!activeRun) {
          knotSelect.value = knot.name;
          strandSelect.value = '';
          updateRunControls();
          void updatePreview();
        }
        showView('run');
        $('prompt').focus();
      }),
    );
    actions.append(action('Edit', () => openKnotDialog(knot)));
    card.append(details, actions);
    list.append(card);
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
      testButton,
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

function renderRuns() {
  const list = $('recent-runs');
  list.replaceChildren();
  if (!workspace.runs.length) list.append(element('p', 'No runs yet.', 'muted'));
  for (const run of workspace.runs) {
    const row = element('div', undefined, 'activity-row');
    row.append(
      element(
        'span',
        workspace.knots.find((knot) => knot.name === run.knot_name)?.display_name || run.knot_name,
      ),
      element('span', [run.strand_name, run.model_used].filter(Boolean).join(' · '), 'muted'),
      element('span', run.status.replaceAll('_', ' '), `pill ${run.status}`),
    );
    row.append(
      action('Open', () => {
        if (activeRun && activeRun.id !== run.id) return;
        selectedRunId = run.id;
        showView('run');
        displayRun(run);
      }),
    );
    list.append(row);
  }
}

function displayRun(run) {
  knotSelect.value = run.knot_name;
  $('prompt').value = run.input;
  $('run-activity').textContent = (run.activity || []).join('\n');
  message('result-model', [run.strand_name, run.model_used].filter(Boolean).join(' · '));
  showOutput(run.output || run.error || (run.status === 'running' ? 'Working…' : ''));
  if (run.error && run.output) showOutput(run.output + '\n\n' + run.error);
  setRunStatus(run.status[0].toUpperCase() + run.status.slice(1), run.status);
  activeRun = ['running', 'queued'].includes(run.status) ? { id: run.id } : undefined;
  updateRunControls();
}

async function pollRuns() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const data = await api.workspace();
    workspace.runs = data.runs;
    renderRuns();
    const run = workspace.runs.find((item) => item.id === activeRun?.id);
    if (run) displayRun(run);
  } catch (error) {
    message('workspace-error', error.message);
  } finally {
    polling = false;
  }
}

async function refresh(preferredKnot = knotSelect.value) {
  try {
    workspace = await api.workspace();
    const count = workspace.strands.length;
    $('connection-count').textContent = `${count} saved ${count === 1 ? 'strand' : 'strands'}`;
    options(
      knotSelect,
      'Select a knot',
      workspace.knots.map((knot) => [knot.display_name || knot.name, knot.name]),
      preferredKnot,
    );
    if (!knotSelect.value && workspace.knots.length) knotSelect.value = workspace.knots[0].name;
    options(
      strandSelect,
      'Use knot preference',
      workspace.strands.map((strand) => [`${strand.name} · ${strand.model}`, strand.id]),
      strandSelect.value,
    );
    renderKnots();
    renderStrands();
    renderRuns();
    updateRunControls();
    void updatePreview();
    const running = workspace.runs.find((run) => ['queued', 'running'].includes(run.status));
    if (!activeRun && running) {
      selectedRunId = running.id;
      displayRun(running);
    }
  } catch (error) {
    message('workspace-error', error.message);
  }
}

function setRunStatus(label, status = '') {
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
  if (activeRun || !knotSelect.value || !prompt) return;

  const requestId = crypto.randomUUID();
  activeRun = { requestId };
  const input = {
    knotName: knotSelect.value,
    strandId: strandSelect.value || undefined,
    prompt,
    requestId,
    folder: grantedFolder,
  };
  setRunStatus('Running', 'running');
  message('result-model');
  showOutput('');
  updateRunControls();

  try {
    const run = await api.startRun(input);
    if (activeRun?.requestId !== requestId) return;
    selectedRunId = run.runId;
    Object.assign(activeRun, { id: run.runId, strandName: run.strandName });
    void pollRuns();
    message('result-model', `${run.strandName} · ${run.model}`);
    updateRunControls();
  } catch (error) {
    showOutput(error.message);
    setRunStatus('Failed', 'failed');
    finish();
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

async function addSample(button) {
  button.disabled = true;
  try {
    const knot = await api.addSample();
    showView('run');
    await refresh(knot);
  } catch (error) {
    message('workspace-error', error.message);
  } finally {
    button.disabled = false;
  }
}

function openKnotDialog(knot) {
  editingKnot = knot?.name;
  customKnotId = Boolean(editingKnot);
  knotForm.reset();
  $('knot-files').checked = Boolean(knot?.tools?.length);
  for (const field of ['name', 'display_name', 'description', 'instructions', 'expected_output']) {
    knotForm.elements.namedItem(field).value = knot?.[field] ?? '';
  }
  knotForm.elements.namedItem('name').readOnly = Boolean(editingKnot);
  $('knot-title').textContent = editingKnot ? 'Edit knot' : 'Create knot';
  message('knot-error');
  knotDialog.showModal();
}

knotForm.elements.namedItem('name').addEventListener('input', () => {
  customKnotId = true;
});
knotForm.elements.namedItem('display_name').addEventListener('input', (event) => {
  if (customKnotId) return;
  knotForm.elements.namedItem('name').value = event.currentTarget.value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
});

knotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('save-knot');
  if (button.disabled) return;
  button.disabled = true;
  message('knot-error');
  try {
    const input = Object.fromEntries(new FormData(knotForm));
    const name = await api.saveKnot({
      ...input,
      tools: $('knot-files').checked ? ['list_files', 'read_file'] : [],
      editing: Boolean(editingKnot),
    });
    knotDialog.close();
    if (!editingKnot && !activeRun) {
      strandSelect.value = '';
      showView('run');
      await refresh(name);
      $('prompt').focus();
    } else {
      showView('knots');
      await refresh();
    }
  } catch (error) {
    message('knot-error', error.message);
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
for (const id of ['run-add-sample', 'knots-add-sample']) {
  $(id).addEventListener('click', (event) => void addSample(event.currentTarget));
}
for (const id of ['create-knot', 'run-create-knot']) {
  $(id).addEventListener('click', () => openKnotDialog());
}
$('close-knot').addEventListener('click', () => knotDialog.close());
$('run-add-strand').addEventListener('click', openStrandDialog);
$('add-strand').addEventListener('click', openStrandDialog);
$('close-strand').addEventListener('click', () => strandDialog.close());
providerSelect.addEventListener('change', providerFields);
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
knotSelect.addEventListener('change', () => {
  strandSelect.value = '';
  updateRunControls();
  void updatePreview();
});
strandSelect.addEventListener('change', () => void updatePreview());

void refresh();

setInterval(() => void pollRuns(), 750);
