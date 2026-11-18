/**
 * Retry utility with exponential backoff for transient provider errors.
 */

import { ProviderError } from './types.js';

const RETRYABLE_CODES = new Set(['rate_limit', 'connection_error', 'server_error', 'timeout']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, maxDelayMs = 30_000 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;

      const isRetryable =
        err instanceof ProviderError &&
        (err.retryable || RETRYABLE_CODES.has(err.code));
      if (!isRetryable) throw err;

      if (err instanceof ProviderError && typeof err.retry_after_ms === 'number' && err.retry_after_ms > 0) {
        await sleep(Math.min(err.retry_after_ms, maxDelayMs));
      } else {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        const jitter = delay * (0.5 + Math.random() * 0.5);
        await sleep(jitter);
      }
    }
  }
  throw lastError;
}
