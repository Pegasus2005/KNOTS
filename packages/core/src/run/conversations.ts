import type { KnotsCore } from '../index.js';
import type { KnotSpec, ModelMessage } from '@knots/types';
export function conversationContext(core: KnotsCore, id: string, knotName: string) {
  const conversation = core.database
    .getDb()
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(id) as { knot_name: string } | undefined;
  if (!conversation || conversation.knot_name !== knotName)
    throw new Error('Choose the conversation’s original knot, or start a new chat.');
  const rows = core.database
    .getDb()
    .prepare('SELECT run_id FROM conversation_runs WHERE conversation_id = ? ORDER BY turn')
    .all(id) as { run_id: string }[];
  const messages: ModelMessage[] = [];
  const constraints: KnotSpec[] = [];
  for (const { run_id } of rows) {
    const run = core.runs.getById(run_id)!;
    if (!['completed', 'failed', 'cancelled'].includes(run.status))
      throw new Error('Finish or cancel the current turn before sending another message.');
    if (run.status !== 'completed') continue;
    messages.push(
      { role: 'user', content: run.input },
      { role: 'assistant', content: run.output ?? '' },
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
  if (JSON.stringify(messages).length > 128000)
    throw new Error(
      'This conversation exceeds the 128,000 character context limit. Start a new chat.',
    );
  return {
    messages,
    constraints: [...new Map(constraints.map((spec) => [JSON.stringify(spec), spec])).values()],
  };
}
