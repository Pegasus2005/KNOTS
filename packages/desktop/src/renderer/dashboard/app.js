// KNOTS — User-Centric Autonomous Multi-Agent Platform

const knotsApi = window.knots;

// Top Navigation & Shell Elements
const navButtons = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');
const breadcrumb = document.getElementById('breadcrumb');
const activeModelPill = document.getElementById('active-model-pill');
const workspacePathPill = document.getElementById('workspace-path-pill');

// Swarm Task Elements
const swarmForm = document.getElementById('swarm-form');
const swarmPrompt = document.getElementById('swarm-prompt');
const submitSwarm = document.getElementById('submit-swarm');
const cancelSwarm = document.getElementById('cancel-swarm');
const teamContainer = document.getElementById('team-container');
const teamStrategy = document.getElementById('team-strategy');
const swarmStatusPill = document.getElementById('swarm-status-pill');
const botsGrid = document.getElementById('bots-grid');
const deliverableContainer = document.getElementById('deliverable-container');
const deliverableText = document.getElementById('deliverable-text');
const copyDeliverable = document.getElementById('copy-deliverable');
const chips = document.querySelectorAll('.chip');

// Active Default Model Elements
const activeDefaultIcon = document.getElementById('active-default-icon');
const activeDefaultName = document.getElementById('active-default-name');
const activeDefaultModelName = document.getElementById('active-default-model-name');
const activeProviderTag = document.getElementById('active-provider-tag');

// Smart Key Elements
const smartKeyInput = document.getElementById('smart-key-input');
const detectionPill = document.getElementById('detection-pill');
const detectedProviderName = document.getElementById('detected-provider-name');
const detectedModelHint = document.getElementById('detected-model-hint');
const connectKeyBtn = document.getElementById('connect-key-btn');
const connectedProvidersList = document.getElementById('connected-providers-list');

// Optional Model Overrides Elements
const toggleOverrideBtn = document.getElementById('toggle-override-btn');
const addOverrideForm = document.getElementById('add-override-form');
const cancelOverrideBtn = document.getElementById('cancel-override-btn');
const overrideTargetSelect = document.getElementById('override-target-select');
const customOverrideNameGroup = document.getElementById('custom-override-name-group');
const customOverrideName = document.getElementById('custom-override-name');
const overrideProviderSelect = document.getElementById('override-provider-select');
const overrideModelInput = document.getElementById('override-model-input');
const overridesList = document.getElementById('overrides-list');
const noOverridesMsg = document.getElementById('no-overrides-msg');

// Icons
const ROLE_ICONS = {
  orchestrator: '🧠',
  coder: '💻',
  researcher: '🌐',
  reviewer: '✍️',
  custom: '🤖',
};

const PROVIDER_ICONS = {
  openrouter: '🪐',
  anthropic: '⚡',
  openai: '🟢',
  google: '🔷',
  ollama: '🦙',
  'openai-compatible': '🔌',
  unknown: '🔑',
};

// ==========================================
// 1. Navigation Tabs
// ==========================================
navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const viewName = btn.dataset.view;
    navButtons.forEach((b) => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'page');

    pages.forEach((page) => {
      page.hidden = page.id !== `view-${viewName}`;
    });

    const labels = {
      swarm: 'Workspace / Task & Swarm',
      roles: 'Workspace / Keys & Models',
      history: 'Workspace / History',
    };
    breadcrumb.textContent = labels[viewName] || 'Workspace';
  });
});

// Prompt Chips
chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    swarmPrompt.value = chip.dataset.prompt;
    swarmPrompt.focus();
  });
});

// Copy Deliverable
if (copyDeliverable) {
  copyDeliverable.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(deliverableText.textContent || '');
      const original = copyDeliverable.textContent;
      copyDeliverable.textContent = 'Copied! ✓';
      setTimeout(() => {
        copyDeliverable.textContent = original;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  });
}

// ==========================================
// 2. Swarm Task Execution & Live Streaming
// ==========================================
if (knotsApi?.onSwarmEvent) {
  knotsApi.onSwarmEvent((event) => {
    if (!event) return;

    if (event.type === 'plan') {
      const plan = event.plan;
      teamContainer.hidden = false;
      teamStrategy.textContent = plan.strategy || 'Autonomous team assembled.';
      swarmStatusPill.textContent = `${plan.bots.length} Bots Active`;
      swarmStatusPill.className = 'pill info';

      // Render Dynamic Bot Cards
      botsGrid.innerHTML = '';
      plan.bots.forEach((bot) => {
        const card = document.createElement('div');
        card.id = `card-${bot.id}`;
        card.className = 'bot-card';
        card.innerHTML = `
          <div class="bot-card-header">
            <span class="bot-icon">${ROLE_ICONS[bot.role] || '🤖'}</span>
            <div class="bot-info">
              <strong>${bot.name}</strong>
              <span class="bot-role-tag">${bot.role.toUpperCase()}</span>
            </div>
            <span id="badge-${bot.id}" class="pill warning">Waiting</span>
          </div>
          <p class="bot-mission">${bot.mission}</p>
          <div id="output-${bot.id}" class="bot-stream-box" hidden></div>
        `;
        botsGrid.appendChild(card);
      });
    } else if (event.type === 'bot_start') {
      const bot = event.bot;
      const badge = document.getElementById(`badge-${bot.id}`);
      if (badge) {
        badge.textContent = 'Investigating...';
        badge.className = 'pill info';
      }
      const streamBox = document.getElementById(`output-${bot.id}`);
      if (streamBox) {
        streamBox.hidden = false;
        streamBox.textContent = '';
      }
    } else if (event.type === 'bot_action') {
      const { botId, action } = event;
      const card = document.getElementById(`card-${botId}`);
      if (card) {
        let actionsList = card.querySelector('.bot-actions-list');
        if (!actionsList) {
          actionsList = document.createElement('div');
          actionsList.className = 'bot-actions-list';
          card.insertBefore(actionsList, card.querySelector('.bot-stream-box'));
        }
        const actionItem = document.createElement('div');
        actionItem.className = `action-badge ${action.success ? 'success' : 'error'}`;
        const icons = {
          find_files: '🔍 Searched Files',
          read_file: '📄 Read File',
          write_file: '✏️ Modified/Wrote',
          list_files: '📂 Listed Folder',
          run_command: '⚙️ Executed Command',
        };
        const title = icons[action.action] || '⚡ Action';
        actionItem.textContent = `${title}: ${action.target || ''} ${action.success ? '✓' : '✗'}`;
        actionsList.appendChild(actionItem);
      }
    } else if (event.type === 'bot_chunk') {
      const streamBox = document.getElementById(`output-${event.botId}`);
      if (streamBox) {
        streamBox.hidden = false;
        streamBox.textContent += event.chunk;
        streamBox.scrollTop = streamBox.scrollHeight;
      }
    } else if (event.type === 'bot_done') {
      const bot = event.bot;
      const badge = document.getElementById(`badge-${bot.id}`);
      if (badge) {
        badge.textContent = 'Completed ✓';
        badge.className = 'pill success';
      }
    } else if (event.type === 'synthesizing') {
      swarmStatusPill.textContent = '🧠 Synthesizing Final Deliverable...';
      swarmStatusPill.className = 'pill warning';
      deliverableContainer.hidden = false;
      deliverableText.textContent = '';
    } else if (event.type === 'deliverable_chunk') {
      deliverableContainer.hidden = false;
      deliverableText.textContent += event.chunk;
      deliverableText.scrollTop = deliverableText.scrollHeight;
    }
  });
}

// Swarm Submit Form
if (swarmForm) {
  swarmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = swarmPrompt.value.trim();
    if (!prompt) return;

    submitSwarm.disabled = true;
    submitSwarm.textContent = 'Orchestrating...';
    teamContainer.hidden = false;
    teamStrategy.textContent = '🧠 Analyzing task and assigning specialized bots...';
    botsGrid.innerHTML = '';
    deliverableContainer.hidden = true;
    deliverableText.textContent = '';

    try {
      const result = await knotsApi.runSwarm(prompt);
      if (result?.deliverable) {
        deliverableContainer.hidden = false;
        deliverableText.textContent = result.deliverable;
        swarmStatusPill.textContent = 'Task Finished ✓';
        swarmStatusPill.className = 'pill success';
      }
    } catch (err) {
      swarmStatusPill.textContent = 'Failed';
      swarmStatusPill.className = 'pill error';
      deliverableContainer.hidden = false;
      deliverableText.textContent = `Error executing swarm: ${err?.message || String(err)}`;
    } finally {
      submitSwarm.disabled = false;
      submitSwarm.innerHTML = 'Spawn Team & Run <span>↗</span>';
    }
  });
}

// ==========================================
// 3. Smart Key Auto-Detection & Connection
// ==========================================
let detectTimeout = null;
if (smartKeyInput) {
  smartKeyInput.addEventListener('input', () => {
    const key = smartKeyInput.value.trim();
    if (!key) {
      if (detectionPill) detectionPill.hidden = true;
      return;
    }

    clearTimeout(detectTimeout);
    detectTimeout = setTimeout(async () => {
      try {
        const detected = await knotsApi.detectKey(key);
        if (detected && detectionPill) {
          detectionPill.hidden = false;
          if (detected.provider === 'unknown') {
            detectionPill.classList.add('unrecognized');
            detectedProviderName.textContent = 'Custom API Key (OpenAI-Compatible)';
            detectedModelHint.textContent = 'Default: gpt-4o / generic';
          } else {
            detectionPill.classList.remove('unrecognized');
            const icon = PROVIDER_ICONS[detected.provider] || '🔑';
            detectedProviderName.textContent = `${icon} Auto-Detected: ${detected.displayName}`;
            detectedModelHint.textContent = `Default model: ${detected.defaultModel}`;
          }
        }
      } catch (err) {
        console.error('Detection error', err);
      }
    }, 150);
  });

  smartKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      connectKeyBtn.click();
    }
  });
}

if (connectKeyBtn) {
  connectKeyBtn.addEventListener('click', async () => {
    const key = smartKeyInput.value.trim();
    if (!key) {
      smartKeyInput.focus();
      return;
    }

    connectKeyBtn.disabled = true;
    connectKeyBtn.textContent = 'Connecting & Setting Default...';

    try {
      const res = await knotsApi.autoAddKey(key);
      if (res) {
        smartKeyInput.value = '';
        if (detectionPill) detectionPill.hidden = true;

        connectKeyBtn.textContent = `Connected: ${res.displayName}! ✓`;
        connectKeyBtn.classList.add('success');

        await refreshAllSettings();

        setTimeout(() => {
          connectKeyBtn.textContent = 'Connect Key & Set as Default';
          connectKeyBtn.classList.remove('success');
          connectKeyBtn.disabled = false;
        }, 2200);
      }
    } catch (err) {
      alert(`Failed to connect key: ${err?.message || err}`);
      connectKeyBtn.textContent = 'Connect Key & Set as Default';
      connectKeyBtn.disabled = false;
    }
  });
}

// ==========================================
// 4. Default Model & Connected Providers Display
// ==========================================
async function loadDefaultModel() {
  if (!knotsApi?.getDefaultModel) return;

  try {
    const def = await knotsApi.getDefaultModel();
    if (def) {
      const icon = PROVIDER_ICONS[def.provider] || '⚡';
      if (activeDefaultIcon) activeDefaultIcon.textContent = icon;
      if (activeDefaultName) activeDefaultName.textContent = def.label || def.provider;
      if (activeDefaultModelName) activeDefaultModelName.textContent = def.model;
      if (activeModelPill) activeModelPill.textContent = `${icon} ${def.provider}:${def.model}`;
      if (activeProviderTag) activeProviderTag.textContent = 'Active Default';
    }
  } catch (err) {
    console.error('Failed to load default model', err);
  }
}

async function loadConnectedProviders() {
  if (!knotsApi?.getConnectedProviders || !connectedProvidersList) return;

  try {
    const list = await knotsApi.getConnectedProviders();
    if (!list || list.length === 0) {
      connectedProvidersList.innerHTML = `
        <p class="muted" style="padding: 0.5rem 0;">No external API keys added yet. Paste any key above to automatically configure models.</p>
      `;
      return;
    }

    connectedProvidersList.innerHTML = '';
    list.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'connected-item';
      const icon = PROVIDER_ICONS[item.provider] || '⚡';
      div.innerHTML = `
        <div class="provider-badge-group">
          <span class="provider-icon-badge">${icon}</span>
          <div class="provider-details">
            <strong>${item.displayName}</strong>
            <span>Default: <code>${item.defaultModel}</code></span>
          </div>
        </div>
        <span class="connected-status-tag">Connected ✓</span>
      `;
      connectedProvidersList.appendChild(div);
    });
  } catch (err) {
    console.error('Failed to load connected providers', err);
  }
}

// ==========================================
// 5. Optional Model Overrides (Only if needed)
// ==========================================
if (toggleOverrideBtn && addOverrideForm) {
  toggleOverrideBtn.addEventListener('click', () => {
    addOverrideForm.hidden = !addOverrideForm.hidden;
    if (!addOverrideForm.hidden && overrideModelInput) {
      overrideModelInput.focus();
    }
  });
}

if (cancelOverrideBtn && addOverrideForm) {
  cancelOverrideBtn.addEventListener('click', () => {
    addOverrideForm.hidden = true;
  });
}

if (overrideTargetSelect && customOverrideNameGroup) {
  overrideTargetSelect.addEventListener('change', () => {
    customOverrideNameGroup.hidden = overrideTargetSelect.value !== 'custom';
  });
}

if (addOverrideForm) {
  addOverrideForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetType = overrideTargetSelect.value;
    const isCustom = targetType === 'custom';
    const customName = customOverrideName?.value?.trim() || 'Custom Bot';
    const targetId = isCustom ? customName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') : targetType;
    const targetName = isCustom ? customName : overrideTargetSelect.options[overrideTargetSelect.selectedIndex].text.split('(')[0].trim();

    const provider = overrideProviderSelect.value;
    const model = overrideModelInput.value.trim();

    if (!model) return;

    try {
      await knotsApi.addOverride({
        targetId,
        targetName,
        provider,
        model,
        label: `${targetName} (${provider}:${model})`,
      });

      overrideModelInput.value = '';
      if (customOverrideName) customOverrideName.value = '';
      addOverrideForm.hidden = true;

      await loadOverrides();
    } catch (err) {
      alert(`Failed to save override: ${err?.message || err}`);
    }
  });
}

async function loadOverrides() {
  if (!knotsApi?.getOverrides || !overridesList) return;

  try {
    const list = await knotsApi.getOverrides();
    if (!list || list.length === 0) {
      if (noOverridesMsg) noOverridesMsg.hidden = false;
      overridesList.innerHTML = '';
      if (noOverridesMsg) overridesList.appendChild(noOverridesMsg);
      return;
    }

    if (noOverridesMsg) noOverridesMsg.hidden = true;
    overridesList.innerHTML = '';

    list.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'override-item';
      const icon = PROVIDER_ICONS[item.provider] || '⚡';
      div.innerHTML = `
        <div class="override-item-left">
          <span style="font-size: 1.25rem;">${icon}</span>
          <div class="override-title">
            <strong>${item.targetName}</strong>
            <span>Model: <code>${item.provider}:${item.model}</code></span>
          </div>
        </div>
        <button type="button" class="delete-skill-btn" data-id="${item.id}">Remove Override</button>
      `;

      const removeBtn = div.querySelector('.delete-skill-btn');
      removeBtn.addEventListener('click', async () => {
        await knotsApi.removeOverride(item.id);
        await loadOverrides();
      });

      overridesList.appendChild(div);
    });
  } catch (err) {
    console.error('Failed to load overrides', err);
  }
}

// ==========================================
// 6. Workspace Directory (Safe PC Access)
// ==========================================
async function initWorkspace() {
  if (knotsApi?.getWorkspace && workspacePathPill) {
    try {
      const ws = await knotsApi.getWorkspace();
      if (ws) {
        workspacePathPill.textContent = `📁 ${ws}`;
        workspacePathPill.title = `Current workspace: ${ws} (Bots have safe project access here)`;
      }
    } catch (err) {
      console.error('Failed to get workspace', err);
    }

    workspacePathPill.addEventListener('click', async () => {
      if (knotsApi?.chooseFolder) {
        const folder = await knotsApi.chooseFolder();
        if (folder) {
          await knotsApi.setWorkspace(folder);
          workspacePathPill.textContent = `📁 ${folder}`;
          workspacePathPill.title = `Current workspace: ${folder} (Bots have safe project access here)`;
        }
      }
    });
  }
}

// Refresh all UI data
async function refreshAllSettings() {
  await Promise.all([loadDefaultModel(), loadConnectedProviders(), loadOverrides()]);
}

// Initial Boot
refreshAllSettings();
initWorkspace();
