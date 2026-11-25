/**
 * SQLite database wrapper using better-sqlite3.
 * Auto-creates parent directories and applies versioned schema migrations.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import BetterSqlite3Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

const SCHEMA_VERSION = 9;

const MIGRATIONS: Record<number, string> = {
  9: `
    CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, knot_name TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE conversation_runs (conversation_id TEXT NOT NULL REFERENCES conversations(id), run_id TEXT NOT NULL UNIQUE REFERENCES runs(id), turn INTEGER NOT NULL, PRIMARY KEY (conversation_id, turn));
    INSERT INTO schema_version (version) VALUES (9);
  `,
  8: `
    CREATE TABLE mcp_actions (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), server TEXT NOT NULL, name TEXT NOT NULL, arguments TEXT NOT NULL, endpoint TEXT NOT NULL, state TEXT NOT NULL, result TEXT, error TEXT);
    CREATE INDEX mcp_actions_run ON mcp_actions(run_id);
    INSERT INTO schema_version (version) VALUES (8);
  `,
  7: `
    CREATE TABLE task_plans (
      id TEXT PRIMARY KEY, goal TEXT NOT NULL, definition TEXT, knots TEXT NOT NULL,
      privacy TEXT NOT NULL, status TEXT NOT NULL, draft_run_id TEXT REFERENCES runs(id),
      error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE plan_tasks (
      plan_id TEXT NOT NULL REFERENCES task_plans(id), task_id TEXT NOT NULL,
      run_id TEXT UNIQUE REFERENCES runs(id), state TEXT NOT NULL DEFAULT 'pending',
      scope TEXT, error TEXT, PRIMARY KEY (plan_id, task_id)
    );
    INSERT INTO schema_version (version) VALUES (7);
  `,
  6: `
    CREATE TABLE worker_jobs (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      envelope TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued',
      reason TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX worker_jobs_state ON worker_jobs(state);
    INSERT INTO schema_version (version) VALUES (6);
  `,
  5: `
    CREATE TABLE run_snapshots (run_id TEXT PRIMARY KEY REFERENCES runs(id), spec TEXT NOT NULL, purpose TEXT NOT NULL);
    CREATE TABLE teaching_changes (id TEXT PRIMARY KEY, knot_name TEXT NOT NULL, source_run_id TEXT NOT NULL REFERENCES runs(id), example_input TEXT NOT NULL, correction TEXT NOT NULL, note TEXT NOT NULL, base_spec TEXT NOT NULL, policy_spec TEXT NOT NULL, generation_run_id TEXT REFERENCES runs(id), status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE teaching_evaluations (id TEXT PRIMARY KEY, change_id TEXT NOT NULL REFERENCES teaching_changes(id), example_id TEXT NOT NULL REFERENCES teaching_changes(id), before_run_id TEXT REFERENCES runs(id), after_run_id TEXT REFERENCES runs(id), assessment TEXT);
    INSERT INTO schema_version (version) VALUES (5);
  `,
  4: `
    ALTER TABLE strands ADD COLUMN routing TEXT;
    CREATE TABLE model_calls (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      strand_id TEXT NOT NULL,
      strand_name TEXT NOT NULL,
      model TEXT NOT NULL,
      stage TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      cost_usd REAL,
      cost_source TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX model_calls_run ON model_calls(run_id);
    INSERT INTO schema_version (version) VALUES (4);
  `,
  3: `
    CREATE TABLE file_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      destination TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX file_proposals_run ON file_proposals(run_id);
    INSERT INTO schema_version (version) VALUES (3);
  `,
  2: `
    CREATE TABLE run_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO schema_version (version) VALUES (2);
  `,
  1: `
    CREATE TABLE IF NOT EXISTS strands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      endpoint TEXT,
      api_key_ref TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      is_local INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS lanes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      strand_order TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      knot_name TEXT NOT NULL,
      strand_id TEXT NOT NULL DEFAULT '',
      strand_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      input TEXT NOT NULL DEFAULT '',
      output TEXT,
      model_used TEXT NOT NULL DEFAULT '',
      tokens_in INTEGER,
      tokens_out INTEGER,
      cost REAL,
      duration_ms INTEGER,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );

    INSERT INTO schema_version (version) VALUES (1);
  `,
};

export interface DatabaseConfig {
  /** Path to the SQLite database file (or ':memory:'). */
  dbPath: string;
  /** Enable WAL mode for better concurrent reads. Default: true. */
  walMode?: boolean;
}

export class KnotsDatabase {
  private db: BetterSqlite3.Database;
  readonly dbPath: string;

  constructor(config: DatabaseConfig) {
    this.dbPath = config.dbPath;

    if (config.dbPath !== ':memory:') {
      const parentDir = path.dirname(path.resolve(config.dbPath));
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    this.db = new BetterSqlite3Database(config.dbPath);

    if (config.walMode !== false && config.dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');

    this.migrate();
  }

  /** Get the underlying better-sqlite3 Database instance. */
  getDb(): BetterSqlite3.Database {
    return this.db;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /** Run migrations to bring the database up to date. */
  private migrate(): void {
    const currentVersion = this.getSchemaVersion();

    if (currentVersion >= SCHEMA_VERSION) return;

    const startVersion = currentVersion + 1;
    const transaction = this.db.transaction(() => {
      for (let v = startVersion; v <= SCHEMA_VERSION; v++) {
        const sql = MIGRATIONS[v];
        if (sql) {
          this.db.exec(sql);
        }
      }
    });

    transaction();
  }

  /** Get the current schema version. Returns 0 if no schema exists. */
  private getSchemaVersion(): number {
    try {
      const row = this.db
        .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
        .get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }
}

export { KnotsDatabase as Database };
