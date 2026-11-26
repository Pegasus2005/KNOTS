# KNOTS next builds and feature research

Current proposed roadmap (26 November 2026): [Automatic bot creation and measured improvement](BOT-CREATION-AND-IMPROVEMENT-PLAN.md). Milestone 1 is implemented; Milestones 2–5 remain planned. See [understanding.md](understanding.md) for current user journeys, frontend availability and known limits. The research and completed build notes below are retained as history; previously recommended builds are not necessarily outstanding work.

Research reviewed on 18 November 2026. Recommendations below apply to the current TypeScript, Electron, SQLite, strand adapters, and read-only tool worker. These are proposed builds.

## What the research suggests

| Observation                                                                                                                                                                                                                       | Implication for KNOTS                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In a Reddit discussion about daily automation, participants ask for connected tools, retained context, and a central view of tasks. One participant describes fixed checklists and stored task state as their practical approach. | Make repeatable jobs, visible activity, and retained context easy to use. This discussion is anecdotal user feedback. [Discussion](https://www.reddit.com/r/AI_Agents/comments/1xldurs/whats_your_actual_ai_agent_setup_for_daily_work/) |
| Another Reddit discussion raises progress loss, permissions, and cost. A reply describes the difficulty of determining what a successful run actually changed and whether retries duplicated writes.                              | Give a write an identity, show its intended effect, verify the outcome, and retain the result for recovery. [Discussion](https://www.reddit.com/r/AI_Agents/comments/1xsy2pf/for_those_building_ai_agents_whats_been_the/)               |
| Refly describes building and exporting reusable, versioned agent skills.                                                                                                                                                          | Bot creation and reusable skills already have implementations elsewhere. KNOTS should make the route from a user-created bot to a proven, repeatable job clear. [Refly](https://github.com/refly-ai/refly)                               |
| Letta describes background processing that updates an agent's retained memory.                                                                                                                                                    | Editable memory is a feasible extension. Store what was learned and its source, and let users review corrections. [Letta](https://www.letta.com/blog/sleep-time-compute/)                                                                |
| Microsoft SkillOpt proposes trajectory-driven edits to reusable skills with validation before an update is accepted.                                                                                                              | Run history can become input to a reviewed improvement to a bot. Small saved test cases can help judge whether a change improved it. [SkillOpt](https://github.com/microsoft/SkillOpt)                                                   |
| Browser Use provides a browser-agent library, and CUGA combines tool integrations, policy controls, and reusable skills.                                                                                                          | Browser actions and connectors have existing components to evaluate when adding those tools. [Browser Use](https://github.com/browser-use/browser-use) · [CUGA](https://github.com/cuga-project/cuga-agent)                              |

I searched X and attempted to read the Letta and Browser Use accounts. Both returned 403 responses, and the targeted post searches produced insufficient relevant results. X posts were therefore excluded as evidence for feature claims. The conclusions above use accessible Reddit discussions, project repositories, and first-party documentation. Search ranking and forum replies do not establish market demand or prove that a feature is unique.

## Recommended next build · Review and apply a bot's work

Give knots the ability to create a real output file through a reviewed action.

1. Define a typed tool registry around the existing list/read tools. Separate schemas, permission checks, and execution from the worker's model loop. Validate native tool calls where adapters support them and retain a checked JSON action path for compatible models.
2. Add a create-file action inside a user-granted output directory. Show the destination and exact proposed contents in the dashboard before approval. Bind approval to the persisted proposal and content, and reject an overwrite or a changed target.
3. Persist the proposal, decision, and action result. Closing the dashboard should leave the action waiting. Denying or cancelling it must prevent execution. Use stable action identifiers and inspect the outcome before retrying an uncertain write.
4. Read back the created file and compare it to the approved content. Record the output as a deliverable with its path and verification status.
5. Present a readable timeline with model calls, tool requests, approvals, results, and failures. Keep the same job available after reconnecting.

**Acceptance demo.** Create two bots in the dashboard, such as a release-note writer and a folder-audit bot. Give each a different goal. Each reads authorized input and proposes a Markdown report. Approve one, deny the other, and verify that only the approved file exists with the reviewed content. Reopen the dashboard while a proposal is waiting. Repeat after an interruption and verify there is no duplicate write.

This increment builds on the existing worker and provides a real, inspectable deliverable. The scope of the initial write tool is create-only. General editing and shell execution need their own action semantics.

## Automatic strand selection · Worker milestone implemented

The desktop worker now routes before each model call using deterministic inspect/deliver stages, privacy and capability constraints, configured context limits, preferences, and estimated budgets. Model-call receipts explain choices and fallback. See README for supported settings and verification limits.

- A run can use a fast model to inspect data and a stronger eligible model to prepare or validate a result.
- Preserve task state when changing models, within supported context limits. Normalize the messages and observations passed to each adapter.
- If a call fails, consider an eligible fallback only for the failed model call. Use the recorded action outcome to prevent a completed tool action from being repeated.
- Cost reporting uses provider usage and known prices where available. Show unknown cost explicitly.
- Verify local-only handling across classification, fallback, and later model calls. Test an unavailable provider and a capability mismatch.

**Acceptance demo.** Run the same saved knot on two configured model sets, demonstrate a documented model choice, and recover from a model-call failure without repeating the approved output action. A two-model run should serve an actual requirement and carry the relevant state forward.

## Standout feature recommendation · Teach a knot from a corrected run

The user completes a run, corrects something, and chooses **Teach this knot**. KNOTS proposes a small, reviewable update to the bot's instructions or reusable procedure. The user can test it on saved examples, accept the new version, and revert it.

For example, a reporting knot produces a verbose report. The user edits it into their preferred format. KNOTS proposes a revised output rule, previews how that rule changes another sample, and saves the approved update with the bot. When the user switches models, the same instructions and examples remain available.

### Implemented prototype

The corrected-run teaching prototype is implemented. It saves manual corrections, generates reviewed instruction changes, compares supplied text examples on a selected eligible model, records user assessments, and supports acceptance and revert. Full tool-workflow replay and automatic learning remain future work.

### Prototype scope

1. Save one run input, the user's corrected result, and a short explanation of what changed.
2. Ask a configured model to propose an instruction edit. Show the original and proposed text and the source run.
3. Run a few saved examples with the old and proposed definitions. Include a held-out example where possible. Show outputs, failures, and user assessments without promising objective quality from a single automated score.
4. Save an accepted version through the knot library's existing backup mechanism. Preserve versions and examples locally.
5. Evaluate model changes against those same examples. Only run on models eligible to receive the example data.

This is instruction and procedure improvement using reviewed evidence. SkillOpt and Refly provide related references, so the feature's value should be tested with KNOTS users. The opportunity is the integrated experience across bot creation, actual local work, correction, versioning, and model portability. A tenfold improvement is a product hypothesis to measure.

**Dependencies.** Structured run records, editable bot versions, comparison runs, and a place for saved examples. Start with manually supplied corrections before attempting screen recording or automatic learning.

**Success measures.** Whether users need fewer corrections on repeated jobs, how often proposed updates are accepted, whether accepted updates hold up on unseen examples, and whether the improvement survives an eligible model change.

## Other ambitious ideas worth testing

| Idea                                   | Small version                                                                                                                                | Dependency                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Model audition for a knot              | Run saved examples on two eligible strands and let the user choose the result they prefer. Store the preference with latency and known cost. | Saved examples, usage records, and comparison runs.                 |
| Resume a run with another model        | Resume at a persisted model-call boundary with a different eligible strand and the completed observations.                                   | Checkpoints, action identities, and verified tool outcomes.         |
| A knot that wakes for a specific event | Trigger a saved bot on a new file in an explicitly selected folder. Debounce events and retain a processed-file identity.                    | Stable background execution, queueing, and observable errors.       |
| Explain a result from its evidence     | Link a report section to the file excerpts and tool observations used to produce it.                                                         | Source identifiers, structured observations, and result references. |

## Work order and milestone reporting

The dark dashboard is complete in commit 44931bc and was visually inspected on macOS. The desktop build passed.

The recommended next sequence is reviewed file creation, automatic routing, and then the corrected-run teaching prototype. For each milestone, report what changed, the acceptance demo result, and what remains unverified, then commit the verified work. Keep proposed features distinct from implemented capabilities in the product docs.

## Reliable background worker · Implemented

The desktop now has checkpointed FIFO jobs, bounded concurrency, explicit pause/resume and restart recovery, saved missing-input questions, renewed folder access, and uncertain-write reconciliation. Dashboard/tray/CLI stop requests share persistent control. Mock-model integration includes actual child-process crashes at file persistence boundaries; live-provider and platform release verification remain open.

The next recommended milestone is reviewable multi-knot task planning: split a goal into saved-knot tasks, show dependencies and expected deliverables, obtain user approval of the plan, dispatch ready tasks through the existing queue, and stop or propagate failure without silently repeating effects. Timer/event triggers and broader computer tools remain later work.

## Multi-knot plans · Implemented

Reviewed drafts use saved bots, validated acyclic dependencies, per-task folder grants, immutable approved definitions, and atomic task/run bindings. Ready tasks use the durable queue; prerequisite outputs and verified paths are handed off with transitive source model/privacy constraints. Failure blocks remaining work, pause/restart holds dispatch, and global stop cancels plans. Build and mock-provider integration passed for graph validation, handoff, privacy, duplicate prevention, rejection, stale definitions, persisted bindings, and failure propagation. Live-provider and cross-platform release checks remain pending.

## Current checkpoint · Milestone 3 complete

1. Reviewed multi-knot plans and dependencies — committed.
2. Local knowledge retrieval and reviewed knot packages — committed.
3. Reviewed MCP tool calls and a local notes integration — implemented and verified with an actual local HTTP server.
4. ChatGPT-style conversation UI and unified glass bar — deferred.
5. Release hardening, live-provider/platform verification and distribution — deferred.

Stop after milestone 3. Do not start the remaining milestones until the user resumes them. External services, OAuth and Windows are not covered by the local MCP verification.

## Milestone 4 complete

The user resumed remaining work. Conversation UI and the unified quick bar are implemented; milestone 5 release hardening is now active. Earlier instructions to stop after milestone 3 no longer apply.

## Current checkpoint · All five implementation milestones present

Milestone 4 added the conversation interface and shared quick bar. Milestone 5 added upgraded dependencies, consistent migration backups, audit gates, CI/platform packaging, packaged smoke checks, opt-in live-provider checks, checksums, and an end-to-end README. The local macOS arm64 acceptance path passed, including unsigned DMG/ZIP creation. See RELEASE.md for the remaining external-release gates; configured CI is not a completed Windows/Linux test, and unsigned outputs are not signed production releases.

No further feature milestone is automatically queued. The next release decision is to run the platform/manual/live-provider checklist and supply signing/notarization credentials and a licensing decision before external distribution. Nothing was pushed or published.
