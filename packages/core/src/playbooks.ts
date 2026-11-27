import { inheritedRunPolicies } from './policies.js';
import { randomUUID } from 'node:crypto';
import type { KnotSpec } from '@knots/types';
import type { KnotsCore } from './index.js';
import { boundedText, fingerprint } from './bot-creation.js';
import { parseFileAction, type FileAction } from './tools/files.js';
export interface PlaybookEntry {
  id: string;
  knotName: string;
  kind: 'preference' | 'lesson' | 'procedure';
  scope: string;
  content: string;
  enabled: boolean;
  version: number;
  supersedes?: string;
  sourceRunId?: string;
  policy: KnotSpec[];
  steps: FileAction[];
  createdAt: string;
  imported: boolean;
}
/** Structured, scoped guidance. Entries confer no tool permissions or action approvals. */
export class Playbooks {
  constructor(private core: KnotsCore) {}
  private get db() {
    return this.core.database.getDb();
  }
  list(): PlaybookEntry[] {
    return (
      this.db
        .prepare("SELECT data FROM lab_records WHERE kind='playbook' ORDER BY rowid DESC")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  get(id: string) {
    const entry = this.list().find((e) => e.id === id);
    if (!entry) throw new Error('Playbook entry not found.');
    return entry;
  }
  private put(entry: PlaybookEntry) {
    this.db
      .prepare(
        "INSERT INTO lab_records(id,kind,data) VALUES(?,'playbook',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE kind='playbook'",
      )
      .run(entry.id, JSON.stringify(entry));
  }
  private policy(name: string, sourceRunId?: string) {
    if (!this.core.knots.list().includes(name)) throw new Error('Bot not found.');
    const base = this.core.knots.get(name, { resolveKnowledgeRefs: false })!.spec;
    const policies = [base];
    if (sourceRunId) policies.push(...inheritedRunPolicies(this.core, sourceRunId));
    return policies;
  }
  save(input: {
    knotName: string;
    kind: PlaybookEntry['kind'];
    scope: string;
    content: string;
    sourceRunId?: string;
    steps?: FileAction[];
    supersedes?: string;
    enabled: boolean;
    imported?: boolean;
  }) {
    if (!['preference', 'lesson', 'procedure'].includes(input.kind))
      throw new Error('Invalid playbook kind.');
    const scope = boundedText(input.scope, 'Scope', 200).toLowerCase(),
      content = boundedText(input.content, 'Guidance', 8000),
      policy = this.policy(input.knotName, input.sourceRunId);
    if (!Array.isArray(input.steps ?? []) || (input.steps ?? []).length > 12)
      throw new Error('Use at most twelve procedure steps.');
    const steps = (input.steps ?? []).map((step) => {
      const parsed = parseFileAction(step, ['list_files', 'read_file', 'create_file']);
      this.path(parsed.path, parsed.tool === 'list_files');
      if (parsed.tool === 'create_file') boundedText(parsed.content, 'Fixture file', 64000);
      return parsed.tool === 'create_file'
        ? { tool: parsed.tool, path: parsed.path, content: parsed.content }
        : { tool: parsed.tool, path: parsed.path };
    });
    if (input.kind !== 'procedure' && steps.length)
      throw new Error('Only procedures can contain steps.');
    if (input.imported) policy.push({ ...policy[0], model_preferences: { privacy: 'local_only' } });
    const previous = input.supersedes ? this.get(input.supersedes) : undefined;
    if (previous && (previous.knotName !== input.knotName || previous.kind !== input.kind))
      throw new Error('Revise the same bot and entry kind.');
    if (
      input.enabled &&
      this.list().some(
        (e) =>
          e.enabled &&
          e.knotName === input.knotName &&
          e.kind === input.kind &&
          e.scope === scope &&
          e.id !== previous?.id,
      )
    )
      throw new Error('Conflicting active entry: explicitly revise or disable it first.');
    const entry: PlaybookEntry = {
      id: randomUUID(),
      knotName: input.knotName,
      kind: input.kind,
      scope,
      content,
      steps,
      enabled: input.imported ? false : input.enabled === true,
      version: (previous?.version ?? 0) + 1,
      supersedes: previous?.id,
      sourceRunId: input.sourceRunId,
      policy: [...policy, ...(previous?.policy ?? [])],
      createdAt: new Date().toISOString(),
      imported: input.imported === true,
    };
    this.db.transaction(() => {
      if (previous) {
        previous.enabled = false;
        this.put(previous);
      }
      this.put(entry);
    })();
    return entry.id;
  }
  enable(id: string, enabled: boolean) {
    const entry = this.get(id);
    if (
      enabled &&
      this.list().some(
        (e) =>
          e.id !== id &&
          e.enabled &&
          e.knotName === entry.knotName &&
          e.kind === entry.kind &&
          e.scope === entry.scope,
      )
    )
      throw new Error('Resolve the conflicting active entry first.');
    entry.enabled = enabled === true;
    this.put(entry);
  }
  forget(id: string) {
    this.db.prepare("DELETE FROM lab_records WHERE kind='playbook' AND id=?").run(id);
  }
  retrieve(knotName: string, prompt: string) {
    const words = new Set(prompt.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    return this.list()
      .filter((e) => e.enabled && e.knotName === knotName)
      .map((e) => ({
        e,
        score:
          e.scope === '*'
            ? 1
            : [...words].filter((w) => `${e.scope} ${e.content}`.toLowerCase().includes(w)).length,
      }))
      .filter((v) => v.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((v) => v.e);
  }
  private path(path: unknown, allowRoot = false) {
    if (
      typeof path !== 'string' ||
      (!allowRoot && path === '.') ||
      !path ||
      path.length > 200 ||
      path.includes('\\') ||
      path.includes('\0') ||
      path.startsWith('/') ||
      path.split('/').some((p) => p === '..' || p === '') ||
      path.includes(':')
    )
      throw new Error('Fixture paths must be bounded relative paths.');
    return path;
  }
  fixture(id: string, input: { files: Record<string, string>; expected: Record<string, string> }) {
    const entry = this.get(id);
    if (entry.kind !== 'procedure' || !entry.steps.length)
      throw new Error('Add procedure steps first.');
    if (
      !input.files ||
      !input.expected ||
      Object.keys(input.files).length > 20 ||
      Object.keys(input.expected).length > 20
    )
      throw new Error('Use at most twenty fixture files and assertions.');
    const files = new Map<string, string>();
    for (const [path, value] of Object.entries(input.files)) {
      this.path(path);
      if (typeof value !== 'string' || Buffer.byteLength(value) > 65536 || value.includes('\0'))
        throw new Error('Invalid fixture text.');
      files.set(path, value);
    }
    const transcript: unknown[] = [];
    let error: string | undefined;
    try {
      for (const step of entry.steps) {
        this.path(step.path, step.tool === 'list_files');
        if (step.tool === 'list_files') {
          transcript.push({
            tool: step.tool,
            files: [...files.keys()].filter(
              (p) => step.path === '.' || p.startsWith(step.path + '/'),
            ),
          });
        } else if (step.tool === 'read_file') {
          if (!files.has(step.path)) throw new Error(`Missing fixture ${step.path}`);
          transcript.push({ tool: step.tool, path: step.path, content: files.get(step.path) });
        } else {
          if (files.has(step.path)) throw new Error('Fixture create cannot overwrite a file.');
          files.set(step.path, step.content);
          transcript.push({ tool: step.tool, path: step.path, hash: fingerprint(step.content) });
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const checks = Object.entries(input.expected).map(([path, content]) => {
      this.path(path);
      if (typeof content !== 'string' || Buffer.byteLength(content) > 65536)
        throw new Error('Invalid expected fixture text.');
      return { path, passed: files.get(path) === content };
    });
    if (!checks.length) throw new Error('Include an expected output assertion.');
    const result = {
      id: randomUUID(),
      entryId: id,
      entryHash: fingerprint(entry),
      passed: !error && checks.every((c) => c.passed),
      checks,
      error,
      transcript,
      files: input.files,
      expected: input.expected,
      scope: 'isolated virtual text files only',
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO lab_records(id,kind,data) VALUES(?,'fixture',?)")
      .run(result.id, JSON.stringify(result));
    return result;
  }
  fixtures() {
    return (
      this.db
        .prepare("SELECT data FROM lab_records WHERE kind='fixture' ORDER BY rowid DESC")
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  export(ids: string[], reviewed: boolean) {
    if (reviewed !== true || !Array.isArray(ids) || !ids.length || ids.length > 20)
      throw new Error('Explicitly select and review 1–20 entries for export.');
    return {
      version: 1,
      entries: ids.map((id) => {
        const e = this.get(id);
        return { kind: e.kind, scope: e.scope, content: e.content, steps: e.steps };
      }),
    };
  }
  import(knotName: string, value: unknown, reviewed: boolean) {
    const bundle = value as { version: number; entries: PlaybookEntry[] };
    if (
      !reviewed ||
      !bundle ||
      bundle.version !== 1 ||
      !Array.isArray(bundle.entries) ||
      !bundle.entries.length ||
      bundle.entries.length > 20 ||
      JSON.stringify(bundle).length > 200000
    )
      throw new Error('Review a valid bounded playbook package first.');
    const ids: string[] = [];
    this.db.transaction(() => {
      for (const e of bundle.entries)
        ids.push(
          this.save({
            knotName,
            kind: e.kind,
            scope: e.scope,
            content: e.content,
            steps: e.steps,
            enabled: false,
            imported: true,
          }),
        );
    })();
    return ids;
  }
}
