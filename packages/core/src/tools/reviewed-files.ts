import { createHash } from 'node:crypto';
import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { v4 as uuid } from 'uuid';
import type { KnotsCore } from '../index.js';
import type { RunContext } from '../run/run-context.js';

export interface FileProposal {
  id: string;
  run_id: string;
  destination: string;
  content: string;
  content_hash: string;
  state:
    | 'pending'
    | 'approved'
    | 'writing'
    | 'verified'
    | 'rejected'
    | 'cancelled'
    | 'failed'
    | 'uncertain';
  error?: string;
}

export class ReviewedFiles {
  private readonly waiters = new Map<string, (approved: boolean) => void>();

  constructor(private readonly core: KnotsCore) {}

  list(runId: string): FileProposal[] {
    return this.core.database
      .getDb()
      .prepare('SELECT * FROM file_proposals WHERE run_id = ? ORDER BY created_at, rowid')
      .all(runId) as FileProposal[];
  }

  decide(id: string, approve: boolean): void {
    const proposal = this.core.database
      .getDb()
      .prepare('SELECT * FROM file_proposals WHERE id = ?')
      .get(id) as FileProposal | undefined;
    if (!proposal) throw new Error('This proposal no longer exists.');
    if (proposal.state !== 'pending') return; // A decision applies once.
    const run = this.core.runManager.getContext(proposal.run_id);
    if (!run || run.isCancelled || !this.waiters.has(id)) {
      throw new Error('This job is no longer waiting for approval.');
    }
    const state = approve ? 'approved' : 'rejected';
    this.core.database
      .getDb()
      .prepare("UPDATE file_proposals SET state = ? WHERE id = ? AND state = 'pending'")
      .run(state, id);
    this.waiters.get(id)!(approve);
  }

  async propose(
    run: RunContext,
    directory: string,
    canonicalDirectory: string,
    filename: string,
    content: string,
  ): Promise<string> {
    if (
      !filename ||
      filename === '.' ||
      filename === '..' ||
      basename(filename) !== filename ||
      /[\\/:\x00-\x1f]/.test(filename)
    ) {
      throw new Error('Use a single filename inside the granted output folder.');
    }
    if (
      new TextEncoder().encode(content).byteLength > 65536 ||
      new TextDecoder().decode(new TextEncoder().encode(content)) !== content
    ) {
      throw new Error('A deliverable must contain valid text up to 64 KB.');
    }
    run.signal.throwIfAborted();
    const id = uuid();
    const destination = join(canonicalDirectory, filename);
    const hash = createHash('sha256').update(content).digest('hex');
    const db = this.core.database.getDb();
    db.prepare(
      "INSERT INTO file_proposals (id, run_id, destination, content, content_hash, state) VALUES (?, ?, ?, ?, ?, 'pending')",
    ).run(id, run.runId, destination, content, hash);
    run.status = 'waiting_approval';
    this.core.runs.update(run.runId, { status: 'waiting_approval' });

    const approved = await new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        db.prepare(
          "UPDATE file_proposals SET state = 'cancelled' WHERE id = ? AND state IN ('pending', 'approved')",
        ).run(id);
        this.waiters.delete(id);
        reject(new Error('Job cancelled.'));
      };
      this.waiters.set(id, (decision) => {
        run.signal.removeEventListener('abort', abort);
        this.waiters.delete(id);
        resolve(decision);
      });
      run.signal.addEventListener('abort', abort, { once: true });
      if (run.signal.aborted) abort();
    });
    if (run.isCancelled) {
      db.prepare(
        "UPDATE file_proposals SET state = 'cancelled' WHERE id = ? AND state = 'approved'",
      ).run(id);
      run.signal.throwIfAborted();
    }
    run.status = 'running';
    this.core.runs.update(run.runId, { status: 'running' });
    if (!approved)
      return 'The user rejected this file. Explain the rejection or propose a different deliverable.';

    let descriptor: number | undefined;
    let created = false;
    try {
      if (realpathSync(directory) !== canonicalDirectory) {
        throw new Error('The granted output folder changed. Grant it again in a new run.');
      }
      const claim = db
        .prepare("UPDATE file_proposals SET state = 'writing' WHERE id = ? AND state = 'approved'")
        .run(id);
      if (!claim.changes) throw new Error('This action has already been handled.');
      // A small synchronous write keeps cancellation and another approval from interleaving.
      descriptor = openSync(destination, 'wx', 0o600);
      created = true;
      writeFileSync(descriptor, content, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      const actual = readFileSync(destination, 'utf8');
      if (createHash('sha256').update(actual).digest('hex') !== hash) {
        throw new Error('The saved file does not match the approved contents.');
      }
      db.prepare("UPDATE file_proposals SET state = 'verified' WHERE id = ?").run(id);
      return `Created and verified ${destination}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare('UPDATE file_proposals SET state = ?, error = ? WHERE id = ?').run(
        created ? 'uncertain' : 'failed',
        message,
        id,
      );
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}
