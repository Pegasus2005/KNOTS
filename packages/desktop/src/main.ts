import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
} from 'electron';
import { createCore } from '@knots/core';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './main/ipc-handlers.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
let dashboard: BrowserWindow | null = null;
let tray: Tray | null = null;
let glassbar: BrowserWindow | null = null;
let shortcutRegistered = false;
const quickShortcut = 'CommandOrControl+Shift+Space';
if (process.argv.includes('--smoke-test') && process.env.KNOTS_DATA_DIR)
  app.setPath('userData', join(resolve(process.env.KNOTS_DATA_DIR), 'electron-smoke'));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (!dashboard) openDashboard();
  dashboard?.show();
  dashboard?.focus();
});

function openDashboard(): void {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.show();
    dashboard.focus();
    return;
  }
  dashboard = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 680,
    minHeight: 580,
    title: 'KNOTS',
    backgroundColor: '#141519',
    webPreferences: {
      preload: file('./preload/dashboard-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  dashboard.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dashboard.webContents.on('will-navigate', (event) => event.preventDefault());
  dashboard.on('closed', () => {
    dashboard = null;
  });
  void dashboard.loadFile(file('./renderer/dashboard/index.html')).catch(reportStartupError);
}

function toggleGlassbar(): void {
  if (glassbar && !glassbar.isDestroyed()) {
    if (glassbar.isVisible()) glassbar.hide();
    else {
      glassbar.show();
      glassbar.focus();
    }
    return;
  }
  glassbar = new BrowserWindow({
    width: 760,
    height: 680,
    minWidth: 480,
    minHeight: 480,
    title: 'KNOTS quick bar',
    alwaysOnTop: true,
    backgroundColor: '#212121',
    webPreferences: {
      preload: file('./preload/dashboard-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  glassbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  glassbar.webContents.on('will-navigate', (event) => event.preventDefault());
  glassbar.on('closed', () => {
    glassbar = null;
  });
  void glassbar
    .loadFile(file('./renderer/dashboard/index.html'), { query: { surface: 'glassbar' } })
    .catch(reportStartupError);
}

function reportStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('Could not open KNOTS', message);
  app.quit();
}

void app
  .whenReady()
  .then(async () => {
    if (!ownsInstance) return;
    const core = createCore(process.env.KNOTS_DATA_DIR?.trim() || join(homedir(), '.knots'));
    if (process.argv.includes('--smoke-test')) {
      if (!process.env.KNOTS_DATA_DIR) {
        core.close();
        throw new Error('Packaged smoke tests require an isolated KNOTS_DATA_DIR.');
      }
      const smokeWorker = registerIpcHandlers(ipcMain, core, {
        sample: join(core.dataDir, 'knots', 'contract-reviewer.knot.yaml'),
        bundledSample: file('./renderer/contract-reviewer.knot.yaml'),
      });
      ipcMain.handle('surface:status', () => ({ shortcut: quickShortcut, registered: false }));
      const errors: string[] = [];
      const probe = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: file('./preload/dashboard-preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      });
      probe.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message);
      });
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Renderer did not become ready.')), 15000);
        ipcMain.once('surface:ready', (_event, success: boolean) => {
          clearTimeout(timer);
          if (success) resolve();
          else reject(new Error('Renderer workspace initialization failed.'));
        });
      });
      await probe.loadFile(file('./renderer/dashboard/index.html'));
      await ready;
      if (errors.length) throw new Error(errors.join('; '));
      core.settings.set('packaged_smoke', 'passed');
      if (core.settings.get('packaged_smoke') !== 'passed')
        throw new Error('SQLite smoke test failed.');
      probe.destroy();
      await smokeWorker.shutdown();
      core.close();
      console.log(
        JSON.stringify({
          smoke: 'passed',
          electron: process.versions.electron,
          platform: process.platform,
          arch: process.arch,
        }),
      );
      app.exit(0);
      return;
    }
    core.database
      .getDb()
      .prepare(
        "UPDATE runs SET status = 'failed', error = 'Application stopped before this run finished.', completed_at = datetime('now') WHERE id NOT IN (SELECT run_id FROM worker_jobs) AND status IN ('queued', 'running', 'waiting_approval') AND id IN (SELECT run_id FROM run_activity)",
      )
      .run();
    core.database
      .getDb()
      .prepare(
        "UPDATE file_proposals SET state = 'uncertain', error = 'Application stopped during file creation. Inspect the destination before retrying.' WHERE run_id NOT IN (SELECT run_id FROM worker_jobs) AND state = 'writing'",
      )
      .run();
    core.database
      .getDb()
      .prepare(
        "UPDATE file_proposals SET state = 'cancelled' WHERE run_id NOT IN (SELECT run_id FROM worker_jobs) AND state IN ('pending', 'approved')",
      )
      .run();
    core.database
      .getDb()
      .prepare(
        "UPDATE model_calls SET status = 'interrupted', error = 'Application stopped before usage was confirmed.' WHERE run_id NOT IN (SELECT run_id FROM worker_jobs) AND status = 'running'",
      )
      .run();
    const sample = join(core.dataDir, 'knots', 'contract-reviewer.knot.yaml');
    const worker = registerIpcHandlers(ipcMain, core, {
      recover: true,
      sample,
      bundledSample: file('./renderer/contract-reviewer.knot.yaml'),
    });
    ipcMain.handle('surface:dashboard', (_event, runId?: string) => {
      openDashboard();
      if (runId) {
        const target = dashboard!;
        if (target.webContents.isLoading())
          target.webContents.once('did-finish-load', () =>
            target.webContents.send('surface:select-run', runId),
          );
        else target.webContents.send('surface:select-run', runId);
      }
    });
    ipcMain.handle('surface:hide', () => glassbar?.hide());
    ipcMain.handle('surface:status', () => ({
      shortcut: quickShortcut,
      registered: shortcutRegistered,
    }));
    try {
      shortcutRegistered = globalShortcut.register(quickShortcut, toggleGlassbar);
    } catch {
      shortcutRegistered = false;
    }
    let shutdownComplete = false;
    let shuttingDown = false;
    app.on('before-quit', (event) => {
      if (shutdownComplete) return;
      event.preventDefault();
      if (shuttingDown) return;
      shuttingDown = true;
      void worker
        .shutdown()
        .then(() => {
          core.close();
          shutdownComplete = true;
          app.quit();
        })
        .catch((error) => {
          // Keep the database open if an adapter has not released its request.
          dialog.showErrorBox('Could not finish shutting down', String(error));
          shuttingDown = false;
        });
    });
    app.on('activate', () => {
      if (!dashboard) openDashboard();
    });
    tray = new Tray(
      nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAATklEQVR4nGP4dLX7PzUxw6iB/5UVJOAYn0Zc6sgyEJ8akg0kJE+SgcS4nmgDiQ1bogwk1rCBcyFNwpAmsUyTdEhIHdkG4lI7BEubQWcgADe7oVU4u+jjAAAAAElFTkSuQmCC',
      ),
    );
    tray.setToolTip('KNOTS — background jobs');
    const showDashboard = () => {
      if (!dashboard) openDashboard();
      dashboard?.show();
      dashboard?.focus();
    };
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open KNOTS', click: showDashboard },
        { label: 'Toggle quick bar', click: toggleGlassbar },
        {
          label: 'Stop all work',
          click: () => {
            worker.stopAll();
          },
        },
        {
          label: 'Enable dispatch',
          click: () => {
            worker.enableDispatch();
          },
        },
        { label: 'Quit KNOTS', click: () => app.quit() },
      ]),
    );
    tray.on('click', showDashboard);
    openDashboard();
  })
  .catch(reportStartupError);

// The main-process worker stays alive after the dashboard closes.
app.on('window-all-closed', () => {});

app.on('will-quit', () => globalShortcut.unregisterAll());
