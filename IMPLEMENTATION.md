# Runtime implementation plan

Build a reusable execution loop around the existing knot library, strand adapters, and RunManager.

1. Add an optional read-only folder tool set to knot definitions. Grant a folder per run through a native picker. Validate real paths and limit file and response sizes.
2. Move desktop execution into a core worker. For tool-enabled knots, use a validated JSON action protocol across the existing model adapters. Run up to twelve model turns, execute permitted list/read requests, pass observations back, and return a final answer.
3. Persist tool activity and output. Keep execution in Electron's main process when the window closes and reconnect the dashboard to the active run. Explicit quit cancels work. Interrupted runs after restart are marked failed.
4. Verify two bots use the same worker and tools, reject access outside the grant, survive a window reload, and cancel provider requests. Use a mock provider for repeatable integration checks.

The initial worker uses one selected strand throughout a run. Automatic per-step routing, writing tools, knowledge indexing, and scheduling follow this runtime increment.

## Completed runtime increment

- Tool-enabled knots can list and read files inside a folder chosen for the run. The knot editor exposes this tool grant.
- A core worker executes a bounded JSON action loop through the existing adapters, saves activity and output, and supports cancellation.
- The Electron main process hosts jobs after the dashboard closes. The tray/menu can reopen the dashboard or explicitly quit. Reopening reconnects to a running job, and recent runs can be inspected.
- Startup marks interrupted desktop worker runs as failed. Automatic restart/resume remains planned.
- Verification passed on macOS with mock models for two bots using the same worker, list/read observations, path denial, cancellation, create/edit/run regression, and closing/reopening the dashboard during execution. The workspace build passed.
- Native provider tool calls, automatic model routing, writing tools, and live-provider/Windows verification remain pending. The initial tool protocol requires a model to return valid JSON actions.

## Next milestone · Create a reviewed deliverable

**Status** · Implemented and verified with mock models on macOS. The worker now supports a create-file action and persistent approval. A user-created knot can read granted input, propose a report, wait for a decision, and return the verified output path.

### User flow

1. In the knot editor, enable file creation alongside any read tools.
2. In Run, grant an input folder when needed and an output folder for the deliverable.
3. Submit a task. The worker reads the input and asks the selected model for the next action.
4. If the model proposes a file, show its exact destination and complete text with Approve and Reject controls.
5. Approval creates the file and verifies its contents. Rejection is returned to the worker as a tool outcome so the knot can explain or revise its proposal.
6. The result shows the created file and its verification status. Closing the dashboard while waiting preserves the pending action. Explicit quit interrupts execution and records that status.

### Code changes and dependency order

| Work                           | Existing location                                       | Result                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed tool definitions         | Shared types, knot schema, and a core tool module       | Validate list, read, and create-file arguments. The worker dispatches through one tool interface. Preserve existing knots and the existing JSON protocol.                                               |
| Action persistence             | SQLite migration and a core action store                | Store action ID, run ID, proposed destination, complete content, content hash, decision, execution status, error, and timestamps. Bind a decision to one saved proposal.                                |
| Approval lifecycle             | RunManager and KnotWorker                               | Enter waiting-for-approval, suspend the loop, accept a single decision, and continue with the actual tool outcome. Cancellation unblocks the waiter and prevents later execution.                       |
| Output access and execution    | Core file tools and desktop folder grants               | Validate the granted output directory and its real path. Initially create one text file in that directory with exclusive creation. Reject existing targets. Verify written bytes and record the result. |
| Dashboard integration          | IPC handlers, preload bridge, Run view, and knot editor | Select output access, inspect pending proposals after reconnecting, submit a decision, and see verified deliverables. Render proposed content as text.                                                  |
| Verification and documentation | Integration checks and README                           | Exercise the acceptance demo and failures below, then document the behavior that passed.                                                                                                                |

Create the database migration and typed action store before introducing UI approval controls. Route tool requests through the registry before adding the new write executor. Use the existing provider adapters and selected strand for this milestone. Native provider tool calling and automatic routing have their own planned integration work.

### Consistent action execution

Persist the proposal before asking for approval. Treat proposal content as immutable. Revisions get a new action ID and decision. Atomically transition a pending action to approved or rejected, and let one executor claim an approved action. A repeated approval returns the recorded state.

Recheck the target and grant immediately before execution. Use exclusive file creation and record the resulting file identity and verified hash. If a write fails after creating a partial file, retain an explicit failed or uncertain outcome for inspection. If the app exits during a write, recovery should compare persisted intent with observed state and report whether reconciliation is possible. Require explicit reconciliation before treating an uncertain file as a completed deliverable.

For this milestone, restart shows interrupted jobs and their persisted actions. Automatic continuation after a process restart remains a later capability. An approval recovered after restart must belong to a valid job with freshly established access before any execution.

### Acceptance checks

- Two independently created bots use the same tool registry to propose distinct reports.
- An approved report is created once with exactly the reviewed bytes and a verified result.
- A rejected proposal leaves its destination absent and returns rejection to the model.
- A pending proposal remains visible after dashboard close/reopen.
- Repeated approval and approval arriving after cancellation cannot create duplicate or cancelled output.
- An existing target, invalid arguments, an out-of-scope path, or changed output-directory resolution produces a visible failure.
- An app restart preserves the proposal and marks interrupted execution accurately.
- Existing model-only runs and list/read knots still work.
- The workspace build passes. Exercise actual local model behavior when a model is available, and report which platforms and providers were tested.

### Milestone reporting, commit, and README update

After verification, report the completed behavior, acceptance results, and remaining limitations, then commit the milestone. Update README current capabilities and walkthrough only after the implemented path passes. Document the output-folder grant, exact-content approval, verified file creation, background-window behavior, and restart limits. Leave automatic routing and teaching from corrected runs identified as planned.

The next product milestone after this is automatic strand selection per model call. Saved examples and reviewed bot improvements follow once runs have structured, inspectable actions and results.

## Selected ALT integration · Completed

Main now includes task-first selection of one saved knot with an explanation, a workspace default strand and per-knot preferences, persistent worker activity, and reviewed create-only file output. The existing knot library, adapters, worker, and permission grants provide the execution path.

The planner selects from saved definitions. File proposals retain exact contents, destination, hash, decision, and execution state in SQLite. A cancelled job cannot apply a late approval. Exclusive creation protects existing files, and output verification precedes a verified action result. Restart closes pending approvals and identifies interrupted writes for inspection.

The repeatable core check is available through the desktop package's test:runtime command. macOS mock-model integration also exercised the dashboard delegation, native folder grant boundary, closing/reopening during approval, and verified report result. Live-provider and Windows checks remain pending.

## Automatic worker routing · Completed

- Desktop worker calls now route through deterministic inspect/deliver stages, ordered knot/workspace lanes, model preferences, and explicit run pins.
- Before dispatch, the router checks local-only privacy, provider/model/capability rules, configured context size, and an optional estimated run budget.
- Model-call receipts persist the selected strand, stage, reason, status, usage, and configured-price cost or unknown/estimated state.
- Recoverable provider errors retry the model call on an eligible fallback with the same conversation and completed tool observations.
- The knot editor exposes stage preferences, privacy, output limits, and budgets. Connection settings expose context and prices. The run view shows routing receipts.
- Build and the macOS mock-provider runtime suite passed, including two-model tool execution, fallback after one verified write, privacy, capability/context denial, budget reservations, unknown pricing, explicit pins, cumulative usage, and settings through desktop IPC.
- Live-provider and Windows verification remain pending. CLI execution paths retain their existing selection behavior. Estimated budgets are based on configured rates and byte-based input estimates.

## Teach a knot · Completed

The desktop now saves knot snapshots with worker runs, collects manually corrected examples, and proposes instruction-only revisions through the shared worker/router. Teaching history displays original/proposed instructions, source evidence, paired text replays on a selected strand, failures, and persisted user assessments. Acceptance checks for intervening edits and saves through the knot library; revert restores instructions and retains unrelated settings. Library replacement uses atomic rename and unique version backups.

Generation and replay intersect current policy with source example restrictions. Model rules, local-only filtering before credential resolution, context limits, output limits, and budgets continue through the existing router. Evaluations disable file tools and pin both sides to the selected connection. Model response fields cannot expand permissions or change model configuration.

Validation: full workspace build, JavaScript syntax check, existing worker/routing integration tests, and new Electron mock-provider tests passed. Tests cover held-out source tasks, same-model comparisons, historical privacy, manual assessments, stale changes, acceptance/backups/revert, malformed model output, failed replays, and persisted history. Browser fixture inspection exercised the teaching dialog, example/model selection, comparisons, assessments, and acceptance at a narrow viewport. Native desktop visual checks, live providers, and Windows remain unverified.

The prototype evaluates supplied text, not filesystem operations. Old runs without snapshots cannot teach. Examples are manually provided and locally retained. The next build should extend replay fixtures with structured tool observations and evaluate the correction workflow with real tasks before adding automatic learning.
