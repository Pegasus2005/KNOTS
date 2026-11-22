// Isolated subprocess used only by test-durable.mjs; the parent deliberately kills it.
import { app } from 'electron';
import { writeFile } from 'node:fs/promises';
const directory = process.argv[2];
const mode = process.argv[3];
app.setPath('userData', directory + '/electron');
void app
  .whenReady()
  .then(async () => {
    const { createCore, KnotWorker } = await import('@knots/core');
    const core = createCore(directory);
    const worker = new KnotWorker(core, { concurrency: 1 });
    const strand = core.strands.create({
      name: 'crash-model',
      provider: 'ollama',
      model: 'fixture',
      is_local: true,
    });
    const knot = {
      version: '0.1.0',
      name: 'crash-bot',
      instructions: 'Read the notes and produce report.md.',
      tools: ['read_file', 'create_file'],
      model_preferences: { privacy: 'local_only' },
    };
    core.knots.save(knot);
    const apply = worker.reviewedFiles.apply.bind(worker.reviewedFiles);
    worker.reviewedFiles.apply = async (run, directory, root, id) => {
      if (mode === 'verified') await apply(run, directory, root, id);
      else {
        core.database
          .getDb()
          .prepare("UPDATE file_proposals SET state = 'writing' WHERE id = ?")
          .run(id);
        if (mode === 'partial') await writeFile(root + '/report.md', 'partial');
      }
      await writeFile(
        core.dataDir + '/ready.json',
        JSON.stringify({ runId: run.runId, proposalId: id }),
      );
      await new Promise(() => {}); // Crash after write persistence, before observation checkpoint.
    };
    const runId = await worker.start(
      {
        knot,
        strand,
        prompt: 'Create the report.',
        folder: directory + '/input',
        outputFolder: directory + '/output',
      },
      {
        async *sendMessage(request) {
          const count = request.messages.filter((message) => message.role === 'assistant').length;
          yield {
            delta:
              count === 0
                ? '{"tool":"read_file","path":"notes.txt"}'
                : '{"tool":"create_file","path":"report.md","content":"reviewed report"}',
            is_final: true,
          };
        },
      },
    );
    if (mode === 'verified') {
      const timer = setInterval(() => {
        const proposal = worker.reviewedFiles.list(runId).find((item) => item.state === 'pending');
        if (proposal) {
          clearInterval(timer);
          worker.reviewedFiles.decide(proposal.id, true);
        }
      }, 5);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
