import type { KnotSpec } from '@knots/types';
import type { KnotsCore } from './index.js';
/** Recover all restrictions attached to data consumed by a persisted run. */
export function inheritedRunPolicies(core: KnotsCore, runId: string): KnotSpec[] {
  const db = core.database.getDb();
  const snapshot = db.prepare('SELECT spec FROM run_snapshots WHERE run_id=?').get(runId) as
    { spec: string } | undefined;
  if (!snapshot) throw new Error('Source run has no policy snapshot.');
  const job = db
    .prepare('SELECT envelope,checkpoint FROM worker_jobs WHERE run_id=?')
    .get(runId) as { envelope: string; checkpoint: string } | undefined;
  const auto = db.prepare("SELECT data FROM lab_records WHERE id=? AND kind='auto'").get(runId) as
    { data: string } | undefined;
  const session = auto ? JSON.parse(auto.data) : undefined;
  const policies: KnotSpec[] = [
    JSON.parse(snapshot.spec),
    ...(job ? (JSON.parse(job.envelope).input.constraints ?? []) : []),
    ...(job ? (JSON.parse(job.checkpoint).extraConstraints ?? []) : []),
    ...(session?.priorContext?.constraints ?? []),
    ...(session?.derivedPolicies ?? []),
  ];
  return [...new Map(policies.map((p) => [JSON.stringify(p), p])).values()];
}
