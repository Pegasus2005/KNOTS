/**
 * Load and parse knot YAML files.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { KnotSpec } from '@knots/types';
import { validateKnotSpec } from './schema.js';
import type { LoadedKnot, KnotMeta } from './types.js';

export class KnotLoadError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly validationErrors?: string[],
  ) {
    super(message);
    this.name = 'KnotLoadError';
  }
}

/**
 * Load a knot from a YAML file.
 * Validates against the knot schema and resolves relative file refs.
 */
export function loadKnot(filePath: string): LoadedKnot {
  const absPath = path.resolve(filePath);

  if (!fs.existsSync(absPath)) {
    throw new KnotLoadError(`Knot file not found: ${absPath}`, absPath);
  }

  const raw = fs.readFileSync(absPath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new KnotLoadError(
      `Invalid YAML in ${absPath}: ${(err as Error).message}`,
      absPath,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new KnotLoadError(`Knot file is empty or not an object: ${absPath}`, absPath);
  }

  const result = validateKnotSpec(parsed);
  if (!result.valid) {
    throw new KnotLoadError(
      `Knot validation failed for ${absPath}:\n  ${result.errors.join('\n  ')}`,
      absPath,
      result.errors,
    );
  }

  const spec = parsed as KnotSpec;

  // Resolve relative knowledge_refs to absolute paths
  const knotDir = path.dirname(absPath);
  const specWithRefs = resolveRefs(spec, knotDir);

  const stat = fs.statSync(absPath);
  const meta: KnotMeta = {
    filePath: absPath,
    lastModified: stat.mtime,
  };

  return { spec: specWithRefs, meta };
}

/**
 * Serialize a KnotSpec to YAML string.
 */
export function serializeKnot(spec: KnotSpec): string {
  return yaml.dump(spec, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Resolve relative file references in knowledge_refs.
 */
function resolveRefs(spec: KnotSpec, baseDir: string): KnotSpec {
  // The spec type from @knots/types doesn't include knowledge_refs or rules,
  // but the schema allows them. We handle them via type assertion.
  const extended = spec as KnotSpec & { knowledge_refs?: string[]; rules?: string[] };

  if (extended.knowledge_refs && extended.knowledge_refs.length > 0) {
    extended.knowledge_refs = extended.knowledge_refs.map((ref) => {
      if (path.isAbsolute(ref)) return ref;
      return path.resolve(baseDir, ref);
    });
  }

  return extended as KnotSpec;
}
