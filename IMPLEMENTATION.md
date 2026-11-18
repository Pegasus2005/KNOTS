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
