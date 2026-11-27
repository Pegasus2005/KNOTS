# KNOTS

**Bind any model to any bot.**

KNOTS is a local-first desktop workspace for model-independent AI bots. Send a task and let it assemble specialists, or describe a recurring problem and review a reusable bot. The runtime routes eligible model calls, executes permitted tools and retains work locally.

**New here? Read [understanding.md](understanding.md)** for the product idea, terminology, complete user journeys, feature availability, architecture, tech stack and limitations.

## Current experience

- **Chat:** automatic task-specific specialists, parallel worker jobs and result synthesis; persisted conversations with rename/delete controls.
- **Connections:** local and cloud model strands, explicit overrides and model-call routing with policy checks.
- **Bot Studio → Create:** saved problem drafts, matching saved bots, generated definitions, editable review, essential questions, capability gaps, success criteria and one-time first-run activation.
- **Bot Studio → Evaluate:** approved versioned text cases, improvement/holdout splits, budgeted comparisons, deterministic checks and human assessments.
- **Bot Studio → Memory:** inspect and forget cross-chat memory. Deleting a chat retains its captured memories.
- **Light and dark modes:** soft gradients, rounded suggestion cards and a locally saved appearance preference across both pages.
- **Bounded tools:** granted text-file reading, exact-content approval for create-only output, and the existing reviewed MCP runtime.
- **Durable worker:** queue, checkpoints, pause/resume, saved questions and explicit restart recovery with renewed folder access.

ALT's legacy manual bot, teaching, plan and activity screens remain removed. Their backend implementations are retained where used by the runtime; new improvement, playbook and model-audition screens remain planned. Bot Studio replaces the problem-to-bot entry point.

## Start locally

Use Node.js 24 LTS (minimum 22.12), npm and native build tools.

```bash
npm ci
npm run verify
npm run rebuild:native -w @knots/desktop
npm run start -w @knots/desktop
```

The default data directory is `~/.knots`; override it with `KNOTS_DATA_DIR`. Native SQLite must be built for the runtime executing it; switching between Electron and Node may require a native rebuild.

1. Open **Connections**, add a strand and test it. Supported adapters include Ollama, OpenAI, Anthropic, Google, OpenRouter and OpenAI-compatible endpoints.
2. Send a task in **Chat**, or open **Bot Studio → Create** and save your problem.
3. Generate a bot draft, review its instructions/output/access requirements, and resolve essential questions or unsupported capability gaps.
4. Save the reusable bot. Grant folders separately if needed, then run the original task.
5. Review file proposals before approval. Continue the resulting conversation with the saved bot.

A saved problem survives without a configured model. Draft generation and execution require an eligible connection. Saving a bot does not grant access. Concurrent first-run activation requests reuse one worker job.

## Execution and limits

A **knot** is a reusable bot definition; a **strand** is a model connection; a **run** is one execution. Automatic chat specialists are temporary task definitions, not automatically saved library bots.

Routing checks privacy, provider/model/capability rules, configured context and estimated budgets before dispatch. It supports inspect/deliver stages and eligible failure-only fallback. Each model call retains a receipt. Unknown prices stay unknown; configured estimates are not a billing guarantee.

Built-in file tools handle text up to 64 KB. Output is create-only and hash-verified. Existing-file editing, deletion, PDF organization, shell execution and browser automation are not implemented. MCP tools need declared allowlists and approval for each call; automatic specialist creation does not provision arbitrary integrations.

The desktop has eight worker slots and can generate up to twelve specialists per automatic task. Peer messaging is bounded. Worker jobs are checkpointed, but automatic parent provisioning/waiting/synthesis is still an in-memory coordinator. Full automatic-team restart recovery, a shared task budget and aggregate parent cost reporting remain open.

Closing the window leaves the application running. Quitting or powering off the machine stops computation. Recovered worker jobs require explicit review and renewed native folder access. Unknown external effects require reconciliation rather than automatic replay.

Context compaction and automatic memory capture use bounded text excerpts; they can lose details and preserve incorrect model statements. Memory capture is not verified self-improvement. The existing teaching backend supports reviewed instruction changes, but the new improvement inbox remains a future milestone.

Workspace records and bot definitions are local. Cloud models and remote integrations receive eligible content under the applicable policy. Credentials use an available OS keychain with an encrypted local fallback; ordinary workspace content is not wholly encrypted. Schema upgrades create private consistent SQLite backups and reject newer schemas rather than downgrade them.

**Status:** development build. The current changes do not rebuild or reverify older release artifacts. Signing/notarization, live accounts and native platform walkthroughs remain distribution gates in [RELEASE.md](RELEASE.md).

## Development and verification

```bash
npm run verify
npm run rebuild:native -w @knots/desktop
npm run test:runtime -w @knots/desktop
npm audit --audit-level=moderate
```

The suite exercises real SQLite/Electron execution, process-crash recovery, approvals, routing/fallback, budgets, plans, knowledge packages, teaching, conversations, migration rollback, the local MCP HTTP server and synthetic HTTP provider contracts. Synthetic contracts do not establish live account access or every provider/model combination. Live checks are explicit opt-in and send only a small connectivity prompt.

The workspace contains shared types, core execution/storage, provider adapters, CLI and Electron packages. The renderer communicates through a context-isolated preload; execution stays in the main-process worker.

## Packaging and release

```bash
npm run package:dir -w @knots/desktop
npm run smoke:packaged -w @knots/desktop
npm run dist -w @knots/desktop
npm run checksums -w @knots/desktop
```

Outputs go to `release/`. Packaging never publishes. Unsigned builds are for local verification; external distribution needs the platform/signing checks in [RELEASE.md](RELEASE.md). The GitHub workflow runs build, audit, runtime and packaged-smoke jobs across macOS, Windows and Linux once pushed. It does not publish a release.

## Project documents

- [Complete newcomer guide](understanding.md)
- [Bot creation and improvement roadmap](BOT-CREATION-AND-IMPROVEMENT-PLAN.md)
- [Architecture and journey](KNOTS-Architecture.md)
- [Product plan](KNOTS-Project-Plan.md)
- [Implementation record](IMPLEMENTATION.md)
- [Next steps](NEXT-STEPS.md)
- [Release and verification checklist](RELEASE.md)

Future work includes timer/event triggers, broader computer tools, richer retrieval and optional hosting/registry capabilities. They are outside this desktop release scope. No project distribution license has been selected in this repository.
