import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const release = fileURLToPath(new URL('../../../release/', import.meta.url));
const files = (await readdir(release))
  .filter((name) => /\.(dmg|zip|exe|AppImage)$/.test(name))
  .sort();
if (!files.length) throw new Error('Build an installer or ZIP before creating checksums.');
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(join(release, file))) hash.update(data);
  lines.push(`${hash.digest('hex')}  ${file}`);
}
await writeFile(join(release, 'SHA256SUMS'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
