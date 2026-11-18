/**
 * CRUD operations for lane configurations.
 */
import type BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Lane } from '@knots/types';

/** Stored lane representation (matches @knots/types Lane). */
export type StoredLane = Lane;

/** Row shape from the lanes table. */
interface LaneRow {
  id: string;
  name: string;
  strand_order: string;
  created_at: string;
  updated_at: string | null;
}

/** Input for creating a lane. */
export interface CreateLaneInput {
  name: string;
  strand_order: string[];
}

/** Input for updating a lane. */
export interface UpdateLaneInput {
  name?: string;
  strand_order?: string[];
}

function rowToLane(row: LaneRow): Lane {
  let strandOrder: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.strand_order);
    if (Array.isArray(parsed)) {
      strandOrder = parsed as string[];
    }
  } catch {
    strandOrder = [];
  }

  return {
    id: row.id,
    name: row.name,
    strand_order: strandOrder,
    created_at: row.created_at,
    updated_at: row.updated_at ?? undefined,
  };
}

export class LaneStore {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  /** List all lanes. */
  getAll(): Lane[] {
    const rows = this.db.prepare('SELECT * FROM lanes ORDER BY name ASC').all() as LaneRow[];
    return rows.map(rowToLane);
  }

  /** Get a lane by ID. */
  getById(id: string): Lane | undefined {
    const row = this.db.prepare('SELECT * FROM lanes WHERE id = ?').get(id) as LaneRow | undefined;
    return row ? rowToLane(row) : undefined;
  }

  /** Get a lane by name. */
  getByName(name: string): Lane | undefined {
    const row = this.db.prepare('SELECT * FROM lanes WHERE name = ?').get(name) as LaneRow | undefined;
    return row ? rowToLane(row) : undefined;
  }

  /** Create a new lane. */
  create(input: CreateLaneInput): Lane {
    const id = uuidv4();
    const strandOrder = JSON.stringify(input.strand_order);

    this.db
      .prepare('INSERT INTO lanes (id, name, strand_order) VALUES (?, ?, ?)')
      .run(id, input.name, strandOrder);

    return this.getById(id)!;
  }

  /** Update a lane by ID. */
  update(id: string, input: UpdateLaneInput): Lane | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.strand_order !== undefined) {
      fields.push('strand_order = ?');
      values.push(JSON.stringify(input.strand_order));
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE lanes SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /** Delete a lane by ID. Returns true if deleted. */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM lanes WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
