import { app } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testInterface } from './test-interface.mjs';
const directory = await mkdtemp(join(tmpdir(), 'knots-interface-'));
app.setPath('userData', join(directory, 'electron'));
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  try {
    await testInterface(directory);
    await rm(directory, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    await rm(directory, { recursive: true, force: true });
    app.exit(1);
  }
});
