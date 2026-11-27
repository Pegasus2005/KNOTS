# Understanding KNOTS

A guide for someone encountering the project for the first time.

Last reviewed: 27 November 2026. This describes main after all five bot-creation/improvement milestones, automatic-team recovery/accounting and the Poppins frontend refinement. Release/distribution gates are listed separately.

## 1. The project in one paragraph

**KNOTS is a local-first desktop application for creating reusable AI bots, connecting them to different language models, and giving them tasks they can execute using permitted tools.** A bot defines what work to do and how to approach it; a model connection supplies the intelligence for each call. Users can either send a task directly and let KNOTS assemble temporary specialists, or describe a recurring problem and review a reusable bot created for it. The longer-term goal is for bots to become more useful through corrections, tested proposals and reviewed updates.

The tagline is **“Bind any model to any bot.”** In practice, “any” means a compatible model reachable through a supported adapter, subject to the bot's requirements and data policy.

## 2. The problem it addresses

People repeatedly describe the same role, format, context and preferences to AI tools. Their workflows become tied to one provider, while actions on local files or connected services need more control than a chat answer provides.

KNOTS separates:

- The reusable definition of the work.
- The model connection used to reason about it.
- The tools and access required to act.
- The execution record, approvals and results.

A reporting bot can retain its purpose when a user changes models. A task can use different eligible models at different stages. A proposed file write remains a reviewed action rather than an assertion in a chat response.

## 3. Vocabulary

| Term                 | Meaning                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Knot / bot           | A saved definition containing instructions, purpose, expected output and optional tools/model policies.                       |
| Strand               | A named connection to a provider, model and optional endpoint, with credential references and routing settings.               |
| Lane                 | An ordered preference for model connections at a stage of work.                                                               |
| Run                  | One execution with input, status, output, model receipts and possible actions.                                                |
| Worker job           | A durable queued execution with a checkpoint and lifecycle controls.                                                          |
| Conversation         | A persisted series of user tasks and completed responses.                                                                     |
| Automatic specialist | A generated task-specific agent used for the current request; it is not automatically a saved library bot.                    |
| Plan                 | A collection of bot tasks. Reviewed plans have explicit dependencies; automatic chat currently creates parallel specialists.  |
| Grant                | User-selected folder access for execution. A saved filesystem path alone is not a grant.                                      |
| Approval             | A decision allowing a particular proposed file or MCP action.                                                                 |
| Memory               | A local, retrievable entry derived from a conversation or saved explicitly. Memory can be wrong and is not proof of learning. |
| Teaching proposal    | A proposed instruction change based on a corrected run, with review and revert support.                                       |

## 4. Who can use it, and for what?

The current app is suitable for people experimenting with repeatable text work, analysis of authorized text files, drafting reports and model-independent bots. Developers can also connect supported MCP services.

Examples include a release-note writer, a folder-audit report bot, a writing assistant or a reviewer working from supplied text. These are examples of roles, not hardcoded product categories.

The earlier PDF-organizer idea illustrates the ambition of autonomous local work. The current built-in tools do not parse PDFs, move files, delete files or reorganize a laptop. That use case requires additional tools and action semantics.

## 5. Current user journey: first-time setup

1. Install development dependencies and start the Electron application, or use a separately verified desktop build.
2. Open **Connections**.
3. Add a named strand with provider, model, endpoint where applicable, and credentials if required.
4. Test the connection. A configured connection is not proof the provider is reachable or the model is installed.
5. Choose light or dark mode. The preference is saved locally and shared between the chat and Bot Studio pages.
6. Start a chat, or open **Bot Studio** to create a reusable bot.

Using cloud models sends eligible task content to that provider and can incur charges. Local-first describes where workspace state lives; it does not mean every computation is offline.

## 6. Current user journey: send a task directly

1. Start a new chat and describe the task.
2. Optionally select a model override and grant input/output folders.
3. KNOTS asks a model to propose one specialist for a simple request or several specialists for a complex request, up to twelve.
4. A simple text-only request can execute directly. Other requests enqueue specialist jobs through the worker.
5. File creation requires review of the exact destination and contents before execution.
6. When specialists finish successfully, KNOTS returns their answer directly or synthesizes a combined response.
7. The conversation is retained. A compact excerpt of a nontrivial completed exchange can be captured in workspace memory and retrieved in later chats.
8. The user can rename or delete the chat. **Deleting a chat retains its captured workspace memory**; use Bot Studio → Memory to forget entries separately.

The automatic specialists are temporary task definitions stored with the execution. They do not automatically become reusable knots.

### Automatic-task recovery and budgets

The parent persists its plan, context, child task identities and completed response stages. After restart, tasks are held for review and require renewed folder access. Resume reuses completed specialists and verified actions. Interrupted model calls may be retried and charged again; the app does not promise exactly-once provider billing. Changing a source connection blocks automatic resume until the task is inspected.

The composer exposes an optional shared spending budget and a model-call limit (default 60). Parent and specialist calls reserve against the same group before dispatch. Combined receipts show reported tokens, known cost and partly unknown cost. Actual reported usage can exceed an estimate; subsequent actions stop if the cap is exceeded. A provider invoice can differ from application estimates.

## 7. Current user journey: create a reusable bot from a problem

1. Open **Bot Studio → Create** and describe a problem.
2. Choose local-only processing or allow cloud processing. Save the problem locally; a model is not needed merely to retain the draft.
3. KNOTS suggests potentially relevant saved bots using simple text matching and explains the matching terms. The user decides whether to reuse one.
4. Choose **Generate / refine draft** when a suitable model is connected.
5. Review the proposed name, purpose, instructions, output, success criteria, assumptions, essential questions and capability gaps.
6. Supply clarification and regenerate, or edit the draft. Unsupported tools must remain visible as gaps rather than being promised as available.
7. Resolve questions and gaps before activation. Keeping an unfinished edited draft is allowed.
8. Choose **Save reusable bot**. Saving creates no folder grant or action approval.
9. Grant required input/output access and choose **Run original task**.
10. The task enters the normal worker and the result opens in chat. Repeated activation requests reuse the same first-run identity instead of enqueueing duplicate work.

The creation review currently supports built-in text-file requirements. MCP allowlists and advanced policies are not generated automatically. The validated definition deliberately excludes hidden generated credentials, endpoints, routing rules and grants.

Saved bots can be suggested for another problem. The old manual Knots, Plans and Activity screens removed by ALT remain removed; Bot Studio provides the new creation entry point. Some older backend capabilities listed below do not yet have replacement controls in the simplified frontend.

## 8. Feature inventory and availability

| Feature                              | Current implementation / access                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic chat specialists           | Available in Chat; generated roles, parallel child jobs and result synthesis.                                                                                                                                     |
| Reusable bot creation from a problem | Available in Bot Studio; persisted draft, review, reuse suggestion and first run.                                                                                                                                 |
| Light and dark appearance            | Available across Chat, Connections and Bot Studio; saved locally.                                                                                                                                                 |
| Connections and model routing        | Available; supported adapters, explicit pins, inspect/deliver routing and receipts.                                                                                                                               |
| Local file actions                   | Granted text-file list/read; reviewed create-only output. No overwrite, move, delete or shell.                                                                                                                    |
| Durable execution                    | Worker queue, checkpoints, pause/resume, questions and explicit restart recovery for worker jobs. Automatic parents also persist stages and child bindings; review and renewed access are required after restart. |
| Cross-chat memory                    | Automatic compact exchange capture, relevance retrieval and privacy filtering. Inspect/forget in Bot Studio.                                                                                                      |
| Portable context                     | Deterministic clipping/compaction to fit configured windows; older details can be lost.                                                                                                                           |
| Peer messages                        | Persisted plan message board with size/count limits; receiving bots retain local-only restrictions.                                                                                                               |
| MCP                                  | Connection configuration in Connections; core allowlists, schema validation and approval per call. Automatic specialist creation currently provisions built-in file tools, not arbitrary MCP integrations.        |
| Reviewed dependency plans            | Implemented backend, validation and scheduler; legacy Plans screen removed. Automatic chat uses parallel tasks without a dependency DAG.                                                                          |
| Local knowledge references           | Implemented backend for bounded UTF-8 attachments and lexical retrieval; old management UI removed.                                                                                                               |
| Portable bot import/export           | Implemented backend for reviewed JSON packages; old management UI removed. Packages do not include credentials or grants.                                                                                         |
| Teach this knot                      | Available in Studio → Improve: source-linked corrections or opt-in analysis, deferred proposals, held-out comparisons, gated acceptance and revert.                                                               |
| Evaluation suites                    | Studio → Evaluate: up to five approved cases, immutable revisions, assertions and human assessments.                                                                                                              |
| Playbooks and procedures             | Studio → Playbooks: scoped guidance, explicit revisions, virtual-file verification and reviewed portable entries.                                                                                                 |
| Model auditions                      | Studio → Model auditions: up to three selected models, comparable cases and reviewed routing preferences.                                                                                                         |
| Quick bar                            | Existing global shortcut/tray entry backed by the same desktop runtime.                                                                                                                                           |
| General computer control             | Not implemented. No arbitrary shell, browser automation or full filesystem access.                                                                                                                                |
| Automatic verified self-improvement  | Reviewed instruction proposals and measured comparisons are available; adoption is explicit, not autonomous.                                                                                                      |

## 9. How model selection works

A bot does not embed a provider-specific model. It carries instructions and optional preferences, policies and lane names. A strand supplies a provider/model connection.

For desktop worker calls, the router:

1. Determines the inspect or deliver stage and ordered candidate connections.
2. Checks local-only privacy, provider/model rules, capability requirements, configured context and budget constraints.
3. Selects an eligible connection and records the reason.
4. Preserves task observations across model changes, compacting text where necessary.
5. On supported provider failures, tries an eligible fallback for the failed model call. It does not automatically repeat a verified tool action.

An explicit model override remains subject to eligibility rules. Studio → Model auditions compares up to three selected eligible strands against the same approved cases. Users assess quality and choose cost, quality or elapsed-time priority before applying a recommendation to inspect/deliver lanes. Old evidence becomes stale when the bot, connection or suite lineage changes. Run elapsed time includes queueing and is not a controlled provider-latency benchmark. There is no guarantee of globally optimal selection. Automatic tasks provide a shared call/spending budget and combined receipts.

## 10. Tools, permissions and background work

The model proposes tool actions. The runtime validates and executes them. A prompt cannot grant itself access.

- Built-in file tools handle text up to 64 KB within granted directories.
- File output is create-only, uses exclusive creation and is read back for hash verification.
- MCP supports named Streamable HTTP servers, explicit per-bot allowlists and approval before each call. Local-only restrictions also constrain remote tools.
- Pending decisions and action outcomes are persisted.
- An uncertain external effect requires reconciliation, not blind retry.
- Recovered worker jobs remain held for review; native folder access must be renewed.
- Closing the window leaves the application running. Quitting or shutting down the machine stops computation. There is no hosted service continuing work while the laptop is off.
- The desktop currently has eight worker slots. Parent model calls use the existing router outside the child-worker queue; all automatic-task calls share a persisted budget group.

Memory is currently captured automatically for eligible task runs. It stores abbreviated exchanges, not independently checked facts. User content, model responses, retrieved text and imported bots should be treated as untrusted data.

## 11. Current learning and improvement journeys

The implemented reviewed loop is:

**Describe a problem → create/reuse a bot → run → correct or assess → propose a bounded change → evaluate → review/adopt → retain rollback.**

This improves the bot's instructions or supporting context. It does not retrain a provider model, invent new tools or silently expand access.

### Evaluate a bot

Open **Evaluate**, choose a bot and enter up to five reviewed cases using the case editor. Mark each case as improvement or held-out validation, write its success criterion, and optionally require phrases, exact output or valid JSON. Source-linked cases inherit the source restrictions. Saving a revised suite creates an immutable new version.

Choose a model and batch budget. Text replays have no tools, references, cross-chat memory or playbook retrieval. Results retain definition/connection snapshots, receipts and deterministic checks. Assess completed outputs as pass, fail or unsure. Automated checks alone are not a subjective quality judgment. Cancel retains partial results; incomplete enqueue can be retried with stable job identities.

### Improve a bot

Open **Improve**, select a completed reusable-bot task, enter a correction and improvement goal, or explicitly opt into model analysis of that selected run. Analysis runs in the worker with a budget. It is a hypothesis and does not see saved held-out cases.

Review the current/proposed instructions, defer or reject the proposal, or compare it on an approved suite with held-out cases. The correction source cannot itself be held-out evidence. Acceptance requires completed before/after results, human assessments and passing candidate results. Stale definitions block adoption. Acceptance retains version backups; revert preserves unrelated current settings.

### Retain lessons and procedures

Open **Playbooks** to save a preference, lesson or procedure for a bot. Use scope keywords, or `*` for every task of that bot. Entries have source provenance, versions and explicit enable/disable/forget controls. Conflicting active entries require revision or disabling. A bounded set of relevant guidance enters task checkpoints; its source policies remain authoritative.

Procedure steps can be tested against isolated virtual text files with exact expected outputs. This deterministic simulation cannot access live files, networks or external integrations, and does not establish real-world workflow quality. Unsupported tools remain unevaluated. Guidance never carries grants or action approvals.

Selected playbook exports contain guidance only and require content review. Imports start disabled, untrusted and local-only. Forgetting prevents future retrieval; earlier checkpoints still retain their execution evidence.

### Choose models from evidence

Open **Model auditions**, select an approved suite, two or three models and a batch budget. Assess each result, review the separate quality/cost/elapsed metrics and request a recommendation. Only fully reviewed passing candidates qualify. Applying the reviewed preference changes selected lanes; all runtime privacy/capability checks continue to apply.

See [the full plan](BOT-CREATION-AND-IMPROVEMENT-PLAN.md) for the acceptance scope. Passing saved cases does not guarantee future performance or retrain the underlying model.

## 12. Architecture

```mermaid
flowchart TD
  UI[Electron renderer: Chat, Connections, Bot Studio] --> PRE[Sandboxed preload bridge]
  PRE --> IPC[Main-process IPC handlers]
  IPC --> LAB[Evaluation, improvement inbox and model auditions]
  LAB --> WORKER
  IPC --> PLAYBOOK[Scoped playbooks and virtual procedure tests]
  WORKER --> PLAYBOOK
  IPC --> CREATE[Bot drafting and review]
  IPC --> AUTO[Automatic specialist coordinator]
  CREATE --> LIB[Validated knot library]
  CREATE --> WORKER[Durable worker queue]
  AUTO --> WORKER
  AUTO --> ROUTER[Model router]
  WORKER --> ROUTER
  ROUTER --> PROVIDERS[Local and cloud provider adapters]
  WORKER --> TOOLS[Validated tools and action approvals]
  TOOLS --> FILES[Granted local files]
  TOOLS --> MCP[MCP services]
  IPC --> DB[SQLite workspace]
  WORKER --> DB
  AUTO --> DB
  IPC --> MEMORY[Workspace memory]
  MEMORY --> DB
  ROUTER --> VAULT[Credential resolution]
```

The renderer cannot access Node.js or the filesystem directly. It calls a fixed preload API; main-process handlers enforce application checks. The core owns domain behavior and persistence. Provider adapters normalize model interactions. Tool execution is distinct from text generation.

## 13. Technology stack

| Area            | Technology                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language/build  | TypeScript, ECMAScript modules, npm workspaces, `tsc`.                                                                                                                             |
| Desktop         | Electron 43.8.13; isolated/sandboxed renderers and IPC.                                                                                                                            |
| Frontend        | Plain HTML, CSS and JavaScript. No React dependency. Locally bundled Poppins (400/500/600), shared responsive components and saved light/dark appearance.                          |
| Persistence     | SQLite through better-sqlite3, versioned migrations and private pre-migration backups.                                                                                             |
| Bot definitions | YAML through js-yaml; JSON Schema validation through AJV.                                                                                                                          |
| Model adapters  | Ollama, OpenAI, Anthropic, Google, OpenRouter and OpenAI-compatible endpoints. Provider SDKs plus adapter-specific transport.                                                      |
| Integrations    | Official MCP client and Streamable HTTP transport.                                                                                                                                 |
| Credentials     | Optional OS keychain through keytar, encrypted-file fallback and supported provider environment variables. The fallback is not equivalent to an independent hardware-backed vault. |
| CLI             | Commander, Inquirer, Chalk and Ora.                                                                                                                                                |
| Packaging       | electron-builder, native dependency rebuilding, unsigned packaging and packaged-startup smoke tooling.                                                                             |
| Verification    | TypeScript build, JavaScript/source integrity checks and Electron integration tests with temporary fixtures.                                                                       |
| CI              | GitHub Actions verification and platform build workflows; see RELEASE.md for actually verified targets.                                                                            |

There is no required hosted application backend, account system, subscription service, embedding database or training pipeline.

## 14. Repository map

```text
packages/
  types/       Shared contracts for knots, strands, models and run records
  core/        Knot library, SQLite, routing, worker, tools, memory and teaching
  providers/   Provider/model adapters
  desktop/     Electron main process, preload bridge, renderer and runtime tests
  cli/         Terminal entry points
knots/         Bundled example bot definitions
references/    Design references
scripts/       Workspace checks and supporting tooling
.github/       CI and release workflows
```

Useful implementation entry points:

- `packages/core/src/bot-creation.ts`: persisted problem drafts and reviewed activation.
- `packages/core/src/run/auto-agents.ts`: temporary specialist provisioning and synthesis.
- `packages/core/src/run/worker.ts`: queueing, checkpoint execution and action lifecycle.
- `packages/core/src/routing/router.ts`: eligible model selection and receipts.
- `packages/core/src/memory.ts`: cross-chat entries and context compaction.
- `packages/core/src/teaching.ts`: existing corrected-run proposals and replay comparisons.
- `packages/desktop/src/main/ipc-handlers.ts`: main-process application API.
- `packages/desktop/src/renderer/dashboard/`: chat, studio and shared styling.

## 15. Local data and portability

The default workspace is `~/.knots`; override it with `KNOTS_DATA_DIR`. It contains the SQLite database, bot definitions and supporting managed assets. Library updates can retain versioned YAML backups. Run records preserve definition snapshots needed to understand prior work.

A strand stores connection metadata and a credential reference; secrets are resolved separately. Supported cloud environment variables include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY` and `OPENROUTER_API_KEY`.

Portable packages contain bot definitions and validated reference assets, not provider credentials, endpoints or access grants. A recipient must configure connections and review the bot. Do not assume all local data is encrypted: ordinary workspace content is stored locally with filesystem protections, not whole-workspace encryption.

## 16. Start developing

Use Node.js 24 LTS (minimum 22.12), npm and your platform's native build tools.

```bash
npm ci
npm run verify
npm run rebuild:native -w @knots/desktop
npm run start -w @knots/desktop
```

After relevant implementation changes:

```bash
npm run verify
npm run test:runtime -w @knots/desktop
```

The native SQLite build must match the executing runtime. Switching between regular Node and Electron may require rebuilding the native module for the appropriate runtime.

The normal runtime suite uses synthetic providers, temporary workspaces and local fixtures. It is not evidence that every live provider account works. Live-provider verification is a separate opt-in path and can incur charges. Electron tests also need an environment that permits launching a desktop process.

For unsigned packaging and release checks, follow RELEASE.md rather than treating a successful TypeScript build as a shipped release.

## 17. Current boundaries and next work

All five current feature milestones are implemented: reviewed creation, reusable evaluation cases, the improvement inbox, scoped playbooks/virtual procedures and model auditions. Automatic teams also support checkpoint recovery, shared budgets and aggregate receipts. Some older backend features still lack replacement frontend controls. Broader local automation, arbitrary tools and guaranteed autonomous learning are outside the completed scope.

The project is a working desktop application with a completed bounded feature roadmap. Signing/notarization, live-provider accounts and native platform walkthroughs remain distinct distribution gates. Earlier release artifacts do not include new source changes until rebuilt and verified.

## 18. Which document should I read next?

- [README.md](README.md): concise project entry point and commands. Older feature walkthroughs may describe removed screens; this guide explains the current simplified frontend.
- [BOT-CREATION-AND-IMPROVEMENT-PLAN.md](BOT-CREATION-AND-IMPROVEMENT-PLAN.md): next product milestones and acceptance criteria.
- [IMPLEMENTATION.md](IMPLEMENTATION.md): historical implementation decisions and completed work.
- [NEXT-STEPS.md](NEXT-STEPS.md): research and previous roadmap notes; some entries are historical.
- [KNOTS-Architecture.md](KNOTS-Architecture.md): earlier architecture design; check source and this guide for current details.
- [RELEASE.md](RELEASE.md): release checks, evidence and remaining distribution gates.

When changing behavior, update this guide's implemented/planned distinctions and the relevant README walkthrough. Do not describe a proposed capability as available merely because its tab, type or research reference exists.

## 19. How to test the completed application

### Automated regression pass

From the repository root, use Node.js 24 LTS and run:

```bash
npm ci
npm run verify
npm run rebuild:native -w @knots/desktop
npm run test:runtime -w @knots/desktop
npm run test:interface -w @knots/desktop
npm audit --audit-level=moderate
```

Expect exit code zero and PASS messages through the final renderer and runtime summaries. `test:runtime` includes temporary SQLite workspaces, synthetic model responses, local HTTP/MCP fixtures and deliberately killed subprocesses. It does not need provider API keys or paid model calls. `test:interface` checks saved UI forms, light/dark rendering, the connection dialog and six Studio tabs at 1280/1024/800/680 pixels. Closed advanced panels are excluded from visible-control collision checks. These checks do not substitute for manual native acceptance.

`npm ci`/native rebuilds install and execute dependencies. The tests use disposable workspaces rather than your normal bot library. Runtime checks require an environment that can launch Electron; use the existing CI/Xvfb configuration for headless Linux.

### Start an isolated manual session on macOS/Linux

Fully quit any running KNOTS instance first; closing its window leaves it running. Then:

```bash
KNOTS_DATA_DIR="$(mktemp -d /tmp/knots-manual.XXXXXX)" npm run start -w @knots/desktop
```

This keeps test runs and bot files out of your normal workspace. Use distinctive strand names such as `manual-local-a`: OS keychain references can still be shared across workspaces. For a model-free start, inspect the interface and save a problem draft before configuring a strand. Running a real task needs your local model or provider account; cloud tests can incur charges.

Create two small throwaway folders: one with a UTF-8 `notes.txt`, and one empty folder for reviewed outputs. Do not use valuable documents for acceptance testing.

### Manual acceptance checklist

| Flow                             | What to do                                                                                                                                                                                                    | Expected result                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance and layout            | Toggle both themes, reopen the app, resize wide/narrow, open Connections and its model dialog.                                                                                                                | Poppins and the saved theme appear; controls remain aligned, readable, scrollable and unobstructed.                                                                          |
| Connections                      | Add and test a local strand; optionally add a second eligible model. Use a deliberately incorrect model once.                                                                                                 | Successful models respond; invalid connections show a clear error. Credentials are not displayed in task output.                                                             |
| Problem draft                    | Save a problem without generating it. Reopen Studio. Generate once a model is connected.                                                                                                                      | The problem survives; a structured bot review appears.                                                                                                                       |
| Clarification and capability gap | Ask for an underspecified task or an unsupported shell/PDF action.                                                                                                                                            | Essential questions/gaps are visible and block activation until resolved; no unsupported action is promised as available.                                                    |
| Reusable bot                     | Review instructions, output and success criteria. Save, then run the original task. Reopen the first-run action.                                                                                              | One saved bot and one first-run identity; opening it again does not duplicate execution. Follow-up chat retains the saved bot.                                               |
| Reuse                            | Describe a related problem in a new Studio draft.                                                                                                                                                             | A relevant saved bot can be suggested with matching terms; reuse is your decision.                                                                                           |
| File approval                    | Grant only the test folders. Ask a file-enabled bot for a new Markdown report. Reject once, then approve a new proposal. Try an existing destination.                                                         | No file before approval or after rejection. Approval creates exactly the reviewed text; an existing file is not overwritten.                                                 |
| Evaluation                       | Save improvement and distinct held-out cases. Add a required phrase that should pass and one that should fail. Run and assess results.                                                                        | Immutable cases, separate checks and human grades, correct failures, visible outputs and receipts. No tool actions occur during evaluation.                                  |
| Improvement                      | Correct a completed saved-bot task. Generate a proposal. Try accepting before evaluation. Compare it on a suite with a held-out case, assess both versions, then accept or reject. Revert an accepted change. | Premature or regressing adoption is blocked. Instructions change only after review; revert restores them. A changed bot makes an open proposal stale.                        |
| Playbooks                        | Add a scoped lesson, try a conflicting active lesson, explicitly revise it, disable and forget it.                                                                                                            | Relevant tasks can retrieve enabled guidance; unrelated scopes do not. Conflicts need resolution. Forget prevents future retrieval, while older checkpoints retain evidence. |
| Procedure fixture                | Define supported text-file steps and exact expected fixture output. Test missing input and an existing output.                                                                                                | Virtual-file checks pass/fail honestly. No real filesystem or network effects occur.                                                                                         |
| Portable guidance                | Export a selected entry, inspect the text, and import it into a test bot.                                                                                                                                     | Imported guidance starts disabled, untrusted and local-only; no grants or credentials appear.                                                                                |
| Model audition                   | Use two eligible strands and the same suite. Assess every output. Review a quality/cost/elapsed-time recommendation, then apply it.                                                                           | Only reviewed passing models qualify. Changing the bot, model configuration or suite lineage makes evidence stale. Privacy remains enforced.                                 |
| Privacy                          | Use a local-only bot/source and try a cloud strand for evaluation.                                                                                                                                            | The request is blocked before model dispatch. Do not loosen source policies merely to get a test through.                                                                    |
| Budget and stop                  | Set a very small task budget with known pricing, or a one-call limit. Run an automatic task, then use Stop all work on another.                                                                               | Limits stop additional calls/actions; combined receipts show reservations and unknown costs honestly. Stop cancels unfinished work; Enable dispatch does not revive it.      |
| Background and restart           | Close/reopen the window during work. Separately, quit/restart while a task awaits approval, renew the original folders and resume.                                                                            | Window close retains work. App restart holds work for review. Completed specialists and verified actions are reused; approvals/access are renewed where required.            |
| Chat and memory                  | Rename a chat, delete a test chat, then inspect and forget its captured memory.                                                                                                                               | Rename does not reorder by itself; deleting chat retains memory, and forgetting it stops future retrieval.                                                                   |

For model auditions, two local models avoid cloud API costs. If testing cloud models, use a cloud-allowed bot and cases, configure prices, and explicitly accept provider charges. End-to-end elapsed time includes queueing and is not a pure model-latency benchmark.

The old dependency-plan, knowledge-package and MCP action paths are covered by automated backend integration checks. Their removed legacy screens are not part of the current manual UI checklist. MCP connection setup is visible, but automatic bot creation does not currently provision arbitrary MCP allowlists.

### Packaged application

To check a fresh unsigned bundle locally on macOS:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:dir -w @knots/desktop
npm run smoke:packaged -w @knots/desktop
```

The smoke check launches the real bundle with temporary data and expects `"smoke":"passed"`. It does not test a signed installer or clean-machine upgrade. For installer/signing/native-platform gates and optional live-provider connectivity, follow RELEASE.md.

If something fails, record the command or screen, expected/actual behavior, run ID, error text, OS/architecture and whether the provider was synthetic/local/cloud. Share screenshots or sanitized logs without API keys or private task content. Keep the failing workspace for diagnosis instead of deleting or resetting it immediately.
