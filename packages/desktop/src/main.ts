import { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage } from 'electron';
import { createCore } from '@knots/core';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './main/ipc-handlers.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
let dashboard: BrowserWindow | null = null;
let tray: Tray | null = null;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (!dashboard) openDashboard();
  dashboard?.show();
  dashboard?.focus();
});

function openDashboard(): void {
  dashboard = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 680,
    minHeight: 580,
    title: 'KNOTS',
    backgroundColor: '#f4f1e9',
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

function reportStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('Could not open KNOTS', message);
  app.quit();
}

void app
  .whenReady()
  .then(() => {
    if (!ownsInstance) return;
    const core = createCore(process.env.KNOTS_DATA_DIR?.trim() || join(homedir(), '.knots'));
    core.database
      .getDb()
      .prepare(
        "UPDATE runs SET status = 'failed', error = 'Application stopped before this run finished.', completed_at = datetime('now') WHERE status IN ('queued', 'running') AND id IN (SELECT run_id FROM run_activity)",
      )
      .run();
    const sample = join(core.dataDir, 'knots', 'contract-reviewer.knot.yaml');
    registerIpcHandlers(ipcMain, core, {
      sample,
      bundledSample: file('./renderer/contract-reviewer.knot.yaml'),
    });
    app.on('before-quit', () => {
      core.runManager.cancelAll('KNOTS closed');
      core.close();
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
        { label: 'Quit KNOTS', click: () => app.quit() },
      ]),
    );
    tray.on('click', showDashboard);
    openDashboard();
  })
  .catch(reportStartupError);

// The main-process worker stays alive after the dashboard closes.
app.on('window-all-closed', () => {});
