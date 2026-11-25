/**
 * KnotLibrary — manage knot files in a directory.
 */
import { v4 as uuid } from 'uuid';
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
      fs.mkdirSync(this.knotDir, { recursive: true, mode: 0o700 });
    }
  }

  get directory(): string {
    return this.knotDir;
  }

  /** List all knot names in the library directory. */
  list(): string[] {
    const entries = fs.readdirSync(this.knotDir) as string[];
    return entries
      .filter((f: string) => f.endsWith(KNOT_EXT))
      .map((f: string) => f.slice(0, -KNOT_EXT.length));
  }

  /** Get a loaded knot by name. Returns undefined if not found. */
  get(name: string, options?: Parameters<typeof loadKnot>[1]): LoadedKnot | undefined {
    const filePath = this.knotPath(name);
    if (!fs.existsSync(filePath)) return undefined;

    try {
      return loadKnot(filePath, options);
    } catch (err) {
      if (err instanceof KnotLoadError) {
        throw err;
      }
      throw new KnotLoadError(`Failed to load knot "${name}": ${(err as Error).message}`, filePath);
    }
  }

  /** Save a knot spec to disk. Creates a versioned backup if the file already exists. */
  save(spec: KnotSpec, options?: SaveKnotOptions): void {
    const filePath = this.knotPath(spec.name);
    const shouldBackup = options?.overwrite !== false && (options?.backup ?? true);

    if (shouldBackup && fs.existsSync(filePath)) {
      this.createBackup(filePath, spec.name);
    }

    const yamlStr = serializeKnot(spec);
    if (options?.overwrite === false) {
      fs.writeFileSync(filePath, yamlStr, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    } else {
      const temporary = `${filePath}.${uuid()}.tmp`;
      try {
        fs.writeFileSync(temporary, yamlStr, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, filePath);
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
  }

  /** Delete a knot by name. Returns true if deleted. */
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
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${name}.${timestamp}.${uuid()}${KNOT_EXT}`);
    fs.copyFileSync(filePath, backupPath);
    fs.chmodSync(backupPath, 0o600);
  }
}
