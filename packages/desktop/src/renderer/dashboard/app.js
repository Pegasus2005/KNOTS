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

// Smart Key Elements
const smartKeyInput = document.getElementById('smart-key-input');
const detectionPill = document.getElementById('detection-pill');
const detectedProviderName = document.getElementById('detected-provider-name');
const detectedModelHint = document.getElementById('detected-model-hint');
const connectKeyBtn = document.getElementById('connect-key-btn');
const connectedProvidersList = document.getElementById('connected-providers-list');

// Roles & Custom Skills Elements
const saveAllRolesBtn = document.getElementById('save-all-roles');
const roleCards = document.querySelectorAll('.role-card');
const addCustomSkillBtn = document.getElementById('add-custom-skill-btn');
const addCustomSkillForm = document.getElementById('add-custom-skill-form');
const cancelCustomSkillBtn = document.getElementById('cancel-custom-skill-btn');
const newSkillName = document.getElementById('new-skill-name');
const newSkillDesc = document.getElementById('new-skill-desc');
const newSkillProvider = document.getElementById('new-skill-provider');
const newSkillModel = document.getElementById('new-skill-model');
const customSkillsSection = document.getElementById('custom-skills-section');
const customSkillsList = document.getElementById('custom-skills-list');

// Role Icons
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
      roles: 'Workspace / Keys & Roles',
      history: 'Workspace / History',
    };
    breadcrumb.textContent = labels[viewName] || 'Workspace';
  });
});

// Quick-fill Prompt Chips
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
        badge.textContent = 'Working...';
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
          write_file: '📄 Created/Wrote',
          read_file: '🔍 Read File',
          list_files: '📂 Listed Workspace',
          run_command: '⚙ Executed Command',
        };
        const title = icons[action.action] || '⚡ Executed';
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
// 3. Smart Auto-Detect Key Input
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
            detectedModelHint.textContent = `Default: ${detected.defaultModel}`;
          }
        }
      } catch (err) {
        console.error('Detection error', err);
      }
    }, 150);
  });

  // Enter key connects
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
    connectKeyBtn.textContent = 'Detecting & Connecting...';

    try {
      const res = await knotsApi.autoAddKey(key);
      if (res?.success) {
        smartKeyInput.value = '';
        if (detectionPill) detectionPill.hidden = true;

        connectKeyBtn.textContent = `Connected: ${res.displayName}! ✓`;
        connectKeyBtn.classList.add('success');

        await refreshAllSettings();

        setTimeout(() => {
          connectKeyBtn.textContent = 'Connect Key & Auto-Configure Defaults';
          connectKeyBtn.classList.remove('success');
          connectKeyBtn.disabled = false;
        }, 2200);
      }
    } catch (err) {
      alert(`Failed to connect key: ${err?.message || err}`);
      connectKeyBtn.textContent = 'Connect Key & Auto-Configure Defaults';
      connectKeyBtn.disabled = false;
    }
  });
}

// ==========================================
// 4. Connected Providers List
// ==========================================
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
// 5. Bot Roles & Model Mappings
// ==========================================
async function loadRoles() {
  if (!knotsApi?.getRoles) return;

  try {
    const roles = await knotsApi.getRoles();
    if (roles) {
      roleCards.forEach((card) => {
        const role = card.dataset.role;
        const binding = roles[role];
        if (binding) {
          const providerSelect = card.querySelector('.role-provider-select');
          const modelInput = card.querySelector('.role-model-input');
          if (providerSelect && binding.provider) providerSelect.value = binding.provider;
          if (modelInput && binding.model) modelInput.value = binding.model;
        }
      });

      if (roles.orchestrator) {
        activeModelPill.textContent = `🧠 ${roles.orchestrator.provider}:${roles.orchestrator.model}`;
      }
    }
  } catch (err) {
    console.error('Failed to load roles', err);
  }
}

// Save All Roles Button
if (saveAllRolesBtn) {
  saveAllRolesBtn.addEventListener('click', async () => {
    try {
      for (const card of roleCards) {
        const role = card.dataset.role;
        const providerSelect = card.querySelector('.role-provider-select');
        const modelInput = card.querySelector('.role-model-input');

        if (providerSelect && modelInput) {
          const binding = {
            role,
            provider: providerSelect.value,
            model: modelInput.value.trim() || 'default',
            label: `${providerSelect.value}:${modelInput.value.trim()}`,
          };
          await knotsApi.setRole(role, binding);
        }
      }

      const original = saveAllRolesBtn.textContent;
      saveAllRolesBtn.textContent = 'Saved All Changes ✓';
      saveAllRolesBtn.classList.add('success');
      await loadRoles();

      setTimeout(() => {
        saveAllRolesBtn.textContent = original;
        saveAllRolesBtn.classList.remove('success');
      }, 2000);
    } catch (err) {
      alert(`Failed to save role mappings: ${err?.message || err}`);
    }
  });
}

// ==========================================
// 6. Custom Skills
// ==========================================
if (addCustomSkillBtn && addCustomSkillForm) {
  addCustomSkillBtn.addEventListener('click', () => {
    addCustomSkillForm.hidden = !addCustomSkillForm.hidden;
    if (!addCustomSkillForm.hidden && newSkillName) {
      newSkillName.focus();
    }
  });
}

if (cancelCustomSkillBtn && addCustomSkillForm) {
  cancelCustomSkillBtn.addEventListener('click', () => {
    addCustomSkillForm.hidden = true;
  });
}

if (addCustomSkillForm) {
  addCustomSkillForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = newSkillName.value.trim();
    const desc = newSkillDesc.value.trim();
    const provider = newSkillProvider.value;
    const model = newSkillModel.value.trim() || 'default';

    if (!name) return;

    try {
      await knotsApi.addCustomSkill({
        name,
        description: desc,
        binding: {
          role: 'custom',
          provider,
          model,
          label: `${name} (${provider}:${model})`,
        },
      });

      newSkillName.value = '';
      newSkillDesc.value = '';
      newSkillModel.value = '';
      addCustomSkillForm.hidden = true;

      await loadCustomSkills();
    } catch (err) {
      alert(`Failed to add custom skill: ${err?.message || err}`);
    }
  });
}

async function loadCustomSkills() {
  if (!knotsApi?.getCustomSkills || !customSkillsList || !customSkillsSection) return;

  try {
    const skills = await knotsApi.getCustomSkills();
    if (!skills || skills.length === 0) {
      customSkillsSection.hidden = true;
      customSkillsList.innerHTML = '';
      return;
    }

    customSkillsSection.hidden = false;
    customSkillsList.innerHTML = '';

    skills.forEach((skill) => {
      const card = document.createElement('div');
      card.className = 'role-card';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';

      card.innerHTML = `
        <div class="role-title" style="margin-bottom: 0;">
          <span class="role-icon">🤖</span>
          <div>
            <strong>${skill.name}</strong>
            <p class="muted">${skill.description || 'Custom specialized skill'} &bull; <code>${skill.binding.provider}:${skill.binding.model}</code></p>
          </div>
        </div>
        <button type="button" class="delete-skill-btn" data-id="${skill.id}">Remove</button>
      `;

      const removeBtn = card.querySelector('.delete-skill-btn');
      removeBtn.addEventListener('click', async () => {
        if (confirm(`Remove custom skill "${skill.name}"?`)) {
          await knotsApi.removeCustomSkill(skill.id);
          await loadCustomSkills();
        }
      });

      customSkillsList.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load custom skills', err);
  }
}

// ==========================================
// 7. Workspace Management (PC Access)
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
  await Promise.all([loadConnectedProviders(), loadRoles(), loadCustomSkills()]);
}

// Initial Boot
refreshAllSettings();
initWorkspace();
