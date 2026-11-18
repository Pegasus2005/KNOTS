import { copyFileSync, constants, existsSync } from 'node:fs';
import { dialog, type IpcMain } from 'electron';
import {
  getStrandApiKeyRef,
  KnotWorker,
  validateKnotSpec,
  resolveApiKey,
  resolveDefaultStrand,
  type KnotsCore,
} from '@knots/core';
import { createDefaultRegistry } from '@knots/providers';
import type { ProviderType, Strand } from '@knots/types';

interface StrandInput {
  name: string;
  provider: ProviderType;
  model: string;
  endpoint?: string;
  apiKey?: string;
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  core: KnotsCore,
  paths: { sample: string; bundledSample: string },
): void {
  const registry = createDefaultRegistry();
  const worker = new KnotWorker(core);
  const folderGrants = new Set<string>();

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
    knots: core.knots.listLoaded().map(({ spec }) => spec),
    strands: core.strands.getAll().map(({ api_key_ref, ...strand }) => ({
      ...strand,
      references: references(strand.name),
    })),
    runs: core.runs.getAll(20).map((run) => ({ ...run, activity: worker.activity(run.id) })),
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
        tools?: ('list_files' | 'read_file')[];
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
      },
    ) => {
      const knot = requireKnot(input.knotName);
      if (knot.tools?.length && (!input.folder || !folderGrants.has(input.folder))) {
        throw new Error('Grant a folder through the picker before running this knot.');
      }
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error('Enter a task for the knot.');
      const strand = input.strandId
        ? requireStrand(input.strandId)
        : resolveDefaultStrand(core, knot.lanes);
      const provider = await providerFor(strand);
      const runId = await worker.start({ knot, strand, prompt, folder: input.folder }, provider);
      return { runId, strandName: strand.name, model: strand.model };
    },
  );

  ipcMain.handle('runs:cancel', (_event, id: string) => core.runManager.cancelRun(id));
}
