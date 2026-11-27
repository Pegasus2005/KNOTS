import { renderLearning } from './learning.js';
const api = window.knots;
const $ = (id) => document.getElementById(id);
let state,
  drafts = [],
  selected,
  busy = false,
  signature = '';
const draftAccess = new Map();
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
function button(label, fn, primary = false) {
  const n = el('button', label, `button ${primary ? 'primary' : 'quiet'}`);
  n.type = 'button';
  n.addEventListener('click', () => act(fn));
  return n;
}
function field(label, value = '', area = false) {
  const wrapper = el('label', label);
  const input = el(area ? 'textarea' : 'input');
  input.value = value;
  wrapper.append(input);
  return { wrapper, input };
}
function card(title) {
  const n = el('section', undefined, 'card');
  n.append(el('h2', title));
  return n;
}
function select(label, items) {
  const wrapper = el('label', label),
    input = el('select');
  for (const [name, id] of items) input.add(new Option(name, id));
  wrapper.append(input);
  return { wrapper, input };
}
async function act(fn) {
  if (busy) return;
  busy = true;
  try {
    $('studio-error').hidden = true;
    await fn();
    signature = '';
    await refresh();
  } catch (e) {
    $('studio-error').textContent = e.message;
    $('studio-error').hidden = false;
  } finally {
    busy = false;
  }
}
function tab() {
  return location.hash.slice(1) || 'create';
}
function listButton(label, id) {
  const n = button(label, () => {
    selected = id;
    render();
  });
  if (selected === id) n.setAttribute('aria-current', 'true');
  return n;
}
async function refresh() {
  state = await api.workspace();
  drafts = await api.creationList();
  state.learning = await api.labList();
  state.playbooks = await api.playbooksList();
  const next = JSON.stringify([
    drafts,
    state.knots,
    state.memories,
    state.learning,
    state.playbooks,
  ]);
  if (next !== signature) {
    signature = next;
    render();
  }
}
function render() {
  for (const n of document.querySelectorAll('[data-tab]')) {
    if (n.dataset.tab === tab()) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  }
  const list = $('studio-list'),
    detail = $('studio-detail');
  list.replaceChildren();
  detail.replaceChildren();
  if (tab() === 'create') renderCreate(list, detail);
  else if (tab() === 'memory') renderMemory(list, detail);
  else renderLearning(tab(), list, detail);
}
function renderCreate(list, detail) {
  list.append(
    button(
      '＋ Describe a problem',
      () => {
        selected = undefined;
        render();
      },
      true,
    ),
  );
  for (const draft of drafts) list.append(listButton(draft.problem.slice(0, 48), draft.id));
  const draft = drafts.find((d) => d.id === selected);
  if (!draft) {
    const n = card('What would you like help with?'),
      problem = field('Your problem', '', true),
      privacy = select('Where can your problem be processed?', [
        ['Cloud allowed', 'cloud_allowed'],
        ['Local models only', 'local_only'],
      ]);
    n.append(
      problem.wrapper,
      privacy.wrapper,
      el(
        'p',
        'Your problem is saved locally first. Generate only when a suitable model is connected.',
        'muted',
      ),
      button(
        'Save problem',
        async () => {
          selected = await api.creationCreate(problem.input.value, privacy.input.value);
        },
        true,
      ),
    );
    detail.append(n);
    return;
  }
  const summary = card(draft.savedName ? 'Your bot is ready' : 'Shape the approach');
  summary.append(
    el('p', draft.problem),
    el(
      'span',
      draft.privacy === 'local_only' ? 'Local models only' : 'Cloud processing allowed',
      'pill',
    ),
  );
  if (draft.generation) {
    summary.append(el('p', `Draft generation: ${draft.generation.status}`));
    if (['queued', 'running', 'paused'].includes(draft.generation.status))
      summary.append(button('Cancel generation', () => api.cancelRun(draft.generation.id)));
    if (draft.generation.status === 'paused')
      summary.append(button('Resume generation', () => api.resumeRun(draft.generation.id)));
  }
  if (draft.error) summary.append(el('p', draft.error, 'notice error'));
  if (!draft.savedName) {
    const clarification = field('Additional context or answers', '', true);
    summary.append(
      clarification.wrapper,
      button(
        'Generate / refine draft',
        () => api.creationGenerate(draft.id, clarification.input.value),
        true,
      ),
    );
  }
  detail.append(summary);
  if (draft.matches?.length && !draft.savedName) {
    const reuse = card('A saved bot may already fit');
    for (const match of draft.matches) {
      reuse.append(
        el('p', `${match.label}: ${match.reason}`),
        button(`Reuse ${match.label}`, () => api.creationSave(draft.id, match.name)),
      );
    }
    detail.append(reuse);
  }
  if (draft.review && !draft.savedName) {
    const review = card('Review your bot'),
      spec = draft.review.spec;
    const name = field('Bot identifier', spec.name),
      label = field('Name', spec.display_name),
      description = field('Purpose', spec.description),
      instructions = field('Instructions', spec.instructions, true),
      expected = field('Expected result', spec.expected_output || ''),
      criteria = field('Success criteria · one per line', draft.review.criteria.join('\n'), true),
      questions = field(
        'Essential questions · resolve before saving',
        draft.review.questions.join('\n'),
        true,
      ),
      gaps = field('Capability gaps · resolve before saving', draft.review.gaps.join('\n'), true);
    const tools = select('File access requirements', [
      ['No file tools', 'none'],
      ['Read granted text files', 'read'],
      ['Read and propose new text files', 'write'],
    ]);
    tools.input.value = spec.tools?.includes('create_file')
      ? 'write'
      : spec.tools?.includes('read_file')
        ? 'read'
        : 'none';
    review.append(
      el('p', `Assumptions: ${draft.review.assumptions.join('; ') || 'None'}`),
      name.wrapper,
      label.wrapper,
      description.wrapper,
      instructions.wrapper,
      expected.wrapper,
      tools.wrapper,
      criteria.wrapper,
      questions.wrapper,
      gaps.wrapper,
      el(
        'p',
        'Saving grants no access. File creation always requires approval. Draft examples are not approved evaluation cases.',
        'muted',
      ),
    );
    const lines = (input) =>
      input.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    async function saveReview() {
      await api.creationEdit(draft.id, {
        ...draft.review,
        spec: {
          ...spec,
          name: name.input.value,
          display_name: label.input.value,
          description: description.input.value,
          instructions: instructions.input.value,
          expected_output: expected.input.value || undefined,
          tools:
            tools.input.value === 'write'
              ? ['list_files', 'read_file', 'create_file']
              : tools.input.value === 'read'
                ? ['list_files', 'read_file']
                : [],
        },
        criteria: lines(criteria.input),
        questions: lines(questions.input),
        gaps: lines(gaps.input),
      });
    }
    review.append(
      button('Keep edited draft', saveReview),
      button(
        'Save reusable bot',
        async () => {
          await saveReview();
          await api.creationSave(draft.id);
        },
        true,
      ),
    );
    detail.append(review);
  }
  if (draft.savedName) {
    const run = card(`Saved as ${draft.savedName}`);
    const grants = draftAccess.get(draft.id) || {};
    draftAccess.set(draft.id, grants);
    const access = el(
      'p',
      `Input: ${grants.folder || 'none'} · Output: ${grants.outputFolder || 'none'}`,
      'muted',
    );
    run.append(
      access,
      button('Grant input folder', async () => {
        grants.folder = await api.chooseFolder();
      }),
      button('Grant output folder', async () => {
        grants.outputFolder = await api.chooseFolder();
      }),
      button(
        draft.runId ? 'Open first run' : 'Run original task',
        async () => {
          const runId = draft.runId || (await api.creationRun(draft.id, grants));
          await api.showDashboard(runId);
        },
        true,
      ),
    );
    detail.append(run);
  }
}
function renderMemory(list, detail) {
  list.append(
    el(
      'p',
      'Workspace memory is shared across chats. Deleting a chat retains these entries.',
      'muted',
    ),
  );
  for (const memory of state.memories ?? []) {
    const n = card(memory.tags.join(', ') || 'Saved context');
    n.append(
      el('p', memory.content),
      el('p', `${memory.privacy} · Source run: ${memory.source_run_id || 'manual'}`, 'muted'),
      button('Forget this entry', () => api.removeMemory(memory.id)),
    );
    detail.append(n);
  }
  if (!state.memories?.length) detail.append(el('p', 'No workspace memories yet.'));
}
window.studio = {
  api,
  el,
  button,
  field,
  card,
  select,
  act,
  get state() {
    return state;
  },
  get selected() {
    return selected;
  },
  set selected(id) {
    selected = id;
  },
  refresh,
  render,
};
addEventListener('hashchange', () => {
  selected = undefined;
  signature = '';
  render();
});
void refresh()
  .then(() => api.ready?.(true))
  .catch((e) => {
    $('studio-error').textContent = e.message;
    $('studio-error').hidden = false;
    api.ready?.(false);
  });
setInterval(() => {
  if (!busy && !document.querySelector('#studio-detail :focus')) void refresh().catch(() => {});
}, 1500);
