import { v4 as uuid } from 'uuid';
import type BetterSqlite3 from 'better-sqlite3';
import type { MemoryEntry, MemoryPrivacy, ModelMessage } from '@knots/types';

const MAX_MEMORY_BYTES = 8192;
const MAX_SUMMARY_CHARS = 3600;

interface MemoryRow {
  id: string;
  content: string;
  tags: string;
  privacy: string;
  source_run_id: string | null;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  conversation_id: string;
  summary: string;
  last_run_count: number;
  privacy: string;
  updated_at: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where', 'which',
  'your', 'you', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'can', 'will',
  'on', 'in', 'at', 'to', 'of', 'is', 'it', 'by', 'or', 'an', 'as', 'my', 'be', 'do', 'if',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
      .filter((word) => !STOPWORDS.has(word))
      .slice(0, 500),
  );
}

function validMemoryText(value: unknown, label = 'Memory'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} cannot be empty.`);
  }
  const trimmed = value.trim();
  if (new TextEncoder().encode(trimmed).length > MAX_MEMORY_BYTES || trimmed.includes('\0')) {
    throw new Error(`${label} supports UTF-8 text up to 8 KB.`);
  }
  return trimmed;
}

function rowToMemory(row: MemoryRow): MemoryEntry {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    content: row.content,
    tags,
    privacy: row.privacy === 'cloud_allowed' ? 'cloud_allowed' : 'local_only',
    source_run_id: row.source_run_id ?? undefined,
    source_conversation_id: row.source_conversation_id ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function estimateContextBytes(system: string, messages: ModelMessage[]): number {
  return new TextEncoder().encode(system + JSON.stringify(messages)).length + 128 * (messages.length + 1);
}

/** Distill message turns into a compact, provider-neutral summary. */
export function summarizeTurns(turns: { input: string; output: string }[]): string {
  if (!turns.length) return '';
  const perTurnLimit = Math.max(120, Math.floor(MAX_SUMMARY_CHARS / Math.max(1, turns.length)) - 24);
  const clip = (value: string, max: number) => {
    const single = value.replace(/\s+/g, ' ').trim();
    return single.length > max ? single.slice(0, max - 1) + '…' : single;
  };
  const lines = turns.map((turn, index) => {
    const half = Math.max(50, Math.floor(perTurnLimit / 2));
    return `${index + 1}. User: ${clip(turn.input, half)} → Assistant: ${clip(turn.output, half)}`;
  });
  let combined = lines.join('\n');
  if (combined.length > MAX_SUMMARY_CHARS) {
    combined = '…(older turns trimmed)\n' + combined.slice(-(MAX_SUMMARY_CHARS - 24));
  }
  return combined;
}

/**
 * Fit a multi-turn message list inside a target model's byte budget by folding
 * older turns into a portable summary while preserving the newest turn(s).
 */
export function fitMessagesForWindow(
  system: string,
  messages: ModelMessage[],
  savedSummary: string | undefined,
  maxBytes: number,
): { fits: boolean; compacted: boolean; messages: ModelMessage[] } {
  if (estimateContextBytes(system, messages) <= maxBytes) {
    return { fits: true, compacted: false, messages };
  }
  if (!messages.length) {
    return { fits: false, compacted: false, messages };
  }

  // Keep as many trailing turns as possible while folding earlier turns into a bounded summary message.
  const latest = messages[messages.length - 1];
  if (estimateContextBytes(system, [latest]) > maxBytes) {
    return { fits: false, compacted: false, messages };
  }

  for (let keepTail = Math.min(messages.length - 1, 6); keepTail >= 1; keepTail--) {
    const earlier = messages.slice(0, messages.length - keepTail);
    const tail = messages.slice(messages.length - keepTail);
    if (!earlier.length) continue;

    const pairs: { input: string; output: string }[] = [];
    for (let i = 0; i < earlier.length; i += 2) {
      const userMsg = earlier[i];
      const assistantMsg = earlier[i + 1];
      pairs.push({
        input: userMsg?.content ?? '',
        output: assistantMsg?.content ?? '',
      });
    }
    const baseCandidate: ModelMessage[] = [{ role: 'user', content: 'Summary:\n' }, ...tail];
    const baseBytes = estimateContextBytes(system, baseCandidate);
    const room = maxBytes - baseBytes;
    if (room < 48) continue;

    // Fit compact per-turn bullets inside the exact remaining UTF-8 byte budget.
    const charBudget = Math.floor(room * 0.85);
    const generated = summarizeTurns(pairs);
    let mergedSummary = (generated || savedSummary?.trim() || '').trim();
    if (mergedSummary.length > charBudget) {
      const perPair = Math.max(24, Math.floor(charBudget / Math.max(1, pairs.length)) - 6);
      const compactLines = pairs.map((pair, idx) => {
        const half = Math.max(10, Math.floor(perPair / 2));
        const u = pair.input.replace(/\s+/g, ' ').trim().slice(0, half);
        const a = pair.output.replace(/\s+/g, ' ').trim().slice(0, half);
        return `${idx + 1}:${u}→${a}`;
      });
      mergedSummary = compactLines.join('\n').slice(-charBudget);
    }
    const candidate: ModelMessage[] = [
      {
        role: 'user',
        content: 'Portable context summary (model-independent):\n' + mergedSummary,
      },
      ...tail,
    ];
    while (
      estimateContextBytes(system, candidate) > maxBytes &&
      candidate[0].content.length > 64
    ) {
      candidate[0].content = candidate[0].content.slice(0, candidate[0].content.length - 32);
    }
    if (estimateContextBytes(system, candidate) <= maxBytes) {
      return { fits: true, compacted: true, messages: candidate };
    }
  }

  return { fits: true, compacted: true, messages: [latest] };
}

/** Cross-chat workspace memory + rolling summaries stored in SQLite. */
export class WorkspaceMemory {
  constructor(private readonly db: BetterSqlite3.Database) {}

  remember(input: {
    content: string;
    tags?: string[];
    privacy?: MemoryPrivacy;
    sourceRunId?: string;
    sourceConversationId?: string;
  }): MemoryEntry {
    const content = validMemoryText(input.content);
    const tags = (input.tags ?? [])
      .filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
      .map((t) => t.trim().slice(0, 32))
      .slice(0, 10);
    const privacy: MemoryPrivacy = input.privacy === 'cloud_allowed' ? 'cloud_allowed' : 'local_only';
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO memories (id, content, tags, privacy, source_run_id, source_conversation_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        content,
        JSON.stringify(tags),
        privacy,
        input.sourceRunId ?? null,
        input.sourceConversationId ?? null,
      );
    return this.getById(id)!;
  }

  getById(id: string): MemoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }

  list(limit = 100): MemoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM memories ORDER BY updated_at DESC, rowid DESC LIMIT ?')
      .all(limit) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  forget(id: string): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Automatically capture durable, compact context from a completed user chat turn
   * so future chats and model switches remember it with zero manual effort.
   */
  captureFromChatTurn(input: {
    input: string;
    output: string;
    tags?: string[];
    privacy: MemoryPrivacy;
    sourceRunId?: string;
    sourceConversationId?: string;
  }): MemoryEntry | undefined {
    const cleanInput = input.input.replace(/\s+/g, ' ').trim();
    const cleanOutput = input.output.replace(/\s+/g, ' ').trim();
    if (!cleanInput || !cleanOutput) return undefined;
    // Skip tiny greetings or trivial one-word acknowledgments that add noise.
    if (
      cleanInput.length < 8 ||
      /^(hi|hello|hey|ok|okay|thanks|thank you|cool|great|yes|no)[!.\s]*$/i.test(cleanInput)
    ) {
      return undefined;
    }

    const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);
    const content = `User: ${clip(cleanInput, 220)} → Assistant: ${clip(cleanOutput, 360)}`;

    const existing = this.db
      .prepare('SELECT id, privacy FROM memories WHERE content = ? LIMIT 1')
      .get(content) as { id: string; privacy: string } | undefined;
    if (existing) {
      const mergedPrivacy: MemoryPrivacy =
        existing.privacy === 'local_only' || input.privacy === 'local_only'
          ? 'local_only'
          : 'cloud_allowed';
      this.db
        .prepare("UPDATE memories SET privacy = ?, updated_at = datetime('now') WHERE id = ?")
        .run(mergedPrivacy, existing.id);
      return this.getById(existing.id);
    }

    const saved = this.remember({
      content,
      tags: input.tags,
      privacy: input.privacy,
      sourceRunId: input.sourceRunId,
      sourceConversationId: input.sourceConversationId,
    });

    // Keep workspace memory bounded to the 200 most recent entries.
    this.db.exec(`
      DELETE FROM memories
      WHERE id NOT IN (
        SELECT id FROM memories ORDER BY updated_at DESC, rowid DESC LIMIT 200
      );
    `);

    return saved;
  }

  /**
   * Retrieve top relevant cross-chat memories filtered strictly by privacy policy.
   * When allowLocalOnly is false, local_only memories are excluded before any model sees them.
   */
  retrieve(
    query: string,
    allowLocalOnly: boolean,
    limit = 6,
  ): Array<MemoryEntry & { citation: string; score: number }> {
    const words = tokenize(query);
    const all = this.list(200).filter(
      (entry) => allowLocalOnly || entry.privacy === 'cloud_allowed',
    );
    const scored = all
      .map((entry, index) => {
        const entryTokens = tokenize(`${entry.content} ${entry.tags.join(' ')}`);
        const overlap = [...words].filter((w) => entryTokens.has(w)).length;
        // Include tiny recency bias so recent general preferences still surface if relevant.
        const score = overlap * 10 + (overlap > 0 ? Math.max(0, 5 - index * 0.1) : 0);
        return { entry, score, overlap };
      })
      .filter((item) => item.overlap > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((item, idx) => ({
      ...item.entry,
      score: item.score,
      citation: `M${idx + 1}`,
    }));
  }

  getSummary(conversationId: string): SummaryRow | undefined {
    return this.db
      .prepare('SELECT * FROM conversation_summaries WHERE conversation_id = ?')
      .get(conversationId) as SummaryRow | undefined;
  }

  saveSummary(
    conversationId: string,
    summary: string,
    lastRunCount: number,
    privacy: MemoryPrivacy,
  ): void {
    this.db
      .prepare(
        `INSERT INTO conversation_summaries (conversation_id, summary, last_run_count, privacy, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(conversation_id) DO UPDATE SET
           summary = excluded.summary,
           last_run_count = excluded.last_run_count,
           privacy = CASE WHEN conversation_summaries.privacy = 'local_only' OR excluded.privacy = 'local_only' THEN 'local_only' ELSE 'cloud_allowed' END,
           updated_at = datetime('now')`,
      )
      .run(conversationId, summary, lastRunCount, privacy);
  }
}
