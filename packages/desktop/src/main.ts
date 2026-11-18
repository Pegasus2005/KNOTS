import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createCore } from '@knots/core';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './main/ipc-handlers.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
let dashboard: BrowserWindow | null = null;

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

void app.whenReady().then(() => {
  const core = createCore(process.env.KNOTS_DATA_DIR?.trim() || join(homedir(), '.knots'));
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
  openDashboard();
}).catch(reportStartupError);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
