// KNOTS — User-Centric Multi-Agent Desktop Application

const knotsApi = window.knots;

// Elements
const navButtons = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');
const breadcrumb = document.getElementById('breadcrumb');
const activeModelPill = document.getElementById('active-model-pill');

// Swarm Elements
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

// Roles Elements
const saveAllRolesBtn = document.getElementById('save-all-roles');
const saveKeyButtons = document.querySelectorAll('.save-key-btn');
const roleCards = document.querySelectorAll('.role-card');

// Navigation Tabs
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

// Prompt Chips
chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    swarmPrompt.value = chip.dataset.prompt;
    swarmPrompt.focus();
  });
});

// Copy Deliverable
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

// Role Icons map
const ROLE_ICONS = {
  orchestrator: '🧠',
  coder: '💻',
  researcher: '🌐',
  reviewer: '✍️',
  custom: '🤖',
};

// Swarm Live Stream Listener
if (knotsApi?.onSwarmEvent) {
  knotsApi.onSwarmEvent((event) => {
    if (!event) return;

    if (event.type === 'plan') {
      const plan = event.plan;
      teamContainer.hidden = false;
      teamStrategy.textContent = plan.strategy || 'Team assembled.';
      swarmStatusPill.textContent = `${plan.bots.length} Bots Assembled`;
      swarmStatusPill.className = 'pill';

      // Render Bot Cards
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

// Swarm Submit Handler
swarmForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = swarmPrompt.value.trim();
  if (!prompt) return;

  submitSwarm.disabled = true;
  submitSwarm.textContent = 'Orchestrating...';
  teamContainer.hidden = false;
  teamStrategy.textContent = '🧠 Orchestrator is analyzing prompt & designing team...';
  botsGrid.innerHTML = '';
  deliverableContainer.hidden = true;
  deliverableText.textContent = '';

  try {
    const result = await knotsApi.runSwarm(prompt);
    if (result?.deliverable) {
      deliverableContainer.hidden = false;
      deliverableText.textContent = result.deliverable;
      swarmStatusPill.textContent = 'Task Completed ✓';
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

// === Load & Save Roles / Keys ===
async function loadRolesAndKeys() {
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

// Save individual API key
saveKeyButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.provider;
    const input = document.getElementById(`key-${provider}`);
    const keyVal = input ? input.value.trim() : '';

    if (!keyVal) return;

    try {
      await knotsApi.saveKey(provider, keyVal);
      const original = btn.textContent;
      btn.textContent = 'Saved ✓';
      btn.classList.add('success');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('success');
      }, 2000);
    } catch (err) {
      alert(`Failed to save key: ${err?.message || err}`);
    }
  });
});

// Save all role assignments
saveAllRolesBtn.addEventListener('click', async () => {
  try {
    for (const card of roleCards) {
      const role = card.dataset.role;
      const providerSelect = card.querySelector('.role-provider-select');
      const modelInput = card.querySelector('.role-model-input');

      const binding = {
        role,
        provider: providerSelect.value,
        model: modelInput.value.trim() || 'default',
        label: `${providerSelect.value}:${modelInput.value.trim()}`,
      };

      await knotsApi.setRole(role, binding);
    }

    const original = saveAllRolesBtn.textContent;
    saveAllRolesBtn.textContent = 'Saved All Changes ✓';
    saveAllRolesBtn.classList.add('success');
    await loadRolesAndKeys();

    setTimeout(() => {
      saveAllRolesBtn.textContent = original;
      saveAllRolesBtn.classList.remove('success');
    }, 2000);
  } catch (err) {
    alert(`Failed to save roles: ${err?.message || err}`);
  }
});

// Initialize on load
loadRolesAndKeys();
