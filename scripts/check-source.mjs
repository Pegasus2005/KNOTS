import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
// Syntax-check the shipped non-TypeScript entry points. TypeScript is checked by the build.
for (const file of [
  'packages/desktop/src/renderer/dashboard/app.js',
  'packages/desktop/src/renderer/dashboard/studio.js',
  'packages/desktop/src/renderer/dashboard/theme.js',
  'packages/desktop/scripts/mcp-notes.mjs',
]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const page of ['index.html', 'studio.html']) {
  const html = await readFile(`packages/desktop/src/renderer/dashboard/${page}`, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Renderer IDs must be unique.');
}
console.log('PASS: shipped JavaScript syntax and renderer ID integrity.');
