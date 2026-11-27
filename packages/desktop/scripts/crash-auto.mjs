// Test-only subprocess: the parent kills it while one automatic specialist is unfinished.
import { app } from 'electron';
import { writeFile } from 'node:fs/promises';
const directory = process.argv[2];
app.setPath('userData', directory + '/electron');
void app
  .whenReady()
  .then(async () => {
    const { createCore, KnotWorker, startAutoChat } = await import('@knots/core');
    const core = createCore(directory),
      worker = new KnotWorker(core, { concurrency: 2 });
    const strand = core.strands.create({
      name: 'fixture',
      provider: 'ollama',
      model: 'fixture',
      is_local: true,
    });
    const resolver = async () => ({
      async *sendMessage(request) {
        if (request.system.includes('assemble 1 focused agent'))
          yield {
            delta: JSON.stringify({
              title: 'Crash recovery',
              strategy: 'Two tasks',
              agents: [
                {
                  id: 'fast',
                  name: 'Fast',
                  instructions: 'Research fast',
                  task: 'Fast contribution',
                  expectedOutput: 'Fast result',
                },
                {
                  id: 'slow',
                  name: 'Slow',
                  instructions: 'Research slow',
                  task: 'Slow contribution',
                  expectedOutput: 'Slow result',
                },
              ],
            }),
            is_final: true,
          };
        else if (request.system.includes('Research fast'))
          yield { delta: '{"answer":"Fast result"}', is_final: true };
        else await new Promise(() => {});
      },
    });
    const task = await startAutoChat(core, worker, resolver, {
      prompt: 'Recover this team',
      strand,
      folder: directory + '/input',
    });
    const timer = setInterval(async () => {
      const plan = core.database
        .getDb()
        .prepare('SELECT id FROM task_plans WHERE draft_run_id=?')
        .get(task.runId);
      if (!plan) return;
      const children = core.database
        .getDb()
        .prepare('SELECT run_id FROM plan_tasks WHERE plan_id=? ORDER BY rowid')
        .all(plan.id);
      if (children.length !== 2 || children.some((c) => !c.run_id)) return;
      if (
        core.runs.getById(children[0].run_id).status === 'completed' &&
        core.runs.getById(children[1].run_id).status === 'running'
      ) {
        clearInterval(timer);
        await writeFile(
          directory + '/ready.json',
          JSON.stringify({ id: task.runId, children: children.map((c) => c.run_id) }),
        );
      }
    }, 10);
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
