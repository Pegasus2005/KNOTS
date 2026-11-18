/**
 * Key-value settings store backed by SQLite.
 */
import type BetterSqlite3 from 'better-sqlite3';

export class SettingsStore {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  /** Get a setting value by key. Returns undefined if not set. */
  get(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Get a setting value parsed as JSON. Returns undefined if not set. */
  getJSON<T>(key: string): T | undefined {
    const value = this.get(key);
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }

  /** Set a setting value. Creates or updates. */
  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  /** Set a setting value as JSON. */
  setJSON(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }

  /** Delete a setting by key. Returns true if deleted. */
  delete(key: string): boolean {
    const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return result.changes > 0;
  }

  /** List all setting keys. */
  keys(): string[] {
    const rows = this.db.prepare('SELECT key FROM settings ORDER BY key ASC').all() as { key: string }[];
    return rows.map((r) => r.key);
  }

  /** Get all settings as a key-value record. */
  getAll(): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM settings ORDER BY key ASC')
      .all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
}
