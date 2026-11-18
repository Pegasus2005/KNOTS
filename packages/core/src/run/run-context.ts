/**
 * RunContext: holds the in-memory state of an active or recent run.
 */
import type { RunStatus, ModelMessage } from '@knots/types';

export interface RunContextOptions {
  runId: string;
  knotName: string;
  input: string;
  strandId?: string;
  strandName?: string;
  systemPrompt?: string;
}

export class RunContext {
  readonly runId: string;
  readonly knotName: string;
  readonly input: string;

  strandId?: string;
  strandName?: string;
  modelUsed?: string;

  status: RunStatus = 'queued';
  messages: ModelMessage[] = [];
  output = '';
  error?: string;

  tokensIn?: number;
  tokensOut?: number;
  cost?: number;

  readonly abortController = new AbortController();
  readonly startTime: number;
  endTime?: number;

  constructor(options: RunContextOptions) {
    this.runId = options.runId;
    this.knotName = options.knotName;
    this.input = options.input;
    this.strandId = options.strandId;
    this.strandName = options.strandName;
    this.startTime = Date.now();

    if (options.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: options.systemPrompt,
      });
    }

    if (options.input) {
      this.messages.push({
        role: 'user',
        content: options.input,
      });
    }
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isCancelled(): boolean {
    return this.abortController.signal.aborted;
  }

  get durationMs(): number {
    const end = this.endTime ?? Date.now();
    return Math.max(0, end - this.startTime);
  }

  appendOutput(delta: string): void {
    this.output += delta;
  }

  addMessage(role: 'system' | 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content });
  }

  cancel(reason = 'Cancelled by user'): void {
    if (!this.isCancelled) {
      this.status = 'cancelled';
      this.endTime = Date.now();
      this.abortController.abort(reason);
    }
  }
}
