# KNOTS project plan

**Status** · Product and architecture plan

**Product baseline** · This plan describes the intended product and records the open design decisions. The README describes what runs today.

## 1. Product definition

KNOTS is a local-first workspace for creating autonomous bots that can work across connected AI models. A **knot** defines a reusable job, including instructions, knowledge, tools, and rules. A **strand** is a named connection to a model. A **pull** is a run or conversation with a knot. A **lane** maps a type of work to an ordered list of strands.

The user gives a knot an outcome. KNOTS identifies the steps, chooses an eligible model for calls that need judgment, executes permitted actions on the laptop, and returns the finished work. The local runtime carries context and intermediate results between steps and can keep the job running while the dashboard window is closed. It can choose different models within one run or use one model throughout. A knot can declare capability requirements, privacy limits, and preferences. A model selection override is available within those rules.

The user can select a knot directly or delegate to the planner to choose one or more knots. Within a knot run, execution continues through authorized steps. KNOTS asks for missing information or approval when required and supports progress, cancellation, and inspection of model and tool decisions.

A knot's definition is portable. Sharing it carries its instructions, included reference material, and declared requirements. Recipients supply their own model connections and approve local access. KNOTS runs on the user's machine with local storage and OS-keychain credentials. Connected cloud models and external services can receive requests when the applicable rules allow it. Optional KNOTS-hosted capabilities come later.

## 2. End-to-end user journey

| Moment | What the user does | What KNOTS does |
|---|---|---|
| First launch | Opens the dashboard and configures a cloud or local model. | Shows chat and setup, checks the connection, and explains any missing requirements. |
| Prepare a bot | Defines a job, instructions, and desired output. Adds knowledge, tools, and rules as those capabilities become available. | Saves a versioned knot, validates its references, and explains model or tool requirements. |
| Delegate | Gives the dashboard planner a request, or addresses a saved knot directly from chat or the glass bar. | For dashboard requests, the planner breaks down the work, chooses knots, and schedules by urgency. Direct requests use the named knot. The router selects eligible strands for each call. |
| Supervise | Closes the window to work elsewhere, then reopens it to check progress, answer questions, or approve actions. | Keeps the job running in the local worker and shows the same job and pending decisions when the dashboard reconnects. The glass bar can also display that state. |
| Receive work | Reads the finished result and asks for a refinement if needed. | Returns the deliverable and exposes strands used, run status, and relevant activity. If a step failed, shows what completed and what needs attention. |
| Compare | Swaps models or reruns a request with another model. | Identifies each result's model. For comparison, uses the same input and makes each attempt visible. |
| Share | Exports a knot or imports one into the library once import/export ships. | Previews included files and requested access, maps model requirements to available connections, and opens the saved knot once imported. |

**Example walkthrough.** Give a PDF Organizer knot a folder and ask it to organize the PDFs by subject. The local runtime discovers files and extracts text. KNOTS selects an eligible model to classify each document, validates the proposed destinations, and can apply file moves within the granted scope after approval for that workflow. When the user returns to the dashboard, they can see what moved, what was skipped, and what needs attention.

## 3. Architecture and responsibilities

| Component | Responsibility |
|---|---|
| Knot spec and validator | Version and validate bot definitions. Resolve references relative to the knot. Represent instructions, knowledge, tools, required capabilities, model overrides, lanes, rules, permissions, and budgets in the portable definition. |
| Provider layer and capability map | Normalize model requests, responses, errors, and usage where exposed. Track capabilities such as tool calling, vision, structured output, and context limits. Evaluate LiteLLM and the Vercel AI SDK with the same local and cloud flows before choosing. |
| Knot runtime | Carry out the job step by step using model calls and local tools, retaining context and intermediate results. Retrieve relevant references before a model call when needed. Evaluate tool emulation separately for models that lack native tool calling. |
| Router and lanes | Combine capability checks with privacy, budget, and connection availability. Apply the document's preference order of privacy, manual override, lane, and default. Record the selection, fallback, or reason a call could not run. App-wide lane defaults can be overridden per knot. |
| Planner and scheduler | Break open-ended requests into tasks, track dependencies and urgency, select or instantiate knots when delegated, and dispatch work within concurrency and budget limits. |
| Background worker | Own job execution independently of the renderer. Persist progress, pending decisions, cancellation state, and completed actions. Let the dashboard reconnect to the same job without submitting it again. |
| Tool and permission layer | Mediate access to browser, apps, files, shell, network, and connected accounts as those capabilities ship. Enforce effective access and approval decisions at execution time. |
| Storage and identity | Use local storage for configuration, history, and activity. Use the OS keychain for API credentials and OAuth tokens. Introduce local retrieval storage when knowledge indexing ships. |
| Interfaces | Expose the runtime through the CLI, dashboard, and hotkey glass bar. Support programmatic access through an OpenAI-compatible endpoint. The dashboard and overlay should read the same run state and send controls through the same runtime. |

**Background lifetime.** Closing the dashboard can leave the local worker running. An explicit quit can stop the worker. The first implementation should report interrupted work after restart. Automatic recovery after a crash, logout, or shutdown requires checkpoint and replay behavior. While the laptop is asleep, execution waits for it to wake.

**Run lifecycle.** Track queued, running, waiting for input, waiting for approval, completed, failed, and cancelled work. Pause and resume should have explicit behavior for in-flight work. A retry should preserve completed work where possible and avoid repeating a side effect whose outcome is uncertain. The planner and router record what was selected and why.

**Routing boundary.** Privacy applies to every model call, including classification, fallback, and later steps. Evaluate the information that will be sent, including attachments, retrieved material, and prior tool results. A manual model preference or downgrade is eligible only if it still satisfies requirements. If there is no eligible strand, surface the blocking constraint and retain the task for retry.

## 4. Computer access and user control

Implement the document's **full-user, ask-first, read-only, and custom** profiles alongside its access tiers. Tier 1 uses the bot's own identity and a sandboxed browser profile. Tier 2 enables approved access to the user's accounts and apps. Tier 3 is per-bot opt-in to full-user access within normal OS privileges. Apply lane limits and OS permissions when deciding whether an action can run.

- Show what a bot wants to do, the target, and what the user is authorizing. Keep mandatory gates for sensitive actions such as sending messages, purchases, deletion, installs, and credential or system settings changes. Enforce the same decision from either UI.
- Treat external content as input data. Resolve tool authority from the task and permission rules. Put credential use behind the vault and keep key material out of prompts and logs.
- The global kill switch stops active work and prevents additional dispatch. Record the outcome of actions already sent, including cases where an external outcome is unknown.
- Log bot, task, strand, and action outcome so the user can see what happened. Design log fields to avoid storing secrets.
- Add a separately connected, user-owned bot mailbox with OAuth, revocation, outbound rate limits, and review of outgoing messages. Document what happens when OS permissions, credentials, or approval are missing.

## 5. Product capabilities and acceptance criteria

| Capability | What the product should demonstrate |
|---|---|
| Model-independent knots | One knot runs using both local and cloud strands without changes to its job definition. Users can select a strand or compare outputs from the same input. |
| Background execution | Submit a job, close the dashboard, let the local worker make progress, and reopen the dashboard to see the same job and its activity. |
| Autonomous execution | A user submits a goal. KNOTS plans and executes the work, chooses eligible models step by step, uses approved tools where needed, and returns one result. Run details identify each model and why it was selected. |
| Routing and recovery | Verify different models within one pull, eligible fallback on a provider failure, and a clear stop when a required capability or permission is missing. A local-only pull stays local at every step. |
| Desktop supervision | Dashboard and glass bar show the same status. Test progress, priority changes, questions, approvals, denial, pause, resume, and cancellation. Verify Windows and macOS builds and document Linux behavior. |
| Knowledge and integrations | A knot retrieves relevant references and uses permitted tools. Exercise MCP integration, connected accounts and bot identity, and the OpenAI-compatible API through their intended entry points. |
| Portability and evaluation | Import an exported knot on another setup using independent connections and access grants. Compare models on a repeatable input with visible criteria, cost, and latency where available. |
| Registry and optional hosting | Validate shared packages and plugins before use. Optional registry, sync, bot aliases, and hosted runs respect user opt-in and preserve local workflows. |

**Build dependencies.** Validate the spec and provider boundary before wiring model calls into both interfaces. Establish run identity, state, and cancellation before planner concurrency. Demonstrate permission enforcement, action logging, and the kill switch before enabling computer access. Define package validation and permission review before adding a registry. Evaluate cloud capabilities against the local workflow before making any feature depend on hosted services.

## 6. CopilotKit and AG-UI reference

CopilotKit is a reference for frontend integration. AG-UI streams messages, tool calls, state, and run lifecycle events to an interface. CopilotKit also demonstrates approval interrupts and shared state. The closest KNOTS use case is an approval appearing in the dashboard and glass bar, with a decision in either surface updating the same run. KNOTS owns the underlying scheduling, routing, permission decision, and execution. [AG-UI](https://docs.copilotkit.ai/langgraph-fastapi/ag-ui) · [Approval interrupts](https://docs.copilotkit.ai/ag2/human-in-the-loop) · [Shared state](https://docs.copilotkit.ai/shared-state)

Evaluate an AG-UI adapter with a local run that emits progress, pauses for approval, reconnects to the UI, and resumes after one decision. Check what the toolkit covers across both desktop surfaces before deciding whether to adopt it. The comparison also drew on an indexed CopilotKit post about Microsoft Agent Framework integration. X blocked direct retrieval, so the technical capabilities above were verified against official documentation. [CopilotKit on X](https://x.com/CopilotKit/status/2062534093309677662)

## 7. Verification

| Area | What to exercise |
|---|---|
| Provider portability | Same knot on local and cloud models, unsupported capabilities, missing credentials, and unavailable local endpoints. |
| Routing and budgets | Manual override, lane fallback, exhausted budget, overlapping policy rules, and local-only attachments and tool output. |
| Planner and user control | Two concurrent tasks, a task waiting on a dependency, urgency changes, approval from either interface, and cancellation during execution. |
| Computer access | Allowed and denied actions, injected instructions in external content, revoked OS access, and a pending action during a kill switch. |
| Import/export | Missing files, unsupported versions, package paths escaping the selected folder, missing model bindings, and permissions that require fresh approval. |
| Platform and local operation | Clean Windows/macOS installs, hotkey conflicts, offline execution with an available local model, and Linux compositor fallbacks. |

## 8. Open design decisions

| Decision | Planning position |
|---|---|
| End-user app or framework | The journey described here targets the desktop app with a reusable core. Confirm the positioning explicitly. |
| Open source or open core | Open. Decide before choosing how to distribute the spec and implementation. |
| Runtime and provider interfaces | The current workspace uses TypeScript, Electron, and provider adapters. Electron’s main process is the proposed initial worker host. Keep the job interface independent of the renderer so a dedicated local service remains possible. |
| Spec format and versioning | YAML is the working example. Confirm format, validation, and migration approach before freezing v0. |
| Tool standard | MCP is the document's leading choice. Confirm the integration boundary before enabling tool execution. |
| Overlay implementation | The dashboard uses Electron. Confirm the overlay approach and platform-specific behavior. |
| Classifier and lane settings | App defaults with per-knot overrides are the current proposal. Rules, local model classification, or a hybrid remain open. |
| Planner autonomy | Confirm when the planner may instantiate a knot, infer urgency, or ask the user, and how it handles an uncertain plan. |
| Permission default | Open in KNOTS.md. The planning recommendation is ask-first, with per-bot opt-in for full-user access. |
| Cloud ordering and frontend integration | Cloud feature order and CopilotKit adoption remain open. Evaluate each against the local runtime and supervision workflow. |

## 9. Release and operating plan

- **Build and release checks.** Run core validation and provider contract checks in CI with test doubles. Smoke-test real local and cloud connections separately. Install each desktop package on a clean supported machine and verify launch, setup, local storage, hotkey, cancellation, and upgrade behavior. Decide signing and installer requirements before external distribution.
- **Local data and upgrades.** Version app storage and knot schemas. Test opening data from the previous release and document recovery from a failed migration. Keep local history and logs under user control. Verify deleting a connection revokes local access to its credential without breaking unrelated bots.
- **Failure and recovery.** Surface provider errors, no eligible model, missing permission, and budget exhaustion with actionable messages. Preserve the task draft when a user can fix the problem. For interrupted side effects, show whether the outcome is known before offering a retry.
- **Release review.** Walk through first launch, normal use, and the failure cases for each release. Record platform results, known limitations, and any open release blockers. For optional cloud features, verify opt-out and availability of the corresponding local workflow.
- **Measures to review.** Record time from first launch to a completed task, run completion and cancellation outcomes, routing and fallback reasons, and cost and latency where providers report them. Set targets after observing prototype runs. Use explicit opt-in for any future remote telemetry.

## 10. Next build · Create and run a reusable bot

The current dashboard runs saved knots on selected strands. Extend it with a general **Create knot → Save → Assign task → Inspect result** flow. A PDF Organizer is an example someone could build using KNOTS.

1. **Create and edit knots in the dashboard.** Let users describe the bot's job, its instructions, the result it should produce, and its model requirements. Save and validate the definition in the existing knot library. Keep model credentials in strand settings.
2. **Give knots a shared way to use tools.** Let the creator select from a small catalog of supported tools and grant the relevant scope. Start with a read-only local folder tool and a report result so the run exercises tool execution without depending on a particular file type or workflow. The runtime validates tool requests against the knot's permissions.
3. **Run through a shared worker and router.** Persist step status and results in SQLite. Let the router choose an eligible strand for calls that need a model. The dashboard can close and reconnect while the app's worker is running. Show the tool actions, model choices, result, and cancellation state when it reconnects.

**Done when** a user can create two knots with distinct instructions and outcomes in the dashboard, run both through the same worker and tool interface, and run the same saved knot with another eligible model without editing its definition. Verify that a run can continue with the dashboard window closed and that the dashboard can reconnect to it.

### Product reference · Clicky

The original Clicky prototype uses screen context, voice, and cursor pointing. Its desktop interaction is a reference for quick access to a running bot. KNOTS centers on defining and reusing specialized bots, giving them jobs they can work through, and selecting models according to the job's needs. [Clicky repository](https://github.com/farzaa/clicky) · [Original demo on X](https://x.com/FarzaTV/status/2041314633978659092)
