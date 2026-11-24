import assert from 'node:assert/strict';
import { testPlans } from './test-plans.mjs';
import { testDurable } from './test-durable.mjs';
import { testTeaching } from './test-teaching.mjs';
import { testRouting } from './test-routing.mjs';
import { mkdtemp, writeFile, readFile, access, mkdir, rm } from 'node:fs/promises';
import { app } from 'electron';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'knots-runtime-test-'));
app.setPath('userData', join(directory, 'electron'));

void app
  .whenReady()
  .then(async () => {
    const { createCore, KnotWorker, selectKnot, resolveDefaultStrand } =
      await import('@knots/core');
    const input = directory + '/input';
    const output = directory + '/output';
    await mkdir(input);
    await mkdir(output);
    await writeFile(input + '/release.txt', 'Version one improves bots.');
    const core = createCore(directory);
    const worker = new KnotWorker(core);
    const strand = core.strands.create({
      name: 'local',
      provider: 'ollama',
      model: 'fixture',
      is_local: true,
    });
    const second = core.strands.create({
      name: 'other',
      provider: 'ollama',
      model: 'fixture-two',
      is_local: true,
    });
    core.settings.set('default_strand_id', second.id);
    assert.equal(resolveDefaultStrand(core).id, second.id);
    assert.equal(resolveDefaultStrand(core, { default: ['local'] }).id, strand.id);
    const knot = {
      version: '0.1.0',
      name: 'writer',
      display_name: 'Writer',
      description: 'Writes release reports',
      instructions: 'Read and write a report.',
      tools: ['list_files', 'read_file', 'create_file'],
    };
    const auditor = { ...knot, name: 'auditor', description: 'Audits folders' };
    const planner = {
      sendMessageSync: async () => ({
        content: JSON.stringify({ knotName: 'writer', reason: 'Matches release reporting.' }),
      }),
    };
    assert.equal(
      (await selectKnot('Write release notes', [knot, auditor], strand, planner)).knotName,
      'writer',
    );
    await assert.rejects(
      selectKnot('Task', [knot], strand, {
        sendMessageSync: async () => ({ content: '{"knotName":"invented","reason":"invent"}' }),
      }),
      /outside/,
    );
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function until(check) {
      for (let i = 0; i < 300; i++) {
        const value = check();
        if (value) return value;
        await sleep(10);
      }
      throw new Error('timeout');
    }
    const terminal = (id) =>
      until(() => {
        const run = core.runs.getById(id);
        return ['failed', 'completed', 'cancelled'].includes(run.status) && run;
      });
    function scripted(filename) {
      let turn = 0;
      return {
        async *sendMessage(request) {
          turn++;
          if (turn === 1)
            yield {
              delta: JSON.stringify({ tool: 'read_file', path: 'release.txt' }),
              is_final: true,
            };
          else if (turn === 2) {
            assert.match(request.messages.at(-1).content, /Version one/);
            yield {
              delta: JSON.stringify({
                tool: 'create_file',
                path: filename,
                content: '# Report\nVersion one improves bots.\n',
              }),
              is_final: true,
            };
          } else {
            assert.match(request.messages.at(-1).content, /verified|rejected/i);
            yield {
              delta: JSON.stringify({
                answer: request.messages.at(-1).content.includes('rejected')
                  ? 'The report was rejected.'
                  : 'Created report.',
              }),
              is_final: true,
            };
          }
        },
      };
    }
    try {
      const id = await worker.start(
        {
          knot,
          strand,
          prompt: 'Write',
          folder: input,
          outputFolder: output,
          selectionReason: 'Matches reports.',
        },
        scripted('report.md'),
      );
      const proposal = await until(() => worker.reviewedFiles.list(id)[0]);
      assert.equal(core.runs.getById(id).status, 'waiting_approval');
      await assert.rejects(access(output + '/report.md'));
      worker.reviewedFiles.decide(proposal.id, true);
      worker.reviewedFiles.decide(proposal.id, true);
      assert.equal((await terminal(id)).status, 'completed');
      assert.equal(await readFile(output + '/report.md', 'utf8'), proposal.content);
      assert.equal(worker.reviewedFiles.list(id)[0].state, 'verified');

      const deny = await worker.start(
        { knot: auditor, strand, prompt: 'Audit', folder: input, outputFolder: output },
        scripted('denied.md'),
      );
      const denied = await until(() => worker.reviewedFiles.list(deny)[0]);
      worker.reviewedFiles.decide(denied.id, false);
      assert.equal((await terminal(deny)).status, 'completed');
      assert.equal(worker.reviewedFiles.list(deny)[0].state, 'rejected');
      await assert.rejects(access(output + '/denied.md'));

      const cancelled = await worker.start(
        { knot, strand, prompt: 'Cancel', folder: input, outputFolder: output },
        scripted('cancel.md'),
      );
      const cancellation = await until(() => worker.reviewedFiles.list(cancelled)[0]);
      core.runManager.cancelRun(cancelled);
      worker.reviewedFiles.decide(cancellation.id, true);
      assert.equal(worker.reviewedFiles.list(cancelled)[0].state, 'cancelled');
      await assert.rejects(access(output + '/cancel.md'));

      const collide = await worker.start(
        { knot, strand, prompt: 'Write', folder: input, outputFolder: output },
        scripted('report.md'),
      );
      const collision = await until(() => worker.reviewedFiles.list(collide)[0]);
      worker.reviewedFiles.decide(collision.id, true);
      assert.equal((await terminal(collide)).status, 'failed');
      assert.equal(await readFile(output + '/report.md', 'utf8'), proposal.content);

      const fail = await worker.start(
        { knot: { ...knot, tools: [] }, strand, prompt: 'Fail' },
        {
          async *sendMessage() {
            throw new Error('simulated provider failure');
          },
        },
      );
      assert.equal((await terminal(fail)).status, 'failed');
      assert.match(core.runs.getById(fail).error, /simulated provider/);

      const escape = await worker.start(
        { knot, strand, prompt: 'Escape', folder: input, outputFolder: output },
        {
          async *sendMessage() {
            yield {
              delta: '{"tool":"create_file","path":"../escaped.txt","content":"no"}',
              is_final: true,
            };
          },
        },
      );
      assert.equal((await terminal(escape)).status, 'failed');
      await assert.rejects(access(directory + '/escaped.txt'));

      const restored = worker.reviewedFiles.list(id);
      assert.equal(restored[0].content, proposal.content);
      await testRouting(core, worker, input, output);
      await testTeaching(core, worker);
      await testDurable(directory + '/durable');
      await testPlans(directory + '/plans');
      console.log(
        'PASS: saved-knot planning, defaults/override, two bots, exact approved file, duplicate approval, rejection, cancellation, collision, provider failure, path scope, persisted proposals.',
      );
    } finally {
      core.close();
      await rm(directory, { recursive: true, force: true });
      app.quit();
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
