import chalk from 'chalk';
import type { ModelChunk, TokenUsage } from '@knots/types';

export interface AttributionInfo {
  strandName?: string;
  model: string;
  durationMs?: number;
  tokens?: TokenUsage;
}

/**
 * Render streaming chunks to stdout in real-time, accumulating the full response.
 */
export async function renderStream(
  stream: AsyncIterable<ModelChunk>,
  onChunk?: (delta: string) => void,
): Promise<{ text: string; finalChunk?: ModelChunk }> {
  let fullText = '';
  let finalChunk: ModelChunk | undefined;

  for await (const chunk of stream) {
    if (chunk.delta) {
      process.stdout.write(chunk.delta);
      fullText += chunk.delta;
      if (onChunk) {
        onChunk(chunk.delta);
      }
    }
    if (chunk.is_final) {
      finalChunk = chunk;
    }
  }

  // Ensure trailing newline
  if (!fullText.endsWith('\n')) {
    process.stdout.write('\n');
  }

  return { text: fullText, finalChunk };
}

/**
 * Print attribution footer for a run.
 */
export function printAttribution(info: AttributionInfo): void {
  const parts: string[] = [];

  const modelLabel = info.strandName
    ? `${chalk.bold.magenta(info.model)} (via ${chalk.cyan(info.strandName)})`
    : chalk.bold.magenta(info.model);
  parts.push(modelLabel);

  if (info.durationMs !== undefined) {
    parts.push(chalk.dim(`${info.durationMs}ms`));
  }

  if (info.tokens) {
    parts.push(chalk.dim(`${info.tokens.prompt_tokens} in / ${info.tokens.completion_tokens} out tokens`));
  }

  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray('Model attribution: ') + parts.join(chalk.gray(' • ')));
}
