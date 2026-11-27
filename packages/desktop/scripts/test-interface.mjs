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
  core.knots.save({
    version: '0.1.0',
    name: 'interface-helper',
    display_name: 'Interface helper',
    description: 'UI fixture',
    instructions: 'Help with reports',
    tools: [],
  });
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
    window.setSize(680, 850);
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-view="strands"]').click();`,
    );
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(
      '/tmp/knots-connections-narrow.png',
      (await window.webContents.capturePage()).toPNG(),
    );
    await window.webContents.executeJavaScript(`document.querySelector('#add-strand').click();`);
    await new Promise((r) => setTimeout(r, 100));
    const dialogLayout = await window.webContents.executeJavaScript(
      `(()=>{const dialog=document.querySelector('dialog[open]'),bounds=dialog.getBoundingClientRect();const fields=[...dialog.querySelectorAll('input,select,button')].filter(e=>{const details=e.closest('details:not([open])');return !details&&e.checkVisibility();}).map(e=>e.getBoundingClientRect());return {fits:bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=0&&bounds.bottom<=innerHeight,overlap:fields.some((a,i)=>fields.slice(i+1).some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2))};})()`,
    );
    assert.equal(dialogLayout.fits, true);
    assert.equal(dialogLayout.overlap, false);
    await writeFile(
      '/tmp/knots-connection-dialog.png',
      (await window.webContents.capturePage()).toPNG(),
    );
    await window.webContents.executeJavaScript(`document.querySelector('#close-strand').click();`);
    window.setSize(1280, 900);
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
    for (const tab of ['evaluate', 'improve', 'playbook', 'models']) {
      await window.webContents.executeJavaScript(`location.hash='${tab}'`);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(
        await window.webContents.executeJavaScript(
          `document.querySelectorAll('#studio-detail .card').length>0`,
        ),
        true,
      );
      if (tab === 'evaluate') {
        await window.webContents.executeJavaScript(
          `document.querySelector('#studio-detail input').value='UI acceptance suite';[...document.querySelectorAll('#studio-detail button')].find(b=>b.textContent==='Approve and save cases').click();`,
        );
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(
          core.database
            .getDb()
            .prepare("SELECT COUNT(*) AS n FROM lab_records WHERE kind='suite'")
            .get().n,
          1,
        );
      }
      if (tab === 'playbook') {
        await window.webContents.executeJavaScript(
          `for(const label of document.querySelectorAll('#studio-detail label')){if(label.textContent.startsWith('Scope keywords'))label.querySelector('input').value='reports';if(label.textContent==='Guidance')label.querySelector('textarea').value='Use clear headings';}[...document.querySelectorAll('#studio-detail button')].find(b=>b.textContent==='Review and save active guidance').click();`,
        );
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(
          core.database
            .getDb()
            .prepare("SELECT COUNT(*) AS n FROM lab_records WHERE kind='playbook'")
            .get().n,
          1,
        );
      }
      await writeFile(
        `/tmp/knots-studio-${tab}.png`,
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    for (const width of [1280, 1024, 800, 680]) {
      window.setSize(width, 900);
      await new Promise((r) => setTimeout(r, 100));
      for (const tab of ['create', 'evaluate', 'improve', 'playbook', 'models', 'memory']) {
        await window.webContents.executeJavaScript(`location.hash='${tab}'`);
        await new Promise((r) => setTimeout(r, 80));
        const layout = await window.webContents.executeJavaScript(
          `(async()=>{await document.fonts.ready;const controls=[...document.querySelectorAll('input,select,textarea,button,.studio-tabs a')].filter(e=>{const closed=e.closest('details:not([open])');return (!closed||closed.querySelector('summary')?.contains(e))&&e.checkVisibility({visibilityProperty:true});}).map(e=>({label:e.getAttribute('aria-label')||e.textContent.slice(0,40)||e.tagName,rect:e.getBoundingClientRect()})).filter(v=>v.rect.width&&v.rect.height);const collisions=[];for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++){const a=controls[i],b=controls[j];if(Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left)>2&&Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top)>2)collisions.push([a.label,b.label]);}return {overflow:document.documentElement.scrollWidth>innerWidth+2,collisions,font:document.fonts.check('13px Poppins')};})()`,
        );
        assert.deepEqual(layout.collisions, [], `${tab} controls overlap at ${width}px`);
        assert.equal(layout.overflow, false, `${tab} overflows at ${width}px`);
        assert.equal(layout.font, true);
        assert.ok(
          await window.webContents.executeJavaScript(
            `document.querySelector('.studio-tabs').getBoundingClientRect().height<120`,
          ),
          'Tabs should stay compact instead of stretching grid rows.',
        );
      }
    }
    await writeFile(
      '/tmp/knots-studio-narrow.png',
      (await window.webContents.capturePage()).toPNG(),
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: isolated renderer startup, light/dark Poppins screens, saved problem/case/guidance forms, connection dialog fit and all six Studio tabs without visible control overlap at 1280/1024/800/680px.',
    );
  } finally {
    ipcMain.removeHandler('surface:status');
    window.destroy();
    await worker.shutdown();
    core.close();
  }
}
