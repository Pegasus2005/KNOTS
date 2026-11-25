import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
let executable = process.argv[2];
if (!executable) {
  const release = join(root, 'release');
  if (process.platform === 'darwin') {
    const folder = (await readdir(release)).find((name) => name === 'mac-' + process.arch) || 'mac';
    executable = join(release, folder, 'KNOTS.app', 'Contents', 'MacOS', 'KNOTS');
  } else
    executable = join(
      release,
      process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked',
      process.platform === 'win32' ? 'KNOTS.exe' : 'knots',
    );
}
const directory = await mkdtemp(join(tmpdir(), 'knots-packaged-smoke-'));
try {
  const child = spawn(
    resolve(executable),
    [
      '--smoke-test',
      ...(process.env.CI === 'true' && process.env.KNOTS_CI_NO_SANDBOX === '1'
        ? ['--no-sandbox']
        : []),
    ],
    { env: { ...process.env, KNOTS_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const timer = setTimeout(() => child.kill(), 30000);
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(timer);
  if (status !== 0 || !output.includes('"smoke":"passed"'))
    throw new Error(`Packaged smoke failed (${status}): ${output}`);
  console.log(output.trim());
} finally {
  await rm(directory, { recursive: true, force: true });
}
