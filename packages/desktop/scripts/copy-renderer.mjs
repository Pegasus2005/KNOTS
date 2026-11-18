import { copyFileSync, cpSync } from 'node:fs';

const source = new URL('../src/renderer/', import.meta.url);
const target = new URL('../dist/renderer/', import.meta.url);
cpSync(source, target, { recursive: true });
copyFileSync(
  new URL('../../../knots/contract-reviewer.knot.yaml', import.meta.url),
  new URL('contract-reviewer.knot.yaml', target),
);
