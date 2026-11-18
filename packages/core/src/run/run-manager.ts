/**
 * RunManager: manages the execution lifecycle of runs (pulls),
 * emits events, supports cancellation, and persists run history.
 */
import { EventEmitter } from 'node:events';
import type { RunStore } from '../storage/run-store.js';
import type { RunStatus } from '@knots/types';
import { RunContext } from './run-context.js';
import type {
  RunStartedEvent,
  RunProgressEvent,
  RunChunkEvent,
  RunCompletedEvent,
  RunFailedEvent,
  RunCancelledEvent,
  RunLifecycleEvent,
} from './events.js';

export interface RunManagerConfig {
  runStore: RunStore;
}

export interface CreateRunOptions {
  knotName: string;
  input: string;
  strandId?: string;
  strandName?: string;
  systemPrompt?: string;
}

export class RunManager extends EventEmitter {
  private readonly runStore: RunStore;
  private readonly activeRuns = new Map<string, RunContext>();
  private chunkCounters = new Map<string, number>();

  constructor(config: RunManagerConfig) {
    super();
    this.runStore = config.runStore;
  }

  /**
   * Create and register a new run. Persists a queued record in the database.
   */
  createRun(options: CreateRunOptions): RunContext {
    const record = this.runStore.create({
      knot_name: options.knotName,
      input: options.input,
      strand_id: options.strandId,
      strand_name: options.strandName,
    });

    const context = new RunContext({
      runId: record.id,
      knotName: options.knotName,
      input: options.input,
      strandId: options.strandId,
      strandName: options.strandName,
      systemPrompt: options.systemPrompt,
    });

    this.activeRuns.set(record.id, context);
    this.chunkCounters.set(record.id, 0);

    return context;
  }

  /**
   * Transition a run to 'running'. Emits RunStartedEvent.
   */
  startRun(runId: string): RunContext {
    const context = this.getRequiredContext(runId);
    context.status = 'running';

    const startedAt = new Date().toISOString();
    this.runStore.update(runId, {
      status: 'running',
      started_at: startedAt,
      strand_id: context.strandId,
      strand_name: context.strandName,
    });

    const event: RunStartedEvent = {
      type: 'started',
      runId,
      knotName: context.knotName,
      strandId: context.strandId,
      strandName: context.strandName,
      timestamp: startedAt,
    };

    this.emitEvent('started', event);
    return context;
  }

  /**
   * Record streaming progress / chunk for a run. Emits progress and chunk events.
   */
  progressRun(runId: string, delta: string): void {
    const context = this.activeRuns.get(runId);
    if (!context || context.isCancelled) return;

    context.appendOutput(delta);
    this.runStore.update(runId, { output: context.output });

    const chunkIndex = (this.chunkCounters.get(runId) ?? 0) + 1;
    this.chunkCounters.set(runId, chunkIndex);

    const timestamp = new Date().toISOString();

    const progressEvent: RunProgressEvent = {
      type: 'progress',
      runId,
      delta,
      accumulated: context.output,
      chunkIndex,
      timestamp,
    };
    this.emitEvent('progress', progressEvent);

    const chunkEvent: RunChunkEvent = {
      type: 'chunk',
      runId,
      delta,
      timestamp,
    };
    this.emitEvent('chunk', chunkEvent);
  }

  /**
   * Complete a run successfully. Emits RunCompletedEvent.
   */
  completeRun(
    runId: string,
    details?: {
      output?: string;
      modelUsed?: string;
      tokensIn?: number;
      tokensOut?: number;
      cost?: number;
    },
  ): RunContext {
    const context = this.getRequiredContext(runId);
    context.status = 'completed';
    context.endTime = Date.now();

    if (details?.output !== undefined) {
      context.output = details.output;
    }
    if (details?.modelUsed !== undefined) {
      context.modelUsed = details.modelUsed;
    }
    if (details?.tokensIn !== undefined) {
      context.tokensIn = details.tokensIn;
    }
    if (details?.tokensOut !== undefined) {
      context.tokensOut = details.tokensOut;
    }
    if (details?.cost !== undefined) {
      context.cost = details.cost;
    }

    const completedAt = new Date().toISOString();
    this.runStore.update(runId, {
      status: 'completed',
      output: context.output,
      model_used: context.modelUsed,
      tokens_in: context.tokensIn,
      tokens_out: context.tokensOut,
      cost: context.cost,
      duration_ms: context.durationMs,
      completed_at: completedAt,
    });

    const event: RunCompletedEvent = {
      type: 'completed',
      runId,
      output: context.output,
      modelUsed: context.modelUsed,
      tokensIn: context.tokensIn,
      tokensOut: context.tokensOut,
      cost: context.cost,
      durationMs: context.durationMs,
      timestamp: completedAt,
    };

    this.emitEvent('completed', event);
    this.cleanup(runId);

    return context;
  }

  /**
   * Mark a run as failed with an error. Emits RunFailedEvent.
   */
  failRun(runId: string, error: string): RunContext {
    const context = this.getRequiredContext(runId);
    context.status = 'failed';
    context.error = error;
    context.endTime = Date.now();

    const completedAt = new Date().toISOString();
    this.runStore.update(runId, {
      status: 'failed',
      output: context.output,
      error,
      duration_ms: context.durationMs,
      completed_at: completedAt,
    });

    const event: RunFailedEvent = {
      type: 'failed',
      runId,
      error,
      durationMs: context.durationMs,
      timestamp: completedAt,
    };

    this.emitEvent('failed', event);
    this.cleanup(runId);

    return context;
  }

  /**
   * Cancel an active or queued run. Emits RunCancelledEvent.
   */
  cancelRun(runId: string, reason = 'Cancelled by user'): boolean {
    const context = this.activeRuns.get(runId);
    if (!context) return false;

    context.cancel(reason);
    context.endTime = Date.now();

    const completedAt = new Date().toISOString();
    this.runStore.update(runId, {
      status: 'cancelled',
      output: context.output,
      error: reason,
      duration_ms: context.durationMs,
      completed_at: completedAt,
    });

    const event: RunCancelledEvent = {
      type: 'cancelled',
      runId,
      reason,
      durationMs: context.durationMs,
      timestamp: completedAt,
    };

    this.emitEvent('cancelled', event);
    this.cleanup(runId);

    return true;
  }

  /**
   * Kill switch: cancel all currently active runs.
   */
  cancelAll(reason = 'Emergency kill-all'): number {
    let cancelledCount = 0;
    for (const runId of [...this.activeRuns.keys()]) {
      if (this.cancelRun(runId, reason)) {
        cancelledCount++;
      }
    }
    return cancelledCount;
  }

  /**
   * Set status to waiting_input (e.g. for interactive conversations).
   */
  setWaitingInput(runId: string): RunContext {
    const context = this.getRequiredContext(runId);
    context.status = 'waiting_input';
    this.runStore.update(runId, { status: 'waiting_input' as RunStatus });
    return context;
  }

  /**
   * Get an active run context by ID.
   */
  getContext(runId: string): RunContext | undefined {
    return this.activeRuns.get(runId);
  }

  /**
   * List all currently active run contexts.
   */
  getActiveRuns(): RunContext[] {
    return Array.from(this.activeRuns.values());
  }

  private getRequiredContext(runId: string): RunContext {
    const ctx = this.activeRuns.get(runId);
    if (!ctx) {
      throw new Error(`Run context not found: ${runId}`);
    }
    return ctx;
  }

  private cleanup(runId: string): void {
    this.activeRuns.delete(runId);
    this.chunkCounters.delete(runId);
  }

  private emitEvent(eventName: string, event: RunLifecycleEvent): void {
    this.emit(eventName, event);
    this.emit('event', event);
    this.emit(`run:${event.runId}`, event);
  }
}
