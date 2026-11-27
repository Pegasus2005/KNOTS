import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import BetterSqlite3 from 'better-sqlite3';
export async function testRelease(directory) {
  const { createCore } = await import('@knots/core');
  const core = createCore(directory);
  const id = core.runs.create({ knot_name: 'upgrade', input: 'Preserve my work.' }).id;
  core.database
    .getDb()
    .exec(
      'DROP TABLE lab_records; DROP TABLE bot_drafts; DROP TABLE worker_submissions; DROP TABLE plan_messages; DROP TABLE conversation_summaries; DROP TABLE memories; DELETE FROM schema_version WHERE version >= 10;',
    );
  core.close();
  const upgraded = createCore(directory);
  const backup = upgraded.database.migrationBackupPath;
  assert.ok(backup);
  assert.equal(upgraded.runs.getById(id).input, 'Preserve my work.');
  const snapshot = new BetterSqlite3(backup, { readonly: true });
  assert.equal(
    snapshot.prepare('SELECT MAX(version) AS version FROM schema_version').get().version,
    9,
  );
  assert.equal(
    snapshot.prepare('SELECT input FROM runs WHERE id = ?').get(id).input,
    'Preserve my work.',
  );
  snapshot.close();
  if (process.platform !== 'win32') assert.equal((await stat(backup)).mode & 0o077, 0);
  upgraded.database.getDb().exec('INSERT INTO schema_version (version) VALUES (999);');
  upgraded.close();
  assert.throws(() => createCore(directory), /newer than/);
  const newer = new BetterSqlite3(directory + '/knots.db');
  assert.equal(
    newer.prepare('SELECT MAX(version) AS version FROM schema_version').get().version,
    999,
  );
  newer.exec(
    'DELETE FROM schema_version WHERE version >= 10; DROP TABLE lab_records; DROP TABLE bot_drafts; DROP TABLE worker_submissions; DROP TABLE plan_messages; DROP TABLE conversation_summaries; DROP TABLE memories; CREATE TABLE memories (malformed TEXT);',
  );
  newer.close();
  assert.throws(() => createCore(directory), /already exists/);
  const failed = new BetterSqlite3(directory + '/knots.db');
  assert.equal(
    failed.prepare('SELECT MAX(version) AS version FROM schema_version').get().version,
    9,
  );
  assert.equal(
    failed.prepare('SELECT input FROM runs WHERE id = ?').get(id).input,
    'Preserve my work.',
  );
  failed.close();
  assert.ok((await readdir(directory)).filter((name) => name.endsWith('.backup')).length >= 2);
  console.log(
    'PASS: private consistent migration backups, preserved old data, newer-schema refusal and failed-migration rollback.',
  );
}
