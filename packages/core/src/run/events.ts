/**
 * Run lifecycle events.
 */

export interface RunStartedEvent {
  type: 'started';
  runId: string;
  knotName: string;
  strandId?: string;
  strandName?: string;
  timestamp: string;
}

export interface RunProgressEvent {
  type: 'progress';
  runId: string;
  delta: string;
  accumulated: string;
  chunkIndex: number;
  timestamp: string;
}

export interface RunChunkEvent {
  type: 'chunk';
  runId: string;
  delta: string;
  timestamp: string;
}

export interface RunCompletedEvent {
  type: 'completed';
  runId: string;
  output: string;
  modelUsed?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  durationMs: number;
  timestamp: string;
}

export interface RunFailedEvent {
  type: 'failed';
  runId: string;
  error: string;
  durationMs: number;
  timestamp: string;
}

export interface RunCancelledEvent {
  type: 'cancelled';
  runId: string;
  reason?: string;
  durationMs: number;
  timestamp: string;
}

export type RunLifecycleEvent =
  | RunStartedEvent
  | RunProgressEvent
  | RunChunkEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent;

export type RunEventListener = (event: RunLifecycleEvent) => void;
