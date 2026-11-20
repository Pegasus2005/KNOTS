import { copyFileSync, constants, existsSync } from 'node:fs';
import { dialog, type IpcMain } from 'electron';
import {
  getStrandApiKeyRef,
  selectKnot,
  callReceipts,
  KnotWorker,
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
  paths: { sample: string; bundledSample: string },
): void {
  const registry = createDefaultRegistry();
  const worker = new KnotWorker(core);
  const folderGrants = new Set<string>();
  const plannerRequests = new Map<number, AbortController>();

  async function providerFor(strand: Strand) {
    const apiKey = await resolveApiKey(strand.provider, core, strand.api_key_ref);
    return registry.createFromStrand(strand, { api_key: apiKey });
  }

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

  ipcMain.handle('workspace:get', () => ({
    defaultStrandId: core.settings.get('default_strand_id') ?? null,
    knots: core.knots.listLoaded().map(({ spec }) => spec),
    strands: core.strands.getAll().map(({ api_key_ref, ...strand }) => ({
      ...strand,
      references: references(strand.name),
    })),
    runs: core.runs.getAll(20).map((run) => ({
      ...run,
      activity: worker.activity(run.id),
      calls: callReceipts(core, run.id),
      proposals: worker.reviewedFiles.list(run.id),
    })),
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
        tools?: ('list_files' | 'read_file' | 'create_file')[];
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
      },
    ) => {
      const knot = requireKnot(input.knotName);
      if (
        knot.tools?.some((tool) => tool !== 'create_file') &&
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
      return { runId, strandName: strand.name, model: strand.model };
    },
  );

  ipcMain.handle('actions:decide', (_event, id: string, approve: boolean) => {
    if (typeof approve !== 'boolean') throw new Error('Choose approve or reject.');
    worker.reviewedFiles.decide(id, approve);
  });

  ipcMain.handle('runs:cancel', (_event, id: string) => core.runManager.cancelRun(id));
}
