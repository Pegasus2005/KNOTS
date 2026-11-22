import { createHash } from 'node:crypto';
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  fsyncSync,
  realpathSync,
  existsSync,
  statSync,
} from 'node:fs';
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
    if (this.core.settings.get('worker_dispatch_enabled') === 'false')
      throw new Error('Dispatch is stopped.');
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
    return this.apply(
      run,
      directory,
      canonicalDirectory,
      this.prepare(run, canonicalDirectory, filename, content),
    );
  }

  /** Called in the same SQLite transaction as the worker's pending-action checkpoint. */
  prepare(run: RunContext, canonicalDirectory: string, filename: string, content: string): string {
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
    return id;
  }

  async apply(
    run: RunContext,
    directory: string,
    canonicalDirectory: string,
    id: string,
  ): Promise<string> {
    const db = this.core.database.getDb();
    const proposal = this.list(run.runId).find((item) => item.id === id);
    if (
      !proposal ||
      proposal.destination !== join(canonicalDirectory, basename(proposal.destination))
    )
      throw new Error('The saved action does not belong to this output grant.');
    const { destination, content, content_hash: hash } = proposal;
    if (proposal.state === 'verified') return `Created and verified ${destination}`;
    if (proposal.state === 'rejected')
      return 'The user rejected this file. Explain the rejection or propose a different deliverable.';
    if (proposal.state !== 'pending')
      throw new Error('Reconcile the saved file action before resuming.');
    run.signal.throwIfAborted();
    run.status = 'waiting_approval';
    this.core.runs.update(run.runId, { status: 'waiting_approval' });

    const approved = await new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        if (
          !['paused', 'waiting_input'].includes(this.core.runs.getById(run.runId)?.status ?? '')
        ) {
          db.prepare(
            "UPDATE file_proposals SET state = 'cancelled' WHERE id = ? AND state IN ('pending', 'approved')",
          ).run(id);
        }
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
      db.prepare("UPDATE file_proposals SET state = ? WHERE id = ? AND state = 'approved'").run(
        this.core.runs.getById(run.runId)?.status === 'paused' ? 'pending' : 'cancelled',
        id,
      );
      run.signal.throwIfAborted();
    }
    run.status = 'running';
    this.core.runs.update(run.runId, { status: 'running' });
    if (!approved)
      return 'The user rejected this file. Explain the rejection or propose a different deliverable.';

    let descriptor: number | undefined;
    let created = false;
    try {
      run.signal.throwIfAborted();
      if (this.core.settings.get('worker_dispatch_enabled') === 'false')
        throw new Error('Dispatch is stopped.');
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
  /** Reconcile only after explicit user review and a renewed output grant. Never overwrite. */
  reconcile(
    runId: string,
    id: string,
    directory: string,
    canonicalDirectory: string,
    mode: 'verify' | 'retry',
  ): void {
    const proposal = this.list(runId).find((item) => item.id === id);
    if (!proposal || proposal.state !== 'uncertain') throw new Error('Choose an uncertain action.');
    if (
      realpathSync(directory) !== canonicalDirectory ||
      proposal.destination !== join(canonicalDirectory, basename(proposal.destination))
    )
      throw new Error('Regrant the original output directory.');
    let state: string;
    if (mode === 'verify') {
      if (
        realpathSync(proposal.destination) !== proposal.destination ||
        !statSync(proposal.destination).isFile() ||
        statSync(proposal.destination).size > 65536
      )
        throw new Error('The destination must be a regular file at its recorded path.');
      const actual = readFileSync(proposal.destination, 'utf8');
      if (createHash('sha256').update(actual).digest('hex') !== proposal.content_hash)
        throw new Error(
          'The existing file differs from the approved content. It will not be overwritten.',
        );
      state = 'verified';
    } else if (mode === 'retry') {
      // realpath would miss a dangling symlink; exclusive creation remains the final protection.
      if (existsSync(proposal.destination))
        throw new Error('A destination already exists. Inspect it before retrying.');
      state = 'pending';
    } else throw new Error('Choose verification or an absent-file retry.');
    this.core.database
      .getDb()
      .prepare('UPDATE file_proposals SET state = ?, error = NULL WHERE id = ?')
      .run(state, id);
  }
}
