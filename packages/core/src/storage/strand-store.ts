/**
 * CRUD operations for strand configurations.
 */
import type BetterSqlite3 from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Strand, ProviderType, ModelCapability } from '@knots/types';

/** Row shape from the strands table. */
interface StrandRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  endpoint: string | null;
  api_key_ref: string | null;
  capabilities: string;
  is_local: number;
  is_default: number;
  created_at: string;
  updated_at: string | null;
}

/** Input for creating a new strand. */
export interface CreateStrandInput {
  name: string;
  provider: ProviderType;
  model: string;
  endpoint?: string;
  api_key_ref?: string;
  capabilities?: ModelCapability[];
  is_local?: boolean;
  is_default?: boolean;
}

/** Input for updating an existing strand. */
export interface UpdateStrandInput {
  name?: string;
  provider?: ProviderType;
  model?: string;
  endpoint?: string | null;
  api_key_ref?: string | null;
  capabilities?: ModelCapability[];
  is_local?: boolean;
  is_default?: boolean;
}

function rowToStrand(row: StrandRow): Strand {
  let capabilities: ModelCapability[] = [];
  try {
    const parsed: unknown = JSON.parse(row.capabilities);
    if (Array.isArray(parsed)) {
      capabilities = parsed as ModelCapability[];
    }
  } catch {
    capabilities = [];
  }

  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ProviderType,
    model: row.model,
    endpoint: row.endpoint ?? undefined,
    api_key_ref: row.api_key_ref ?? undefined,
    capabilities,
    is_local: row.is_local === 1,
    is_default: row.is_default === 1,
    created_at: row.created_at,
    updated_at: row.updated_at ?? undefined,
  };
}

export class StrandStore {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  /** List all strands. */
  getAll(): Strand[] {
    const rows = this.db.prepare('SELECT * FROM strands ORDER BY created_at DESC').all() as StrandRow[];
    return rows.map(rowToStrand);
  }

  /** Get a strand by ID. */
  getById(id: string): Strand | undefined {
    const row = this.db.prepare('SELECT * FROM strands WHERE id = ?').get(id) as StrandRow | undefined;
    return row ? rowToStrand(row) : undefined;
  }

  /** Get a strand by user-given name. */
  getByName(name: string): Strand | undefined {
    const row = this.db.prepare('SELECT * FROM strands WHERE name = ?').get(name) as StrandRow | undefined;
    return row ? rowToStrand(row) : undefined;
  }

  /** Create a new strand. */
  create(input: CreateStrandInput): Strand {
    const id = uuidv4();
    const capabilities = JSON.stringify(input.capabilities ?? []);
    const isLocal = input.is_local ? 1 : 0;
    const isDefault = input.is_default ? 1 : 0;

    this.db
      .prepare(
        `INSERT INTO strands (id, name, provider, model, endpoint, api_key_ref, capabilities, is_local, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.model,
        input.endpoint ?? null,
        input.api_key_ref ?? null,
        capabilities,
        isLocal,
        isDefault,
      );

    return this.getById(id)!;
  }

  /** Update a strand by ID. */
  update(id: string, input: UpdateStrandInput): Strand | undefined {
    const existing = this.getById(id);
    if (!existing) return undefined;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.provider !== undefined) {
      fields.push('provider = ?');
      values.push(input.provider);
    }
    if (input.model !== undefined) {
      fields.push('model = ?');
      values.push(input.model);
    }
    if (input.endpoint !== undefined) {
      fields.push('endpoint = ?');
      values.push(input.endpoint);
    }
    if (input.api_key_ref !== undefined) {
      fields.push('api_key_ref = ?');
      values.push(input.api_key_ref);
    }
    if (input.capabilities !== undefined) {
      fields.push('capabilities = ?');
      values.push(JSON.stringify(input.capabilities));
    }
    if (input.is_local !== undefined) {
      fields.push('is_local = ?');
      values.push(input.is_local ? 1 : 0);
    }
    if (input.is_default !== undefined) {
      fields.push('is_default = ?');
      values.push(input.is_default ? 1 : 0);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE strands SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /** Delete a strand by ID. Returns true if deleted. */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM strands WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** Find strands by provider. */
  findByProvider(provider: ProviderType): Strand[] {
    const rows = this.db
      .prepare('SELECT * FROM strands WHERE provider = ? ORDER BY created_at DESC')
      .all(provider) as StrandRow[];
    return rows.map(rowToStrand);
  }
}
