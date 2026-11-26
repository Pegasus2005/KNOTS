import assert from 'node:assert/strict';
import { BrowserWindow, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function testInterface(directory) {
  const { createCore } = await import('@knots/core');
  const { registerIpcHandlers } = await import('../dist/main/ipc-handlers.js');
  ipcMain.handle('surface:status', () => ({ shortcutRegistered: false }));
  const core = createCore(directory),
    worker = registerIpcHandlers(ipcMain, core, { sample: '', bundledSample: '' });
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      preload: fileURLToPath(new URL('../dist/preload/dashboard-preload.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const errors = [];
  window.webContents.on('render-process-gone', (_e, data) => errors.push(data.reason));
  window.webContents.on('console-message', (_e, ...args) => {
    if (args[0] === 3) errors.push(args[1]);
  });
  try {
    await window.loadFile(
      fileURLToPath(new URL('../dist/renderer/dashboard/index.html', import.meta.url)),
    );
    await new Promise((r) => setTimeout(r, 300));
    for (const theme of ['light', 'dark']) {
      await window.webContents.executeJavaScript(
        `if(document.documentElement.dataset.theme !== '${theme}') document.querySelector('[data-theme-toggle]').click();`,
      );
      assert.equal(
        await window.webContents.executeJavaScript(`document.documentElement.dataset.theme`),
        theme,
      );
      assert.equal(
        await window.webContents.executeJavaScript(`localStorage.getItem('knots-theme')`),
        theme,
      );
      await new Promise((r) => setTimeout(r, 100));
      await writeFile(
        `/tmp/knots-chat-${theme}.png`,
        (await window.webContents.capturePage()).toPNG(),
      );
      const ink = await window.webContents.executeJavaScript(
        `getComputedStyle(document.body).color`,
      );
      assert.ok(ink);
    }
    await window.loadFile(
      fileURLToPath(new URL('../dist/renderer/dashboard/studio.html', import.meta.url)),
    );
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(
      await window.webContents.executeJavaScript(
        `!!document.querySelector('#studio-detail textarea')`,
      ),
      true,
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('#studio-detail textarea').value='Organize a clear weekly report';[...document.querySelectorAll('#studio-detail button')].find(b=>b.textContent==='Save problem').click();`,
    );
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(core.database.getDb().prepare('SELECT COUNT(*) AS n FROM bot_drafts').get().n, 1);
    await writeFile('/tmp/knots-studio-dark.png', (await window.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log(
      'PASS: isolated desktop renderer startup, light/dark screens and persisted problem-entry UI. Screenshots saved in /tmp/knots-*.png.',
    );
  } finally {
    ipcMain.removeHandler('surface:status');
    window.destroy();
    await worker.shutdown();
    core.close();
  }
}
