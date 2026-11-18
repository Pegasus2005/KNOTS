import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { rebuild } from '@electron/rebuild';

const require = createRequire(import.meta.url);
const fromCore = createRequire(require.resolve('@knots/core/package.json'));
const buildPath = dirname(fromCore.resolve('better-sqlite3/package.json'));

await rebuild({
  buildPath,
  electronVersion: require('electron/package.json').version,
  force: true,
});
