/**
 * CRUD operations for run records (activity log).
 */
import type BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Run, RunStatus } from '@knots/types';

/** Row shape from the runs table. */
interface RunRow {
  id: string;
  knot_name: string;
  strand_id: string | null;
  status: string;
  input: string;
  output: string | null;
  model_used: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

/** Input for creating a new run record. */
export interface CreateRunInput {
  knot_name: string;
  input: string;
  strand_id?: string;
}

/** Input for updating a run record. */
export interface UpdateRunInput {
  status?: RunStatus;
  output?: string;
  strand_id?: string;
  model_used?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    knot_name: row.knot_name,
    strand_id: row.strand_id ?? '',
    status: row.status as RunStatus,
    input: row.input,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    created_at: row.created_at,
    started_at: row.started_at ?? undefined,
    completed_at: row.completed_at ?? undefined,
  };
}

export class RunStore {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  /** List all runs, newest first. */
  getAll(limit = 100): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as RunRow[];
    return rows.map(rowToRun);
  }

  /** Get a run by ID. */
  getById(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? rowToRun(row) : undefined;
  }

  /** Create a new run record. Returns in 'queued' status. */
  create(input: CreateRunInput): Run {
    const id = uuidv4();

    this.db
      .prepare(
        `INSERT INTO runs (id, knot_name, strand_id, status, input)
         VALUES (?, ?, ?, 'queued', ?)`,
      )
      .run(id, input.knot_name, input.strand_id ?? null, input.input);

    return this.getById(id)!;
  }

  /** Update a run record. */
  update(id: string, input: UpdateRunInput): Run | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      fields.push('status = ?');
      values.push(input.status);
    }
    if (input.output !== undefined) {
      fields.push('output = ?');
      values.push(input.output);
    }
    if (input.strand_id !== undefined) {
      fields.push('strand_id = ?');
      values.push(input.strand_id);
    }
    if (input.model_used !== undefined) {
      fields.push('model_used = ?');
      values.push(input.model_used);
    }
    if (input.tokens_in !== undefined) {
      fields.push('tokens_in = ?');
      values.push(input.tokens_in);
    }
    if (input.tokens_out !== undefined) {
      fields.push('tokens_out = ?');
      values.push(input.tokens_out);
    }
    if (input.cost !== undefined) {
      fields.push('cost = ?');
      values.push(input.cost);
    }
    if (input.started_at !== undefined) {
      fields.push('started_at = ?');
      values.push(input.started_at);
    }
    if (input.completed_at !== undefined) {
      fields.push('completed_at = ?');
      values.push(input.completed_at);
    }
    if (input.error !== undefined) {
      fields.push('error = ?');
      values.push(input.error);
    }

    if (fields.length === 0) return existing;

    values.push(id);
    this.db.prepare(`UPDATE runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /** Delete a run by ID. */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM runs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Find runs by knot name. */
  findByKnot(knotName: string, limit = 50): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE knot_name = ? ORDER BY created_at DESC LIMIT ?')
      .all(knotName, limit) as RunRow[];
    return rows.map(rowToRun);
  }

  /** Find runs by status. */
  findByStatus(status: RunStatus, limit = 50): Run[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(status, limit) as RunRow[];
    return rows.map(rowToRun);
  }
}
