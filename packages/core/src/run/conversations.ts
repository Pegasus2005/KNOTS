import type { KnotsCore } from '../index.js';
import type { KnotSpec, ModelMessage } from '@knots/types';
import { fitMessagesForWindow, summarizeTurns } from '../memory.js';

export interface ConversationContextOptions {
  /** Allow switching to a different knot inside an existing conversation while inheriting constraints. */
  allowKnotSwitch?: boolean;
  /** Optional target context byte limit so older turns compact cleanly across model switches. */
  maxBytes?: number;
}

export function conversationContext(
  core: KnotsCore,
  id: string,
  knotName: string,
  options: ConversationContextOptions = {},
) {
  const conversation = core.database
    .getDb()
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(id) as { knot_name: string } | undefined;
  if (!conversation || (!options.allowKnotSwitch && conversation.knot_name !== knotName))
    throw new Error('Choose the conversation’s original knot, or start a new chat.');
  const rows = core.database
    .getDb()
    .prepare('SELECT run_id FROM conversation_runs WHERE conversation_id = ? ORDER BY turn')
    .all(id) as { run_id: string }[];
  const messages: ModelMessage[] = [];
  const turns: { input: string; output: string }[] = [];
  const constraints: KnotSpec[] = [];
  for (const { run_id } of rows) {
    const run = core.runs.getById(run_id)!;
    if (!['completed', 'failed', 'cancelled'].includes(run.status))
      throw new Error('Finish or cancel the current turn before sending another message.');
    if (run.status !== 'completed') continue;
    const turn = { input: run.input, output: run.output ?? '' };
    turns.push(turn);
    messages.push(
      { role: 'user', content: turn.input },
      { role: 'assistant', content: turn.output },
    );
    const snapshot = core.database
      .getDb()
      .prepare('SELECT spec FROM run_snapshots WHERE run_id = ?')
      .get(run_id) as { spec: string } | undefined;
    if (snapshot) constraints.push(JSON.parse(snapshot.spec));
    const job = core.database
      .getDb()
      .prepare('SELECT envelope FROM worker_jobs WHERE run_id = ?')
      .get(run_id) as { envelope: string } | undefined;
    if (job) constraints.push(...(JSON.parse(job.envelope).input.constraints ?? []));
  }
  const uniqueConstraints = [
    ...new Map(constraints.map((spec) => [JSON.stringify(spec), spec])).values(),
  ];
  const existingSummary = core.memory.getSummary(id);
  const effectivePrivacy = uniqueConstraints.some(
    (spec) => spec.model_preferences?.privacy === 'local_only',
  )
    ? 'local_only'
    : 'cloud_allowed';

  // Persist a rolling summary automatically once a conversation grows past a few turns.
  if (turns.length >= 4 && (!existingSummary || existingSummary.last_run_count < turns.length)) {
    const distilled = summarizeTurns(turns.slice(0, Math.max(1, turns.length - 2)));
    if (distilled) core.memory.saveSummary(id, distilled, turns.length, effectivePrivacy);
  }

  const maxBytes = options.maxBytes ?? 128000;
  const serializedLength = JSON.stringify(messages).length;
  let finalMessages = messages;
  let summaryText = core.memory.getSummary(id)?.summary;

  if (serializedLength > maxBytes) {
    if (!summaryText && turns.length > 1) {
      summaryText = summarizeTurns(turns.slice(0, turns.length - 1));
      if (summaryText) core.memory.saveSummary(id, summaryText, turns.length, effectivePrivacy);
    }
    const fitted = fitMessagesForWindow('', messages, summaryText, maxBytes);
    if (!fitted.fits) {
      throw new Error(
        'This conversation exceeds the 128,000 character context limit. Start a new chat.',
      );
    }
    finalMessages = fitted.messages;
  }

  return {
    messages: finalMessages,
    summary: summaryText,
    constraints: uniqueConstraints,
  };
}
