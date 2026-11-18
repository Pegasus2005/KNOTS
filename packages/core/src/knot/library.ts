/**
 * KnotLibrary — manage knot files in a directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { KnotSpec } from '@knots/types';
import { loadKnot, serializeKnot, KnotLoadError } from './loader.js';
import type { LoadedKnot, SaveKnotOptions } from './types.js';

const KNOT_EXT = '.knot.yaml';

export class KnotLibrary {
  private readonly knotDir: string;

  constructor(knotDir: string) {
    this.knotDir = path.resolve(knotDir);
    if (!fs.existsSync(this.knotDir)) {
      fs.mkdirSync(this.knotDir, { recursive: true });
    }
  }

  /** List all knot names in the library directory. */
  list(): string[] {
    const entries = fs.readdirSync(this.knotDir);
    return entries
      .filter((f) => f.endsWith(KNOT_EXT))
      .map((f) => f.slice(0, -KNOT_EXT.length));
  }

  /** Get a loaded knot by name. Returns undefined if not found. */
  get(name: string): LoadedKnot | undefined {
    const filePath = this.knotPath(name);
    if (!fs.existsSync(filePath)) return undefined;

    try {
      return loadKnot(filePath);
    } catch (err) {
      if (err instanceof KnotLoadError) {
        throw err;
      }
      throw new KnotLoadError(
        `Failed to load knot "${name}": ${(err as Error).message}`,
        filePath,
      );
    }
  }

  /** Save a knot spec to disk. Creates a versioned backup if the file already exists. */
  save(spec: KnotSpec, options?: SaveKnotOptions): void {
    const filePath = this.knotPath(spec.name);
    const shouldBackup = options?.backup ?? true;

    if (shouldBackup && fs.existsSync(filePath)) {
      this.createBackup(filePath, spec.name);
    }

    const yamlStr = serializeKnot(spec);
    fs.writeFileSync(filePath, yamlStr, 'utf-8');
  }

  /** Delete a knot by name. Returns true if deleted, false if not found. */
  delete(name: string): boolean {
    const filePath = this.knotPath(name);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  /** Get all loaded knots (skips invalid ones). */
  listLoaded(): LoadedKnot[] {
    const knots: LoadedKnot[] = [];
    for (const name of this.list()) {
      try {
        const knot = this.get(name);
        if (knot) knots.push(knot);
      } catch {
        // skip invalid knots
      }
    }
    return knots;
  }

  /** Get the file path for a knot name. */
  private knotPath(name: string): string {
    return path.join(this.knotDir, `${name}${KNOT_EXT}`);
  }

  /** Create a timestamped backup of a knot file. */
  private createBackup(filePath: string, name: string): void {
    const backupDir = path.join(this.knotDir, '.versions');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${name}.${timestamp}${KNOT_EXT}`);
    fs.copyFileSync(filePath, backupPath);
  }
}
