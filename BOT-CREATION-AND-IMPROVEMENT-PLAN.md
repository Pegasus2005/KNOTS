# KNOTS: automatic bot creation and measured improvement

Planning date: 26 November 2026. Status: Milestone 1 implemented on main; Milestones 2–5 remain planned. Work is stopped after the first milestone at the user's request.

ALT integration is retained: automatic temporary specialists, memory, context compaction, peer messages and simplified navigation. The legacy manual screens remain removed. The new Bot Studio introduces creation and memory management. See [understanding.md](understanding.md) for the current experience and backend-versus-UI availability.

Milestone 1 delivers persisted problem drafts, advisory saved-bot matching, queued draft generation, validated editable review, clarification/capability gates, reusable bot saving and idempotent first-run activation. Initial creation supports built-in file tools; advanced MCP/policy editing is not provided in the new review UI. Text-file access and exact write approvals continue through the existing worker. Themes follow the user's supplied design references.

Verification uses synthetic providers and isolated Electron workspaces. Live account checks and release packaging are separate. Automatic-team coordinator durability, shared task budgets and aggregate cost reporting are still integration follow-ups; the ALT merge does not complete those capabilities.

## Product outcome

A user describes a problem. KNOTS helps them reuse or create a suitable bot, reviews its definition with them, and executes the task through the existing worker. Over time, corrections and verified outcomes support proposed improvements to that bot.

The bot remains independent of any single model. Connected strands are selected under existing privacy, capability, context and budget constraints. Improvement changes the bot's instructions, retained knowledge, procedures or model preferences; it does not train the underlying model's weights.

## Existing foundation

- Saved knots, connected strands, stage routing and model-call receipts.
- Durable jobs, checkpoints, reviewed file creation and approved MCP calls.
- Persistent chat, reviewed multi-knot plans, local knowledge and portable packages.
- Teach this knot: manually supplied corrections, proposed instruction changes, text comparisons on a selected model, user assessment, acceptance and revert.

Remaining capabilities include persistent reusable evaluation suites, complete isolated workflow evaluation, automatic lesson discovery and evidence-based model auditions. Existing release verification gates in RELEASE.md remain separate requirements.

## Complete user journey

1. The user opens **Create from a problem** and describes their goal.
2. KNOTS checks saved bots and offers a suitable existing bot where one exists. It explains a suggested match; it does not silently modify that bot.
3. If a new bot is needed, KNOTS asks only questions that materially affect its purpose, output or required access. Missing essential information blocks activation, not draft saving.
4. KNOTS drafts a name, purpose, instructions, expected output, success criteria, available tool requirements and optional example cases.
5. The user reviews the draft, assumptions, missing capabilities and model availability. They can edit, save, or save and run their original task.
6. Execution uses the normal queue, model router, folder grants and action approvals. Creating a bot does not grant access.
7. The result shows deliverables and success criteria, with verification evidence or an explicit unverified state.
8. The user corrects the result or records whether it met their needs.
9. KNOTS can propose a bounded bot change, show its source evidence, and compare versions against saved cases.
10. The user accepts, rejects or defers the proposal. Accepted versions can be reverted; active runs retain their original definition snapshot.

## Milestone 1: create a bot from a problem

Deliver a complete problem-to-reviewed-bot-to-first-run path.

- Add a validated draft schema with original problem, assumptions, clarification state, bot definition, success criteria and proposed test examples.
- Reuse existing task selection to suggest saved bots before generating a duplicate. Matching is advisory and must explain its basis.
- Generate drafts through configured eligible strands. If no strand is available, guide connection setup and preserve the problem locally.
- Resolve tools against the actual registered catalog. Show unavailable capabilities as gaps; never invent integrations or promise unsupported actions.
- Present a compact editable review in the current chat-style UI. Keep advanced routing controls available without requiring provider knowledge during creation.
- Persist the draft and original task. Saving is distinct from activation; save-and-run creates one normal worker run and is safe against repeated submissions.
- Use the current knot schema and library validation when materializing the definition.

**Acceptance:** create two unrelated bots from natural-language problems; reuse a suitable saved bot; recover an unfinished draft after reopening; reject malformed model output; expose a missing capability; verify that activation does not grant tool or folder access. The original task must reach the existing worker once.

**Out of scope:** automatic tool installation, unrestricted bot generation during plans, autonomous permission changes and automatic improvement.

## Milestone 2: reusable evaluation cases

Turn creation criteria and teaching examples into a durable evaluation suite.

- Store user-approved cases separately from bot instructions, with inputs, reference outputs where appropriate, assertions, provenance and data policy.
- Distinguish draft examples from approved evaluation cases. Generated examples alone are not evidence of real-world quality.
- Record definition hashes, suite versions, strand identity, grading method, outputs, latency, usage and known/unknown cost for each evaluation.
- Extend current text comparisons first. Support deterministic checks where meaningful and human assessment for subjective requirements. Label model-based judgments and their uncertainty.
- Separate improvement examples from held-out validation cases. Do not pass held-out answers to the proposal generator.
- Apply source privacy restrictions to generation, evaluation and judging. Reserve bounded evaluation budgets; show estimated calls/cost before starting.
- Clearly label text-only evaluation as insufficient evidence for tool workflows.

**Acceptance:** compare versions against the same suite; prevent held-out leakage into proposal generation; reject an ineligible evaluation strand; preserve partial results after cancellation; show unknown cost honestly; reproduce deterministic checks from stored inputs and versions.

## Milestone 3: reviewed improvement inbox

Build on Teach this knot rather than introducing a second teaching system.

- Offer opt-in analysis of selected completed runs and corrections. Preserve source references and allow exclusion or deletion of evidence.
- Suggest a narrow instruction change with the observed problem, rationale, expected benefit and evaluation results. Do not treat a model's confidence as proof.
- Keep proposal states explicit: draft, evaluating, ready for review, accepted, rejected, stale or failed.
- Detect definition changes while a proposal is pending. Stale proposals require regeneration or explicit rebase and new evaluation.
- Compare with the current version and surface regressions. Never report an improvement from a single self-awarded score.
- Adoption remains explicit. Retain previous versions, evidence and rollback. Reverting must preserve unrelated later settings or require conflict resolution.
- Make background analysis cancellable, budgeted and opt-in. It runs only while the local application and machine can execute work.

**Acceptance:** produce a proposal from a real correction; demonstrate a regression and a rejected proposal; detect stale instructions; accept and revert a valid proposal; verify that permissions, credentials, budgets and active runs remain unaffected.

## Milestone 4: playbooks and verified procedures

Introduce structured memory only after instruction improvement has usable evidence.

- Separate user preferences, sourced lessons and reusable procedures from core instructions.
- Store provenance, scope, confidence/verification state, timestamps and superseded entries. Provide inspect, edit, forget and disable controls.
- Retrieve only relevant entries within a bounded context budget. Conflicting or outdated lessons need review rather than silent accumulation.
- Define precedence: runtime policy and explicit user instructions govern; playbook entries cannot override permissions or become trusted commands merely because they came from a run.
- Add isolated workflow fixtures for supported tools. Replay never repeats live external side effects; unsupported tool environments remain explicitly unevaluated.
- Save procedures as versioned guidance over existing tools. A reusable recipe does not carry grants, credentials or action approvals.
- Extend package export only with explicit selection of examples/playbooks and a review for sensitive content. Imported entries are untrusted and receive no permissions.

**Acceptance:** reuse a sourced lesson on a relevant task; omit it on an unrelated task; forget it; resolve a conflicting lesson; verify a procedure in fixtures without creating live external effects; import a package without inheriting access.

## Milestone 5: evidence-based model auditions

Help a knot choose suitable models using its own approved evaluation cases.

- Compare a user-selected bounded set of eligible strands on the same suite.
- Report quality assessments, failures, latency and configured-price cost. Model comparisons are time- and configuration-specific.
- Let users prioritize quality, cost or latency without collapsing unknown measures into a misleading single ranking.
- Recommend inspect/deliver lane preferences compatible with the existing router. Apply changes only after review; runtime eligibility checks remain authoritative.
- Re-evaluate recommendations when suites, bot definitions or model configurations change. Mark older evidence stale.

**Acceptance:** compare two eligible strands; exclude an ineligible one before sending data; retain an unknown-price result; cancel within the configured budget boundary; apply a reviewed recommendation; verify policy checks still override preferences.

## Architecture and data boundaries

Use shared types and validation in `packages/types`, orchestration and persistence in `packages/core`, existing adapters in `packages/providers`, and reviewed UI/IPC in `packages/desktop`. CLI support can follow once the desktop path is stable.

Proposed entities:

| Entity                | Responsibility                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Bot creation draft    | Original problem, clarifications, assumptions, candidate definition and activation linkage |
| Evaluation suite/case | Versioned criteria, examples, assertions, source policy and improvement/holdout split      |
| Evaluation run        | Immutable bot/suite snapshots, comparison outputs, grades and model receipts               |
| Improvement proposal  | Source evidence, bounded changes, validation results and adoption state                    |
| Bot revision          | Accepted definition version, provenance and rollback relationship                          |
| Playbook entry        | Scoped, inspectable preference, lesson or procedure with provenance                        |
| Model audition        | Comparable evaluation runs and reviewed routing recommendation                             |

Persist resumable analysis through the existing job infrastructure. Introduce explicit job purposes so creation and evaluation cannot accidentally execute ordinary task effects. Text evaluations disable tools; workflow evaluation requires a separately enforced fixture executor. Use stable IDs, transactional transitions and snapshot hashes for activation and adoption.

Do not introduce a second model gateway, queue, approval mechanism or credential store. Review existing backup/version behavior before adding revision persistence so adoption and revert have one source of truth.

## Permission and learning boundaries

- Bot generation and improvement cannot expand grants, tool allowlists, credentials, routing privacy or spending limits without the existing explicit user controls.
- Retrieved files, tool responses, imported definitions and run transcripts are untrusted evidence. Separate their content from the instructions controlling draft generation and evaluation.
- Evidence is local by default; any provider call must satisfy the source's privacy restrictions, including derived lessons and examples.
- Automated evaluation must not replay real writes or remote actions. Retain an explicit unevaluated state when a faithful fixture is unavailable.
- A passing evaluation supports a bounded claim about tested cases. It does not guarantee future performance or justify autonomous adoption.

## Verification and delivery

Implement milestones in dependency order. For each, run focused integration checks at persistence, policy and side-effect boundaries plus the repository's required verification. Visually inspect new creation/review screens and update README only for verified implemented behavior.

After each milestone, notify the user with the completed flow, validation evidence and remaining limitations. Commit completed verified work under the standing milestone workflow. Do not push; the user handles remote pushes. This planning update itself does not authorize application implementation.

Track: time to first successful bot run, reuse versus duplicate creation, required clarifications, user corrections on repeated tasks, improvement acceptance/revert rates, held-out regressions, evaluation spend and portability across eligible models. Establish baselines before claiming gains; do not optimize for proposal acceptance alone.

## Research informing the plan

These sources motivate design choices; they do not establish measured KNOTS performance or uniqueness.

- [SkillOpt](https://microsoft.github.io/SkillOpt/): external skill optimization with bounded edits and held-out validation. Informs proposal generation and validation gates.
- [DSPy GEPA](https://dspy.ai/current/api/optimizers/GEPA/GEPA_Advanced/): reflective optimization from execution feedback. Informs useful evaluation feedback beyond a scalar score.
- [Agentic Context Engineering](https://ace-agent.github.io/): evolving structured playbooks. Informs the separation of reusable lessons from bot identity.
- [Letta sleep-time compute](https://www.letta.com/blog/sleep-time-compute/): processing retained context between interactions. Informs optional background proposals, subject to local execution and budget limits.

## Next implementation step

Resume with Milestone 2: add reusable evaluation suites with explicit source policies, held-out cases and immutable comparison records. Address the documented automatic-team coordinator and accounting limitations before claiming end-to-end recovery. Do not start further implementation until the user resumes work.
