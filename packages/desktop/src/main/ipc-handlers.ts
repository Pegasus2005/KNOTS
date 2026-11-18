/**
 * IPC handlers — wires all ipcMain.handle channels to @knots/core + @knots/providers.
 *
 * Channels:
 *   knots:list, knots:get, knots:create, knots:validate
 *   strands:list, strands:add, strands:test, strands:remove
 *   lanes:list, lanes:set, lanes:remove
 *   runs:start (streams chunks), runs:cancel, runs:list
 *   settings:get, settings:set
 *   app:kill-all
 *   glassbar:hide
 */
import type { IpcMain, BrowserWindow } from 'electron';
import type { KnotsCore } from '@knots/core';
import { createDefaultRegistry } from '@knots/providers';
import type { ProviderType, ModelCapability } from '@knots/types';

type WindowGetter = () => BrowserWindow | null;

export function registerIpcHandlers(
  ipcMain: IpcMain,
  core: KnotsCore,
  windows: { getDashboard: WindowGetter; getGlassBar: WindowGetter },
): void {
  // ── Knots ────────────────────────────────────────────────────────────────
  ipcMain.handle('knots:list', async () => {
    try {
      const knots = await core.knots.listKnots();
      return { ok: true, data: knots };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('knots:get', async (_event, name: string) => {
    try {
      const knot = await core.knots.loadKnot(name);
      return { ok: true, data: knot };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('knots:create', async (_event, spec: Record<string, unknown>) => {
    try {
      const knot = await core.knots.saveKnot(spec as Parameters<typeof core.knots.saveKnot>[0]);
      return { ok: true, data: knot };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('knots:validate', async (_event, spec: Record<string, unknown>) => {
    try {
      const { validateKnotSpec } = await import('@knots/core');
      const result = validateKnotSpec(spec);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Strands ──────────────────────────────────────────────────────────────
  ipcMain.handle('strands:list', async () => {
    try {
      const strands = core.strands.getAll();
      return { ok: true, data: strands };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('strands:add', async (_event, input: {
    name: string;
    provider: ProviderType;
    model: string;
    endpoint?: string;
    apiKey?: string;
    capabilities?: ModelCapability[];
    is_local?: boolean;
  }) => {
    try {
      // Store API key in keychain if provided
      if (input.apiKey) {
        await core.credentials.set(`strand-${input.name}`, input.apiKey);
      }
      const strand = core.strands.create({
        name: input.name,
        provider: input.provider,
        model: input.model,
        endpoint: input.endpoint,
        capabilities: input.capabilities ?? [],
        is_local: input.is_local ?? input.provider === 'ollama',
      });
      return { ok: true, data: strand };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('strands:test', async (_event, strandId: string) => {
    try {
      const strand = core.strands.getById(strandId);
      if (!strand) return { ok: false, error: 'Strand not found' };

      const registry = createDefaultRegistry();
      let apiKey: string | undefined;
      try {
        apiKey = await core.credentials.get(`strand-${strand.name}`);
      } catch {
        // no key stored
      }

      const provider = registry.create(strand.provider, {
        type: strand.provider,
        endpoint: strand.endpoint,
        api_key: apiKey,
        default_model: strand.model,
      });

      const result = await provider.testConnection();
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('strands:remove', async (_event, strandId: string) => {
    try {
      const strand = core.strands.getById(strandId);
      const deleted = core.strands.delete(strandId);
      if (strand) {
        try { await core.credentials.delete(`strand-${strand.name}`); } catch { /* ok */ }
      }
      return { ok: true, data: deleted };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Lanes ────────────────────────────────────────────────────────────────
  ipcMain.handle('lanes:list', async () => {
    try {
      const lanes = core.lanes.getAll();
      return { ok: true, data: lanes };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('lanes:set', async (_event, input: { name: string; strand_order: string[] }) => {
    try {
      const existing = core.lanes.getByName(input.name);
      let lane;
      if (existing) {
        lane = core.lanes.update(existing.id, { strand_order: input.strand_order });
      } else {
        lane = core.lanes.create({ name: input.name, strand_order: input.strand_order });
      }
      return { ok: true, data: lane };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('lanes:remove', async (_event, laneId: string) => {
    try {
      const deleted = core.lanes.delete(laneId);
      return { ok: true, data: deleted };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Runs ─────────────────────────────────────────────────────────────────
  ipcMain.handle('runs:start', async (event, input: {
    knotName: string;
    prompt: string;
    strandId?: string;
    laneId?: string;
  }) => {
    try {
      // Resolve strand
      let strand = input.strandId ? core.strands.getById(input.strandId) : undefined;
      if (!strand) {
        // Try default lane
        const defaultLaneName = core.settings.get('default_lane') as string | undefined ?? 'default';
        const lane = core.lanes.getByName(defaultLaneName);
        if (lane && lane.strand_order.length > 0) {
          strand = core.strands.getByName(lane.strand_order[0]!);
        }
        // Fall back to first available strand
        if (!strand) {
          const all = core.strands.getAll();
          strand = all[0];
        }
      }

      if (!strand) {
        return { ok: false, error: 'No strand available. Add a model connection first.' };
      }

      // Load knot
      let systemPrompt = '';
      try {
        const knotData = await core.knots.loadKnot(input.knotName);
        systemPrompt = knotData.spec.instructions;
      } catch {
        systemPrompt = '';
      }

      // Create run
      const ctx = core.runManager.createRun({
        knotName: input.knotName,
        input: input.prompt,
        strandId: strand.id,
        strandName: strand.name,
        systemPrompt,
      });

      const runId = ctx.runId;

      // Build provider
      const registry = createDefaultRegistry();
      let apiKey: string | undefined;
      try {
        apiKey = await core.credentials.get(`strand-${strand.name}`);
      } catch { /* ok */ }

      const provider = registry.create(strand.provider, {
        type: strand.provider,
        endpoint: strand.endpoint,
        api_key: apiKey,
        default_model: strand.model,
      });

      // Fire-and-forget streaming run
      const webContents = event.sender;
      (async () => {
        try {
          core.runManager.startRun(runId);

          const messages = ctx.messages.length > 0 ? ctx.messages : [
            { role: 'user' as const, content: input.prompt },
          ];

          let accText = '';
          let totalIn = 0;
          let totalOut = 0;

          for await (const chunk of provider.streamChat({
            messages,
            model: strand!.model,
            system: systemPrompt || undefined,
            stream: true,
          })) {
            if (ctx.isCancelled) break;

            core.runManager.progressRun(runId, chunk.delta);
            accText += chunk.delta;

            if (chunk.usage) {
              totalIn = chunk.usage.prompt_tokens;
              totalOut = chunk.usage.completion_tokens;
            }

            webContents.send('run:chunk', {
              runId,
              delta: chunk.delta,
              isFinal: chunk.is_final,
              model: chunk.model ?? strand!.model,
              strandName: strand!.name,
            });
          }

          if (!ctx.isCancelled) {
            core.runManager.completeRun(runId, {
              output: accText,
              modelUsed: strand!.model,
              tokensIn: totalIn,
              tokensOut: totalOut,
            });
            webContents.send('run:complete', { runId, output: accText });
          }
        } catch (err) {
          const errMsg = String(err);
          core.runManager.failRun(runId, errMsg);
          webContents.send('run:error', { runId, error: errMsg });
        }
      })();

      return { ok: true, data: { runId, strandName: strand.name, model: strand.model } };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('runs:cancel', async (_event, runId: string) => {
    try {
      const cancelled = core.runManager.cancelRun(runId);
      return { ok: true, data: cancelled };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('runs:list', async (_event, limit = 50) => {
    try {
      const runs = core.runs.getRecent(limit);
      return { ok: true, data: runs };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', async (_event, key?: string) => {
    try {
      if (key) {
        return { ok: true, data: core.settings.get(key) };
      }
      return { ok: true, data: core.settings.getAll() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: unknown) => {
    try {
      core.settings.set(key, value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── App kill switch ───────────────────────────────────────────────────────
  ipcMain.handle('app:kill-all', async () => {
    try {
      const count = core.runManager.cancelAll('Emergency kill switch triggered');
      // Notify both windows
      const dashboard = windows.getDashboard();
      const glassBar = windows.getGlassBar();
      dashboard?.webContents.send('kill-all', { cancelledCount: count });
      glassBar?.webContents.send('kill-all', { cancelledCount: count });
      return { ok: true, data: { cancelledCount: count } };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Glass bar ─────────────────────────────────────────────────────────────
  ipcMain.handle('glassbar:hide', async () => {
    const glassBar = windows.getGlassBar();
    if (glassBar) glassBar.hide();
    return { ok: true };
  });
}
