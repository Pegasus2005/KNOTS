import {
  lstatSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, relative, isAbsolute, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type { KnotSpec } from '@knots/types';
import type { KnotsCore } from '../index.js';
import { validateKnotSpec } from './schema.js';
const MAX_DOCUMENT = 262144;
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function validText(content: unknown): string {
  if (
    typeof content !== 'string' ||
    new TextEncoder().encode(content).length > MAX_DOCUMENT ||
    content.includes('\0') ||
    new TextDecoder().decode(new TextEncoder().encode(content)) !== content
  )
    throw new Error('Knowledge supports UTF-8 text up to 256 KB per document.');
  return content;
}
function name(value: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
    throw new Error(
      'Use a lowercase knot ID with up to 64 letters, digits, hyphens or underscores.',
    );
}
export interface KnotPackage {
  version: 1;
  spec: KnotSpec;
  files: { path: string; content: string; hash: string }[];
}
export class KnotKnowledge {
  constructor(private core: KnotsCore) {}
  private spec(knotName: string) {
    if (!this.core.knots.list().includes(knotName)) throw new Error('Knot not found.');
    return this.core.knots.get(knotName, { resolveKnowledgeRefs: false })!.spec;
  }
  documents(spec: KnotSpec) {
    const root = join(this.core.knots.directory, 'assets');
    return (spec.knowledge_refs ?? []).map((ref) => {
      const file = resolve(this.core.knots.directory, ref);
      if (!existsSync(root) || lstatSync(root).isSymbolicLink())
        throw new Error('Knowledge must be attached in the managed assets directory.');
      const actual = realpathSync(file);
      const local = relative(realpathSync(root), actual);
      if (
        !local ||
        local === '..' ||
        local.startsWith('../') ||
        local.startsWith('..\\') ||
        isAbsolute(local) ||
        !statSync(actual).isFile() ||
        statSync(actual).size > MAX_DOCUMENT
      )
        throw new Error('Knowledge reference is outside managed assets or too large. Reattach it.');
      const content = validText(readFileSync(actual, 'utf8'));
      return {
        ref,
        name: basename(actual).replace(/^[a-f0-9-]{36}-/, ''),
        content,
        hash: digest(content),
      };
    });
  }
  list(knotName: string) {
    return this.documents(this.spec(knotName)).map(({ content, ...document }) => ({
      ...document,
      characters: content.length,
    }));
  }
  attach(knotName: string, title: string, content: string) {
    const spec = this.spec(knotName);
    validText(content);
    if ((spec.knowledge_refs?.length ?? 0) >= 16)
      throw new Error('A knot can include up to sixteen knowledge documents.');
    const root = join(this.core.knots.directory, 'assets');
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw new Error('Managed assets must not be a symlink.');
    const filename =
      uuid() +
      '-' +
      basename(title)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(-100);
    const ref = 'assets/' + filename;
    writeFileSync(join(root, filename), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      this.core.knots.save({ ...spec, knowledge_refs: [...(spec.knowledge_refs ?? []), ref] });
    } catch (error) {
      rmSync(join(root, filename));
      throw error;
    }
    return ref;
  }
  detach(knotName: string, ref: string) {
    const spec = this.spec(knotName);
    this.core.knots.save({
      ...spec,
      knowledge_refs: (spec.knowledge_refs ?? []).filter((item) => item !== ref),
    });
    // Retain the immutable file for saved versions and queued jobs.
  }
  retrieve(spec: KnotSpec, query: string) {
    const words = new Set((query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []).slice(0, 500));
    const chunks = this.documents(spec)
      .flatMap((document) => {
        const result = [];
        for (let start = 0; start < document.content.length; start += 1600) {
          const content = document.content.slice(start, start + 1800);
          const tokens = new Set(content.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
          const score = [...words].filter((word) => tokens.has(word)).length;
          result.push({ name: document.name, hash: document.hash, content, offset: start, score });
        }
        return result;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
    return chunks.map((chunk, index) => ({ ...chunk, citation: `K${index + 1}` }));
  }
  export(knotName: string): KnotPackage {
    const spec = this.spec(knotName);
    const files = this.documents(spec).map((document, index) => ({
      path: `knowledge/${index}.txt`,
      content: document.content,
      hash: document.hash,
    }));
    return { version: 1, spec: { ...spec, knowledge_refs: files.map((file) => file.path) }, files };
  }
  validate(value: unknown): KnotPackage {
    const bundle = value as KnotPackage;
    if (
      !bundle ||
      bundle.version !== 1 ||
      !Array.isArray(bundle.files) ||
      bundle.files.length > 16 ||
      JSON.stringify(bundle).length > 6000000
    )
      throw new Error('Invalid or oversized knot package.');
    const validation = validateKnotSpec(bundle.spec);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    name(bundle.spec.name);
    const paths = new Set<string>();
    for (const file of bundle.files) {
      if (
        !file ||
        typeof file.path !== 'string' ||
        !/^knowledge\/[0-9]+\.txt$/.test(file.path) ||
        paths.has(file.path)
      )
        throw new Error('Invalid package file path.');
      paths.add(file.path);
      validText(file.content);
      if (digest(file.content) !== file.hash) throw new Error('Package file hash mismatch.');
    }
    const refs = bundle.spec.knowledge_refs ?? [];
    if (
      refs.length !== paths.size ||
      new Set(refs).size !== refs.length ||
      refs.some((ref) => !paths.has(ref))
    )
      throw new Error('All knowledge references must be included in the package.');
    return JSON.parse(JSON.stringify(bundle)) as KnotPackage;
  }
  import(value: unknown, knotName?: string) {
    const bundle = this.validate(value);
    const id = knotName?.trim() || bundle.spec.name;
    name(id);
    if (this.core.knots.list().includes(id))
      throw new Error('That knot ID already exists. Choose another ID.');
    const managed = join(this.core.knots.directory, 'assets');
    mkdirSync(managed, { recursive: true });
    if (lstatSync(managed).isSymbolicLink())
      throw new Error('Managed assets must not be a symlink.');
    const folder = 'assets/' + uuid();
    const directory = join(this.core.knots.directory, folder);
    mkdirSync(directory, { recursive: true });
    try {
      const refs = bundle.files.map((file, index) => {
        const ref = `${folder}/${index}.txt`;
        writeFileSync(join(this.core.knots.directory, ref), file.content, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        return ref;
      });
      this.core.knots.save(
        { ...bundle.spec, name: id, knowledge_refs: refs },
        { overwrite: false },
      );
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    return id;
  }
}
