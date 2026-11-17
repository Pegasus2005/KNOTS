# KNOTS project plan

**Status** · Planning draft for review before MVP execution  
**Product baseline** · The supplied KNOTS.md governs the roadmap, platform order, and intended product behavior. Recommendations and decisions still open are called out below.

## 1. Product definition

KNOTS is a local-first desktop workspace for defining reusable bots, connecting cloud and local models, and delegating work. A **knot** contains a bot's instructions, knowledge, tools, and rules. A **strand** is a model connection. A **pull** is a run or conversation with a knot. A **lane** maps a type of work to an ordered list of strands.

The user configures model connections once. A knot can draw on those connections within its capability, privacy, permission, and budget constraints. In the full product, the planner breaks requests into tasks, picks or creates knots from templates, and schedules execution. A run can use different strands for different steps and return a consolidated result. Manual lane overrides, model swaps, and comparisons give the user control over model choice.

A knot's definition is portable. Sharing it carries its instructions, included reference material, and declared requirements. Recipients supply their own model connections and approve local access. KNOTS runs on the user's machine with local storage and OS-keychain credentials. Connected cloud models and external services can receive requests when the applicable rules allow it. Optional KNOTS-hosted capabilities come later.

## 2. End-to-end user journey

| Moment | What the user does | What KNOTS does |
|---|---|---|
| First launch | Opens the dashboard and configures a cloud or local model. | Shows chat and setup, checks the connection, and explains any missing requirements. |
| Prepare a bot | Defines a job, instructions, and desired output. Adds knowledge, tools, and rules as those capabilities become available. | Saves a versioned knot, validates its references, and explains model or tool requirements. |
| Delegate | Gives the dashboard planner a request, or addresses a saved knot directly from chat or the glass bar. | For dashboard requests, the planner breaks down the work, chooses knots, and schedules by urgency. Direct requests use the named knot. The router selects eligible strands for each call. |
| Supervise | Checks progress, answers questions, approves actions, or changes priority while working elsewhere. | Keeps a live board with status, model, and cost where available. The glass bar shows the same run, including pending decisions. |
| Receive work | Reads the finished result and asks for a refinement if needed. | Returns the deliverable and exposes strands used, run status, and relevant activity. If a step failed, shows what completed and what needs attention. |
| Compare | Swaps models or reruns a request with another model. | Identifies each result's model. For comparison, uses the same input and makes each attempt visible. |
| Share | Exports a knot or imports one into the library once import/export ships. | Previews included files and requested access, maps model requirements to available connections, and opens the saved knot once imported. |

**Example walkthrough.** Connect a local model and a cloud provider. Define a Contract Reviewer with a sample review policy. Submit a synthetic NDA review through the dashboard. The planner assigns the work to Contract Reviewer. For a larger review, extraction and analysis can use separate eligible strands. The dashboard and glass bar show progress, and the final review lists clauses to check. A local-only run uses eligible local models throughout. If a colleague later imports the knot, they run it with their own connections and permissions.

## 3. Architecture and responsibilities

| Component | Responsibility |
|---|---|
| Knot spec and validator | Version and validate bot definitions. Resolve references relative to the knot. Represent instructions, knowledge, tools, required capabilities, model overrides, lanes, rules, permissions, and budgets as each phase adds them. |
| Provider layer and capability map | Normalize model requests, responses, errors, and usage where exposed. Track capabilities such as tool calling, vision, structured output, and context limits. Evaluate LiteLLM and the Vercel AI SDK with the same local and cloud flows before choosing. |
| Knot runtime | Assemble messages and references, manage conversation context and tool calls, and produce results. Add retrieval in Phase 2. Evaluate tool emulation separately for models that lack native tool calling. |
| Router and lanes | Combine capability checks with privacy, budget, and connection availability. Apply the document's preference order of privacy, manual override, lane, and default. Record the selection, fallback, or reason a call could not run. App-wide lane defaults can be overridden per knot. |
| Planner and scheduler | Break requests into tasks, track dependencies and urgency, select or instantiate knots from templates, and dispatch work within concurrency and budget limits. Own task status and cancellation. |
| Tool and permission layer | Mediate access to browser, apps, files, shell, network, and connected accounts as those capabilities ship. Enforce effective access and approval decisions at execution time. |
| Storage and identity | Use local storage for configuration, history, and activity. Use the OS keychain for API credentials and OAuth tokens. Introduce local retrieval storage when knowledge indexing ships. |
| Interfaces | Expose the runtime through the CLI, dashboard, and hotkey glass bar. Add the OpenAI-compatible endpoint in Phase 2. The dashboard and overlay should read the same run state and send controls through the same runtime. |

**Run lifecycle.** Track queued, running, waiting for input, waiting for approval, completed, failed, and cancelled work. Pause and resume should have explicit behavior for in-flight work. A retry should preserve completed work where possible and avoid repeating a side effect whose outcome is uncertain. The planner and router record what was selected and why.

**Routing boundary.** Privacy applies to every model call, including classification, fallback, and later steps. Evaluate the information that will be sent, including attachments, retrieved material, and prior tool results. A manual model preference or downgrade is eligible only if it still satisfies requirements. If there is no eligible strand, surface the blocking constraint and retain the task for retry.

## 4. Computer access and user control

Implement the document's **full-user, ask-first, read-only, and custom** profiles alongside its access tiers. Tier 1 uses the bot's own identity and a sandboxed browser profile. Tier 2 enables approved access to the user's accounts and apps. Tier 3 is per-bot opt-in to full-user access within normal OS privileges. Apply lane limits and OS permissions when deciding whether an action can run.

- Show what a bot wants to do, the target, and what the user is authorizing. Keep mandatory gates for sensitive actions such as sending messages, purchases, deletion, installs, and credential or system settings changes. Enforce the same decision from either UI.
- Treat external content as input data. Resolve tool authority from the task and permission rules. Put credential use behind the vault and keep key material out of prompts and logs.
- The global kill switch stops active work and prevents additional dispatch. Record the outcome of actions already sent, including cases where an external outcome is unknown.
- Log bot, task, strand, and action outcome so the user can see what happened. Design log fields to avoid storing secrets.
- Add a separately connected, user-owned bot mailbox in Phase 2 with OAuth, revocation, outbound rate limits, and review of outgoing messages. Document what happens when OS permissions, credentials, or approval are missing.

## 5. Roadmap and acceptance gates

The phase order follows KNOTS.md. Its four-to-six-week Phase 1 estimate is provisional until provider and desktop packaging work is scoped.

| Phase | Deliverables | Acceptance gate |
|---|---|---|
| **1 · MVP** | Versioned knot spec v0 for instructions and model choice. Provider layer with three to four strands, including Ollama and a cloud provider. CLI, simple chat, model swap, basic side-by-side comparison. Dashboard with initial chat and settings for strands, lanes, and hotkey. Prototype glass bar for one knot. Windows and macOS builds and a cross-platform CLI. Kill switch and activity log ahead of computer access. | Run one example knot on local and cloud models, swap and compare from the normal interfaces, and see which model produced each answer. Verify the hotkey and overlay on Windows and macOS. Verify cancellation and activity recording with model-only runs. |
| **2 · Routing, planner, and tools** | Knowledge retrieval, MCP, capability validation, routing and fallback, editable lanes and classifier, OpenAI-compatible API. Planner with urgency, parallel work, and live board. Glass bar steering, approvals, and native effects. Permission profiles, browser and desktop control, mail and file access, bot identity, and access tiers. | A dashboard request runs through the planner, uses eligible strands across steps as needed, and delivers one result. Status agrees across dashboard and overlay. Demonstrate pause, resume, cancellation, safe fallback, approval, denial, and missing-access recovery. Exercise both supported desktop platforms. |
| **3 · Sharing, evaluation, and expansion** | Import/export, registry, scored evaluation, cost and latency views, community plugin support, and expanded Linux support. Optional cloud capabilities include sync, bot aliases, and hosted runs. | Export a knot and import it on a second setup using independent credentials. Compare models with a repeatable fixture and visible scoring criteria. Verify Linux desktop fallbacks and that local workflows remain available without a KNOTS account. |

**Build dependencies.** Validate the spec and provider boundary before wiring model calls into both interfaces. Establish run identity, state, and cancellation before planner concurrency. Demonstrate permission enforcement, action logging, and the kill switch before enabling computer access. Define package validation and permission review before adding a registry. Evaluate cloud capabilities against the local workflow before making any feature depend on hosted services.

## 6. CopilotKit and AG-UI reference

CopilotKit is a reference for frontend integration. AG-UI streams messages, tool calls, state, and run lifecycle events to an interface. CopilotKit also demonstrates approval interrupts and shared state. The closest KNOTS use case is an approval appearing in the dashboard and glass bar, with a decision in either surface updating the same run. KNOTS owns the underlying scheduling, routing, permission decision, and execution. [AG-UI](https://docs.copilotkit.ai/langgraph-fastapi/ag-ui) · [Approval interrupts](https://docs.copilotkit.ai/ag2/human-in-the-loop) · [Shared state](https://docs.copilotkit.ai/shared-state)

Evaluate an AG-UI adapter in Phase 2 with a local run that emits progress, pauses for approval, reconnects to the UI, and resumes after one decision. Check what the toolkit covers across both desktop surfaces before deciding whether to adopt it. The comparison also drew on an indexed CopilotKit post about Microsoft Agent Framework integration. X blocked direct retrieval, so the technical capabilities above were verified against official documentation. [CopilotKit on X](https://x.com/CopilotKit/status/2062534093309677662)

## 7. Verification across phases

| Area | What to exercise |
|---|---|
| Provider portability | Same knot on local and cloud models, unsupported capabilities, missing credentials, and unavailable local endpoints. |
| Routing and budgets | Manual override, lane fallback, exhausted budget, overlapping policy rules, and local-only attachments and tool output. |
| Planner and user control | Two concurrent tasks, a task waiting on a dependency, urgency changes, approval from either interface, and cancellation during execution. |
| Computer access | Allowed and denied actions, injected instructions in external content, revoked OS access, and a pending action during a kill switch. |
| Import/export | Missing files, unsupported versions, package paths escaping the selected folder, missing model bindings, and permissions that require fresh approval. |
| Platform and local operation | Clean Windows/macOS installs, hotkey conflicts, offline execution with an available local model, and Linux compositor fallbacks when Phase 3 reaches them. |

## 8. Decisions before MVP execution

| Decision | Planning position |
|---|---|
| End-user app or framework | The journey described here targets the desktop app with a reusable core. Confirm the positioning explicitly. |
| Open source or open core | Open. Decide before choosing how to distribute the spec and implementation. |
| Core stack, provider library, and initial strands | Open. Ollama and at least one cloud connection are in scope. Select the rest and confirm how the desktop process runs the core. |
| Spec format and versioning | YAML is the working example. Confirm format, validation, and migration approach before freezing v0. |
| Tool standard | MCP is the document's leading choice. Confirm the integration boundary before Phase 2 tool work. |
| Overlay implementation | Tauri is the working option. Keep the native macOS enhancement as a separate choice after the cross-platform prototype. |
| Classifier and lane settings | App defaults with per-knot overrides are the current proposal. Rules, local model classification, or a hybrid remain open. |
| Planner autonomy | Confirm when the planner may instantiate a knot, infer urgency, or ask the user, and how it handles an uncertain plan. |
| Permission default | Open in KNOTS.md. The planning recommendation is ask-first, with per-bot opt-in for full-user access. |
| Cloud ordering and frontend integration | Cloud feature order and CopilotKit adoption remain open. Neither decision is needed to plan the Phase 1 CLI and desktop prototype. |

## 9. Work sequence and handoffs

| Sequence | Work package | Dependency and handoff |
|---|---|---|
| 1A | Confirm Phase 1 scope, select the core stack and initial strands, and define the example knot and expected outputs. | Agree on the Phase 1 decisions below before starting implementation. |
| 1B | Implement and validate spec v0, provider configuration, and the shared CLI run path. | Demonstrate a local and cloud run on the same example with clear connection errors. |
| 1C | Build the dashboard, chat, model swap and comparison, and glass bar prototype. | Reuse the run path from 1B. Prove the hotkey works and the interface can display the producing model. |
| 1D | Finish activity logging and cancellation, package Windows and macOS builds, and run the MVP demo. | Phase 1 closes when both platforms pass the acceptance gate. |
| 2A | Add capability checks, editable lanes, routing, fallbacks, retrieval, and the API. | Test routing with deterministic inputs and confirm privacy applies to each call. |
| 2B | Add planning, scheduling, and a shared live run state. Connect the board and glass bar. | Verify dependencies, reprioritization, interruptions, and parallel runs with model-only tasks first. |
| 2C | Add permission enforcement and approved tools, then connect the bot mailbox and OS-controlled surfaces. | Exercise the approval and kill-switch gates before enabling computer access. Release Phase 2 after the planner-to-deliverable demo and denial cases pass. |
| 3A | Add local package import/export, scored evaluation, and cost and latency views. | Validate package boundaries, compatibility across two installs, and reproducible model comparisons. |
| 3B | Add plugin and registry support, Linux overlay fallbacks, and selected optional cloud services. | Local packages must work before registry distribution. Each hosted feature needs its own opt-in and release gate. |

### Decisions by phase

- **Before Phase 1** choose the desktop/core process model, provider adapters and initial strands, spec format and version, the reference knot, and the MVP distribution target. Decide whether lane settings in Phase 1 store preferences for Phase 2 or include any active routing behavior. The written roadmap places routing in Phase 2.
- **Before Phase 2** settle planner autonomy, classifier design, permission defaults, how lane and bot permissions combine, and what pause and stop mean for in-flight external actions. KNOTS.md describes some approval gates as optional and later lists sensitive-action gates as always on. This plan treats the listed sensitive actions as mandatory and leaves the policy wording for review.
- **Before Phase 3** choose the distribution and licensing model for shared knots and plugins, the registry moderation and update policy, the Linux support matrix, and the order of optional cloud features. Resolve licensing earlier if Phase 1 is distributed publicly.

## 10. Release and operating plan

- **Build and release checks.** Run core validation and provider contract checks in CI with test doubles. Smoke-test real local and cloud connections separately. Install each desktop package on a clean supported machine and verify launch, setup, local storage, hotkey, cancellation, and upgrade behavior. Decide signing and installer requirements before external distribution.
- **Local data and upgrades.** Version app storage and knot schemas. Test opening data from the previous release and document recovery from a failed migration. Keep local history and logs under user control. Verify deleting a connection revokes local access to its credential without breaking unrelated bots.
- **Failure and recovery.** Surface provider errors, no eligible model, missing permission, and budget exhaustion with actionable messages. Preserve the task draft when a user can fix the problem. For interrupted side effects, show whether the outcome is known before offering a retry.
- **Release review.** Walk through first launch, normal use, and the failure cases for each phase. Record platform results, known limitations, and any open release blockers. For optional cloud features, verify opt-out and availability of the corresponding local workflow.
- **Measures to review.** Record time from first launch to a completed task, run completion and cancellation outcomes, routing and fallback reasons, and cost and latency where providers report them. Set targets after observing prototype runs. Use explicit opt-in for any future remote telemetry.

## 11. Planning sign-off

Review the product journey, phase boundaries, permission interpretation, and the Phase 1 decisions before authorizing MVP execution. Assign owners and dates when team capacity is known. Then derive the Phase 1 backlog, demo script, and Windows/macOS verification matrix from this plan. The first execution milestone is one knot running through the supported entry points with a visible model swap and comparison.
