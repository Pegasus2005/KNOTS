# KNOTS release and verification

## Release candidate scope

This repository now includes the five planned implementation milestones: reviewed multi-bot plans, knowledge/portable packages, approved MCP tools, conversation UI/quick bar, and release tooling. This is not certification that every platform, provider, installer or OS integration has passed.

The supported build baseline is Node.js 24 LTS (minimum 22.12), pinned Electron 43.8.13 and electron-builder 26.18.0. Electron is pinned because the builder needs an exact binary version. Upgrade Electron and packaging tooling together. The root minimatch override patches the affected build-tool versions; verify the complete packaging path after changing it.

## Build and test

```bash
npm ci
npm run verify
npm run rebuild:native -w @knots/desktop
npm run test:runtime -w @knots/desktop
npm audit --audit-level=moderate
npm run package:dir -w @knots/desktop
npm run smoke:packaged -w @knots/desktop
```

`smoke:packaged` launches the actual bundled application in a temporary `KNOTS_DATA_DIR`. It waits for the renderer's successful workspace initialization through the packaged preload and checks SQLite. It removes the disposable workspace afterward. It is not a visual or shortcut test.

The CI workflow repeats these checks on macOS, Windows and Linux. Linux test processes use Xvfb and disable the Chromium process sandbox only in the isolated CI test environment; normal app windows retain context isolation and sandboxing. A workflow definition is not a passed CI run. Nothing is uploaded or published by local commands.

## Platform acceptance matrix

| Check                                                       | Local macOS arm64                      | Windows                               | Linux                          |
| ----------------------------------------------------------- | -------------------------------------- | ------------------------------------- | ------------------------------ |
| Workspace/source checks                                     | Passed                                 | CI configured; not locally run        | CI configured; not locally run |
| Runtime, routing, plans, teaching, knowledge, conversations | Passed                                 | CI configured; not locally run        | CI configured; not locally run |
| Process-crash and uncertain-action recovery                 | Passed                                 | CI configured; not locally run        | CI configured; not locally run |
| Local MCP and synthetic provider HTTP contracts             | Passed                                 | CI configured; not locally run        | CI configured; not locally run |
| Unsigned package and packaged startup                       | Passed                                 | CI configured; not locally run        | CI configured; not locally run |
| Native quick-bar shortcut, focus, tray and folder pickers   | Manual release check pending           | Pending                               | Pending/compositor dependent   |
| Signed/notarized installer and clean installation/upgrade   | Pending credentials and manual checks  | Pending credentials and manual checks | Pending installer checks       |
| Live cloud accounts/current models                          | Not run without configured credentials | Not run                               | Not run                        |

Local results refer to 2026-11-25. The unsigned macOS arm64 DMG and ZIP were also built and SHA-256 checksummed; clean-machine installation is a separate pending check. The final dependency audit reported zero vulnerabilities, including development dependencies. Browser fixtures verified the chat and quick-bar layouts; that does not substitute for native desktop acceptance.

## Live provider checks

Run only when you intend to contact the configured provider and accept its API cost. This sends one synthetic connectivity prompt and reports only nonempty response status, provider and model. It does not send workspace files or conversations.

```bash
KNOTS_LIVE_PROVIDER=ollama KNOTS_LIVE_MODEL=your-local-model npm run test:live -w @knots/desktop
```

For cloud providers, set `KNOTS_LIVE_API_KEY`, the exact provider/model, and optionally `KNOTS_LIVE_ENDPOINT` in your environment. Never commit keys. The manual `live-provider.yml` workflow uses the `live-provider-checks` environment: configure required reviewers and environment-scoped credentials before use. It does not run on pushes or pull requests.

Synthetic contract tests exercise local HTTP response shapes for OpenAI, compatible endpoints, Anthropic and Ollama. Google and OpenRouter adapters are present but are not claimed as live verified by this suite.

## Installers and signing

```bash
npm run dist -w @knots/desktop
npm run checksums -w @knots/desktop
```

The configuration targets macOS DMG/ZIP, Windows NSIS and Linux AppImage. Local commands use `--publish never`. Default unsigned outputs must not be presented as signed production installers. CI's optional installer builds are unsigned verification artifacts.

On platform-native build hosts, supply your own signing credentials through the build environment. Require signing for a distribution build with:

```bash
npm run dist -w @knots/desktop -- --config.forceCodeSigning=true
```

Configure macOS notarization as well as signing, and verify the resulting application/installer using the platform's verification tools. Verify Windows Authenticode and clean installation/upgrade on Windows. Do not put certificates, API keys or passwords into configuration files. The repository does not contain signing identities or grant permission to use an external identity.

References: [electron-builder v26 configuration](https://www.electron.build/v26/docs/configuration/) and [multi-platform build requirements](https://www.electron.build/v26/docs/features/multi-platform-build/).

## Workspace upgrades and recovery

1. Quit KNOTS and ensure all worker processes have stopped before copying or restoring workspace data.
2. Keep a separate copy of the full workspace, including bot definitions and immutable assets. SQLite backups do not contain those files or OS-keychain credentials.
3. On an existing schema upgrade, KNOTS creates a consistent `knots.db.v<version>.<id>.backup` before applying transactional migrations. It retains that file for manual recovery.
4. A failed migration rolls back. A database from a newer application version is refused rather than downgraded. Do not delete data to make startup succeed.
5. For recovery, work on a copied workspace: use a known-good backup as its database and retain the corresponding bot/assets directory. Do not reuse WAL/SHM sidecars from another database. Open it with a compatible application and inspect recovered jobs before resuming.
6. Restore connections/credentials and renew folder access as required. Pending and uncertain actions still need review; restoring a backup is not proof that an external side effect did not happen.

The suite verifies old-data preservation, consistent private backup contents, newer-schema refusal and rollback of a deliberately failed migration.

## Manual release walkthrough

- Clean install; create a fresh local workspace and connect local/cloud strands.
- Chat across multiple turns, change an eligible model, and verify a private conversation cannot become cloud-visible by relaxing the current bot.
- Submit independent work and a dependent plan. Close/reopen both surfaces, pause, answer a question, reject/approve actions and trigger global stop.
- Approve an exact file, interrupt another write, reconcile it, and verify no duplicate or overwritten result.
- Test the quick-bar hotkey, tray fallback, focus, window close, permission revocation and a hotkey conflict.
- Import/export a bot with knowledge and MCP requirements using independent connections.
- Upgrade a copied older workspace, verify backups, and exercise recovery without touching the source copy.
- Confirm that credentials are absent from exports and normal activity output, and that packaging excludes local workspaces, test artifacts and development files.
- Decide the project license/distribution policy, finish signing/notarization, record platform results and known limitations, then authorize publication separately.

No publication, remote push, signing, platform certification or paid live-provider call is implied by a local build passing.
