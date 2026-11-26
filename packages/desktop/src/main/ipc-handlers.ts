import {
  copyFileSync,
  constants,
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { dialog, type IpcMain } from 'electron';
import {
  getStrandApiKeyRef,
  selectKnot,
  callReceipts,
  KnotWorker,
  KnotTeaching,
  KnotPlans,
  KnotKnowledge,
  postPlanMessage,
  listPlanMessages,
  type KnotPackage,
  validateKnotSpec,
  resolveApiKey,
  resolveDefaultStrand,
  type KnotsCore,
} from '@knots/core';
import { createDefaultRegistry } from '@knots/providers';
import type { ProviderType, Strand, StrandRouting } from '@knots/types';

interface StrandInput {
  name: string;
  provider: ProviderType;
  model: string;
  endpoint?: string;
  apiKey?: string;
  routing?: StrandRouting;
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  core: KnotsCore,
  paths: { sample: string; bundledSample: string; recover?: boolean },
): KnotWorker {
  const registry = createDefaultRegistry();
  const folderGrants = new Set<string>();
  const plannerRequests = new Map<number, AbortController>();
  let plans: KnotPlans;
  const worker = new KnotWorker(core, {
    beforeClose: () => plans?.settle() ?? Promise.resolve(),
    onStop: (mode) => {
      plans?.haltAll(mode);
      for (const controller of plannerRequests.values()) controller.abort();
      plannerRequests.clear();
    },
  });

  async function providerFor(strand: Strand) {
    const apiKey = await resolveApiKey(strand.provider, core, strand.api_key_ref);
    return registry.createFromStrand(strand, { api_key: apiKey });
  }

  plans = new KnotPlans(core, worker, providerFor);
  if (paths.recover) {
    plans.recover();
    plans.start();
    worker.recover(providerFor);
    worker.startControlPolling();
  }
  const teaching = new KnotTeaching(core, worker, providerFor);
  const knowledge = new KnotKnowledge(core);
  const imports = new Map<string, KnotPackage>();
  ipcMain.handle('knowledge:list', (_event, name: string) => knowledge.list(name));
  ipcMain.handle('knowledge:attach', async (_event, name: string) => {
    requireKnot(name);
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Text references', extensions: ['txt', 'md', 'csv', 'json', 'yaml', 'yml'] },
      ],
    });
    if (result.canceled) return;
    const file = result.filePaths[0];
    if (statSync(file).size > 262144) throw new Error('Choose a text reference up to 256 KB.');
    return knowledge.attach(name, basename(file), readFileSync(file, 'utf8'));
  });
  ipcMain.handle('knowledge:detach', (_event, name: string, ref: string) =>
    knowledge.detach(name, ref),
  );
  ipcMain.handle('knots:export', async (_event, name: string) => {
    const bundle = knowledge.export(name);
    const result = await dialog.showSaveDialog({
      defaultPath: name + '.knot.json',
      filters: [{ name: 'Knot package', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return;
    writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return result.filePath;
  });
  ipcMain.handle('knots:import-preview', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Knot package', extensions: ['json'] }],
    });
    if (result.canceled) return;
    const file = result.filePaths[0];
    if (statSync(file).size > 6000000) throw new Error('Package exceeds 6 MB.');
    const bundle = knowledge.validate(JSON.parse(readFileSync(file, 'utf8')));
    imports.clear();
    const token = randomUUID();
    imports.set(token, bundle);
    return {
      token,
      spec: bundle.spec,
      files: bundle.files.map(({ path, content }) => ({ path, characters: content.length })),
      missingStrands: [...new Set(Object.values(bundle.spec.lanes ?? {}).flat())].filter(
        (name) => !core.strands.getByName(name),
      ),
    };
  });
  ipcMain.handle('knots:import', (_event, token: string, name: string) => {
    const bundle = imports.get(token);
    if (!bundle) throw new Error('Preview the package again before importing.');
    const id = knowledge.import(bundle, name);
    imports.delete(token);
    return id;
  });
  const planGrants = (grants?: Record<string, { folder?: string; outputFolder?: string }>) => {
    if (!grants) return undefined;
    for (const access of Object.values(grants))
      for (const folder of [access.folder, access.outputFolder])
        if (folder && !folderGrants.has(folder))
          throw new Error('Grant task access through the native picker.');
    return grants;
  };
  ipcMain.handle('plans:create', (_event, goal, privacy) => plans.create(goal, privacy));
  ipcMain.handle('plans:edit', (_event, id, definition) => plans.edit(id, definition));
  ipcMain.handle('plans:approve', (_event, id, grants) => plans.approve(id, planGrants(grants)));
  ipcMain.handle('plans:resume', (_event, id, grants) => plans.resume(id, planGrants(grants)));
  ipcMain.handle('plans:pause', (_event, id) => plans.pause(id));
  ipcMain.handle('plans:cancel', (_event, id) => plans.cancel(id));
  ipcMain.handle('plans:messages', (_event, planId: string) => listPlanMessages(core, planId));
  ipcMain.handle(
    'plans:message',
    (_event, input: { planId: string; toTaskId?: string; body: string; privacy?: 'local_only' | 'cloud_allowed' }) =>
      postPlanMessage(core, {
        planId: input.planId,
        fromTaskId: 'user',
        toTaskId: input.toTaskId,
        body: input.body,
        privacy: input.privacy === 'cloud_allowed' ? 'cloud_allowed' : 'local_only',
      }),
  );
  ipcMain.handle('memory:list', () => core.memory.list());
  ipcMain.handle(
    'memory:add',
    (
      _event,
      input: {
        content: string;
        tags?: string[];
        privacy?: 'local_only' | 'cloud_allowed';
        sourceRunId?: string;
        sourceConversationId?: string;
      },
    ) => core.memory.remember(input),
  );
  ipcMain.handle('memory:remove', (_event, id: string) => core.memory.forget(id));
  ipcMain.handle('teaching:list', () => teaching.list());
  ipcMain.handle('teaching:create', (_event, input) => teaching.create(input));
  ipcMain.handle('teaching:evaluate', (_event, id, examples, strandId) =>
    teaching.evaluate(id, examples, strandId),
  );
  ipcMain.handle('teaching:assess', (_event, id, assessment) => teaching.assess(id, assessment));
  ipcMain.handle('teaching:decide', (_event, id, action) => teaching.decide(id, action));

  function requireStrand(id: string) {
    const strand = core.strands.getById(id);
    if (!strand) throw new Error('That strand no longer exists.');
    return strand;
  }

  function requireKnot(name: string) {
    if (!core.knots.list().includes(name)) throw new Error('That knot no longer exists.');
    const knot = core.knots.get(name);
    if (!knot) throw new Error('That knot no longer exists.');
    return knot.spec;
  }

  function references(name: string) {
    return [
      ...core.knots
        .listLoaded()
        .filter(({ spec }) => Object.values(spec.lanes ?? {}).some((order) => order.includes(name)))
        .map(({ spec }) => spec.display_name || spec.name),
      ...core.lanes
        .getAll()
        .filter((lane) => lane.strand_order.includes(name))
        .map((lane) => `Lane: ${lane.name}`),
    ];
  }

  function runView(run: NonNullable<ReturnType<typeof core.runs.getById>>) {
    return {
      conversationId: (
        core.database
          .getDb()
          .prepare('SELECT conversation_id FROM conversation_runs WHERE run_id = ?')
          .get(run.id) as { conversation_id: string } | undefined
      )?.conversation_id,

      job: worker.status(run.id),
      ...run,
      purpose: (
        core.database
          .getDb()
          .prepare('SELECT purpose FROM run_snapshots WHERE run_id = ?')
          .get(run.id) as { purpose: string } | undefined
      )?.purpose,
      activity: worker.activity(run.id),
      calls: callReceipts(core, run.id),
      mcpActions: worker.mcpTools.list(run.id),
      proposals: worker.reviewedFiles.list(run.id),
    };
  }
  ipcMain.handle('runs:get', (_event, id: string) => {
    const run = core.runs.getById(id);
    if (!run) throw new Error('Task not found.');
    return runView(run);
  });
  ipcMain.handle('conversations:get', (_event, id: string) => {
    const row = core.database.getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    if (!row) throw new Error('Conversation not found.');
    return {
      ...(row as object),
      runs: (
        core.database
          .getDb()
          .prepare('SELECT run_id FROM conversation_runs WHERE conversation_id = ? ORDER BY turn')
          .all(id) as { run_id: string }[]
      ).map(({ run_id }) => runView(core.runs.getById(run_id)!)),
    };
  });
  ipcMain.handle('workspace:get', () => ({
    conversations: core.database
      .getDb()
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 50')
      .all(),
    memories: core.memory.list(),
    mcpServers: worker.mcpTools.servers().map(({ keyRef, ...server }) => server),
    plans: plans.list(),
    worker: worker.control(),
    defaultStrandId: core.settings.get('default_strand_id') ?? null,
    knots: core.knots.listLoaded().map(({ spec }) => spec),
    strands: core.strands.getAll().map(({ api_key_ref, ...strand }) => ({
      ...strand,
      references: references(strand.name),
    })),
    runs: [
      ...new Map(
        [
          ...core.runs.getAll(20),
          ...(
            core.database
              .getDb()
              .prepare(
                "SELECT run_id FROM worker_jobs WHERE state NOT IN ('completed', 'failed', 'cancelled')",
              )
              .all() as { run_id: string }[]
          )
            .map(({ run_id }) => core.runs.getById(run_id)!)
            .filter(Boolean),
        ].map((run) => [run.id, run]),
      ).values(),
    ].map(runView),
  }));

  ipcMain.handle(
    'knots:save',
    (
      _event,
      input: {
        name: string;
        display_name: string;
        description: string;
        instructions: string;
        expected_output: string;
        editing: boolean;
        preferredStrand?: string;
        inspectStrands?: string;
        deliverStrands?: string;
        privacy?: string;
        maxCost?: string;
        maxOutputTokens?: string;
        tools?: ('list_files' | 'read_file' | 'create_file' | 'mcp_call' | 'memory')[];
        integrations?: string;
      },
    ) => {
      const name = input.name.trim();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
        throw new Error(
          'Use a knot ID with up to 64 lowercase letters, numbers, hyphens, or underscores.',
        );
      }
      const exists = core.knots.list().includes(name);
      if (!input.editing && exists) throw new Error('That knot ID is already in use.');
      const existing =
        input.editing && exists ? core.knots.get(name, { resolveKnowledgeRefs: false }) : undefined;
      if (input.editing && !existing) throw new Error('That knot no longer exists.');

      const spec = {
        version: '0.1.0',
        ...existing?.spec,
        name,
        tools: input.tools ?? existing?.spec.tools,
        integrations: input.integrations?.trim()
          ? JSON.parse(input.integrations)
          : existing?.spec.integrations,
        display_name: input.display_name.trim(),
        description: input.description.trim(),
        instructions: input.instructions.trim(),
        expected_output: input.expected_output.trim() || undefined,
      };
      if (!spec.display_name || !spec.description || !spec.instructions) {
        throw new Error('Enter a display name, a job description, and instructions.');
      }
      if (
        input.preferredStrand !== undefined &&
        input.preferredStrand !== (existing?.spec.lanes?.default?.[0] ?? '')
      ) {
        if (
          input.preferredStrand &&
          !core.strands.getByName(input.preferredStrand) &&
          !existing?.spec.lanes?.default?.includes(input.preferredStrand)
        ) {
          throw new Error('Choose a saved strand.');
        }
        spec.lanes = {
          ...existing?.spec.lanes,
          default: input.preferredStrand ? [input.preferredStrand] : [],
        };
      }
      for (const [stage, value] of [
        ['inspect', input.inspectStrands],
        ['deliver', input.deliverStrands],
      ] as const) {
        if (value !== undefined) {
          const names = value
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean);
          const previous = existing?.spec.lanes?.[stage] ?? [];
          if (names.some((name) => !core.strands.getByName(name) && !previous.includes(name))) {
            throw new Error('Lane preferences must use saved strand names.');
          }
          spec.lanes = { ...spec.lanes, [stage]: [...new Set(names)] };
        }
      }
      if (
        input.privacy !== undefined ||
        input.maxCost !== undefined ||
        input.maxOutputTokens !== undefined
      ) {
        spec.model_preferences = {
          ...spec.model_preferences,
          ...(input.maxOutputTokens !== undefined
            ? {
                max_output_tokens: input.maxOutputTokens.trim()
                  ? Number(input.maxOutputTokens)
                  : undefined,
              }
            : {}),
          ...(input.privacy !== undefined
            ? { privacy: input.privacy as 'any' | 'local_only' | 'local_preferred' }
            : {}),
          ...(input.maxCost !== undefined
            ? { max_cost_per_run: input.maxCost.trim() ? Number(input.maxCost) : undefined }
            : {}),
        };
      }
      const validation = validateKnotSpec(spec);
      if (!validation.valid) throw new Error(validation.errors.join(' '));

      core.knots.save(spec, { overwrite: input.editing, backup: input.editing });
      return name;
    },
  );

  ipcMain.handle('knots:sample', () => {
    if (!existsSync(paths.sample)) {
      copyFileSync(paths.bundledSample, paths.sample, constants.COPYFILE_EXCL);
    }
    return 'contract-reviewer';
  });

  ipcMain.handle('strands:add', async (_event, input: StrandInput) => {
    const name = input.name.trim();
    const model = input.model.trim();
    const endpoint = input.endpoint?.trim() || undefined;
    const key = input.apiKey?.trim();
    if (!name || !model || !registry.has(input.provider)) {
      throw new Error('Enter a name, provider, and model.');
    }
    if (endpoint && !['http:', 'https:'].includes(new URL(endpoint).protocol)) {
      throw new Error('Use an HTTP or HTTPS endpoint.');
    }
    if (input.provider === 'openai-compatible' && !endpoint) {
      throw new Error('Enter a base URL for the model endpoint.');
    }
    if (core.strands.getByName(name)) throw new Error('A strand with that name already exists.');

    const keyRef = key ? getStrandApiKeyRef(name) : undefined;
    const strand = core.strands.create({
      name,
      model,
      endpoint,
      provider: input.provider,
      api_key_ref: keyRef,
      routing: input.routing,
      is_local:
        input.provider === 'ollama' &&
        (!endpoint || ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)),
    });
    try {
      if (key && keyRef) await core.credentials.setApiKey(keyRef, key);
    } catch (error) {
      core.strands.delete(strand.id);
      throw error;
    }
    return strand.id;
  });

  ipcMain.handle('strands:routing', (_event, id: string, routing: StrandRouting) => {
    requireStrand(id);
    core.strands.update(id, { routing });
  });

  ipcMain.handle('strands:default', (_event, id: string) => {
    requireStrand(id);
    core.settings.set('default_strand_id', id);
  });

  ipcMain.handle('tasks:plan', async (event, prompt: string) => {
    if (!worker.control().enabled) throw new Error('Enable dispatch before selecting a bot.');
    if (plannerRequests.has(event.sender.id)) throw new Error('A selection is already running.');
    const controller = new AbortController();
    plannerRequests.set(event.sender.id, controller);
    const abort = () => controller.abort();
    event.sender.once('destroyed', abort);
    try {
      const strand = resolveDefaultStrand(core);
      const knots = core.knots
        .listLoaded()
        .map(({ spec }) => spec)
        .filter((knot) => knot.model_preferences?.privacy !== 'local_only' || strand.is_local);
      const plan = await selectKnot(
        prompt,
        knots,
        strand,
        await providerFor(strand),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      return plan;
    } finally {
      event.sender.removeListener('destroyed', abort);
      plannerRequests.delete(event.sender.id);
    }
  });
  ipcMain.handle('tasks:cancel-plan', (event) => {
    plannerRequests.get(event.sender.id)?.abort();
  });

  ipcMain.handle('strands:test', async (_event, id: string) => {
    const strand = requireStrand(id);
    const provider = await providerFor(strand);
    const result = await provider.testConnection();
    const model =
      strand.provider === 'ollama' && !strand.model.includes(':')
        ? `${strand.model}:latest`
        : strand.model;
    if (
      result.success &&
      strand.provider === 'ollama' &&
      result.models_available &&
      !result.models_available.includes(strand.model) &&
      !result.models_available.includes(model)
    ) {
      return {
        ...result,
        success: false,
        error: `Endpoint reached, but "${strand.model}" was not listed.`,
      };
    }
    return result;
  });

  ipcMain.handle('strands:remove', async (_event, id: string) => {
    const strand = requireStrand(id);
    if (strand.api_key_ref) await core.credentials.deleteApiKey(strand.api_key_ref);
    return core.strands.delete(id);
  });

  ipcMain.handle('runs:preview', (_event, name: string) => {
    const knot = requireKnot(name);
    if (!core.strands.getAll().length) return null;
    return resolveDefaultStrand(core, knot.lanes).id;
  });

  ipcMain.handle('folder:choose', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    const folder = result.canceled ? null : result.filePaths[0];
    if (folder) folderGrants.add(folder);
    return folder;
  });

  ipcMain.handle(
    'runs:start',
    async (
      _event,
      input: {
        knotName: string;
        prompt: string;
        strandId?: string;
        folder?: string;
        outputFolder?: string;
        selectionReason?: string;
        conversationId?: string;
        allowKnotSwitch?: boolean;
      },
    ) => {
      const knot = requireKnot(input.knotName);
      if (
        knot.tools?.some((tool) => ['list_files', 'read_file'].includes(tool)) &&
        (!input.folder || !folderGrants.has(input.folder))
      ) {
        throw new Error('Grant a folder through the picker before running this knot.');
      }
      if (
        knot.tools?.includes('create_file') &&
        (!input.outputFolder || !folderGrants.has(input.outputFolder))
      ) {
        throw new Error('Grant an output folder through the picker before running this knot.');
      }
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error('Enter a task for the knot.');
      const strand = input.strandId
        ? requireStrand(input.strandId)
        : resolveDefaultStrand(core, knot.lanes);
      const runId = await worker.start(
        {
          conversation: input.conversationId
            ? { id: input.conversationId, allowKnotSwitch: Boolean(input.allowKnotSwitch) }
            : { id: randomUUID(), title: prompt.slice(0, 80) },
          knot,
          strand,
          prompt,
          folder: input.folder,
          outputFolder: input.outputFolder,
          selectionReason: input.selectionReason,
          pinnedStrandId: input.strandId,
        },
        providerFor,
      );
      return {
        runId,
        conversationId: (
          core.database
            .getDb()
            .prepare('SELECT conversation_id FROM conversation_runs WHERE run_id = ?')
            .get(runId) as { conversation_id: string }
        ).conversation_id,
        strandName: strand.name,
        model: strand.model,
      };
    },
  );

  ipcMain.handle('actions:decide', (_event, id: string, approve: boolean) => {
    if (typeof approve !== 'boolean') throw new Error('Choose approve or reject.');
    worker.reviewedFiles.decide(id, approve);
  });

  function renewedGrants(id: string, grants?: { folder?: string; outputFolder?: string }) {
    if (!grants) return undefined;
    const status = worker.status(id);
    if (!status) throw new Error('Saved worker job not found.');
    if (
      (status.folder && (!grants.folder || !folderGrants.has(grants.folder))) ||
      (status.outputFolder && (!grants.outputFolder || !folderGrants.has(grants.outputFolder)))
    )
      throw new Error('Renew folder access through the native picker.');
    return grants;
  }
  ipcMain.handle(
    'mcp:save',
    async (_event, input: { name: string; endpoint: string; token?: string }) => {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.name))
        throw new Error('Use a lowercase server name.');
      const previous = worker.mcpTools.servers().find((server) => server.name === input.name);
      const keyRef = input.token?.trim()
        ? 'mcp:' + randomUUID()
        : previous?.endpoint === input.endpoint
          ? previous.keyRef
          : undefined;
      // Validate the endpoint before storing any credential.
      const { serverURL } = await import('@knots/core');
      serverURL(input.endpoint);
      if (input.token?.trim() && keyRef)
        await core.credentials.setApiKey(keyRef, input.token.trim());
      worker.mcpTools.save({ name: input.name, endpoint: input.endpoint, keyRef });
      if (previous?.keyRef && previous.keyRef !== keyRef)
        await core.credentials.deleteApiKey(previous.keyRef);
    },
  );
  ipcMain.handle('mcp:remove', async (_event, name: string) => {
    const server = worker.mcpTools.servers().find((item) => item.name === name);
    worker.mcpTools.remove(name);
    if (server?.keyRef) await core.credentials.deleteApiKey(server.keyRef);
  });
  ipcMain.handle('mcp:inspect', (_event, name: string) =>
    worker.mcpTools.inspect(name, new AbortController().signal),
  );
  ipcMain.handle('mcp:decide', (_event, id: string, approve: boolean) => {
    if (typeof approve !== 'boolean') throw new Error('Choose approve or reject.');
    worker.mcpTools.decide(id, approve);
  });
  ipcMain.handle('mcp:reconcile', (_event, runId: string, id: string, result: string) =>
    worker.mcpTools.reconcile(runId, id, result),
  );
  ipcMain.handle('runs:cancel', (_event, id: string) => worker.cancel(id));
  ipcMain.handle('runs:pause', (_event, id: string) => worker.pause(id));
  ipcMain.handle('runs:resume', (_event, id: string, grants, reply) =>
    worker.resume(id, renewedGrants(id, grants), reply),
  );
  ipcMain.handle('actions:reconcile', (_event, runId: string, id: string, mode, grants) =>
    worker.reconcile(runId, id, mode, renewedGrants(runId, grants)),
  );
  ipcMain.handle('worker:stop', () => worker.stopAll());
  ipcMain.handle('app:kill-all', () => worker.stopAll());
  ipcMain.handle('worker:enable', () => worker.enableDispatch());
  return worker;
}
