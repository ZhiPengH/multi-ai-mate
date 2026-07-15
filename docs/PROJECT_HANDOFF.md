# Multi AI Mate Project Handoff

Last updated: 2026-07-15

## Current State

Multi AI Mate is a Tauri + React desktop app for opening multiple AI web panels and sending one message to all open panels.

The main product UI is now largely complete:

- New Mac-style light glass UI has been implemented.
- Left AI dock is icon-only.
- Panel headers show AI icon and name, without A/B/C labels.
- Composer starts empty.
- Composer supports unified sending.
- Dragging an AI icon onto a panel loads that provider's web page.
- AI webpages support selected/global `Command + -`, `Command + +`/`=`, and `Command + 0` zoom controls.
- Clicking inside an AI webpage visibly highlights only the selected panel; shortcuts target that panel until selection is cleared.
- AI webpage zoom does not scale the title bar, dock, panel geometry, or composer.
- Panel WebView replacement is recoverable: failed closes remain tracked and hidden for retry, while native same-label creation closes the old WebView before creating the requested URL.
- WebViews created by a stale sync generation are tracked before cleanup, so a failed stale close remains recoverable by the newest queued sync.
- Delayed native selection events from panels that are no longer open and visible are ignored.
- Panel selection listener registration failures are reported explicitly instead of becoming unhandled promise rejections.
- Window layout now resizes with the app window.
- Portrait monitor layout is supported:
  - 2 AI: panels stack vertically.
  - 3 AI: first two panels side by side, third panel below.
  - 4 AI: two-by-two layout.
- macOS app and DMG are generated into the root `release/` folder.
- GitHub Actions is configured for macOS + Windows desktop builds.

## Continuity Protocol

For Codex or another agent starting a fresh conversation in this repository:

1. Read this file first.
2. Run `git status --short`.
3. Treat this file as the compact source of truth for current progress.
4. After meaningful product work, update this file before finishing.

`AGENTS.md` contains the same rule so Codex sessions opened in this project should pick it up automatically.

## Important Branches And Tags

- Active branch: `codex/newUI`
- Current local HEAD is the stale-WebView recovery commit immediately after `c78ffef`.
- Including this stale-WebView recovery, `codex/newUI` is 16 commits ahead of `origin/codex/newUI`, 0 behind, and remains unpushed.
- Historical handoff commit `b120662` was the reviewed HEAD when the branch was 12 commits ahead; it is no longer the current HEAD.
- The AI webpage zoom implementation and all handoff status corrections have not been pushed.
- Latest pushed tag: `v0.1.2`
- Main local zoom commits:
  - `b120662` - Update the AI webpage zoom handoff.
  - `4abd47f` - Complete selected and global AI webpage zoom.
  - `9c8304a` - Serialize panel WebView synchronization.
  - `d3843ce` - Connect panel WebViews to the zoom controller.
  - `2f04ed3` - Add the native AI panel zoom controller.
  - `0ba72d6` - Define AI panel zoom routing tests.

## Current Local Status

- `AGENTS.md` is an unrelated pre-existing dirty file. Do not include it in product commits unless the user explicitly asks.
- `.superpowers/` is untracked and contains this round's task coordination briefs and reports; it is intentionally not committed.
- Current local HEAD is the stale-WebView recovery commit immediately after `c78ffef`. Including this change, `codex/newUI` is 16 commits ahead of `origin/codex/newUI`, 0 behind, and remains unpushed.
- For historical context, `b120662` was 12 commits ahead at the first handoff review; it is not the current branch status.

## Main Files To Know

- `src/App.tsx`
  - Main React UI and interaction logic.
  - Provider list, slots, drag/drop, shortcuts, composer, modal.

- `src/styles.css`
  - Main app visual system.
  - Glass UI, dock, panels, composer, responsive and portrait layouts.

- `src/appModel.ts`
  - Pure model helpers.
  - Mode/slot helpers, URL normalization, slot hit-testing for drag/drop.

- `src/zoomModel.ts`
  - Pure AI webpage zoom helpers.
  - Shortcut parsing, panel label mapping, selected/global target routing, and selection normalization.

- `src/useTauriPanelWebviews.ts`
  - Native Tauri WebView sync.
  - Creates, positions, hides/shows, reloads, and sends text to panel WebViews.
  - Tracks stale-created WebViews before cleanup and reports panel selection listener setup failures.

- `src-tauri/src/panel_zoom.rs`
  - Native AI panel selection and zoom controller.
  - Owns percentage state, 10% steps, reset, and 50%–200% bounds.
  - Validates panel commands, injects remote-page listeners, and replaces existing same-label WebViews before creation.

- `src-tauri/tauri.conf.json`
  - Main Tauri app config.
  - App version currently `0.1.2`.

- `src-tauri/tauri.windows.conf.json`
  - Windows-specific window config.

- `.github/workflows/desktop-release.yml`
  - Tag/manual desktop build workflow.
  - Builds macOS and Windows through GitHub Actions.

- `scripts/collect-desktop-bundles.mjs`
  - Copies desktop bundles from deep Tauri build folders into root `release/`.

## Useful Commands

Run the app in browser/dev mode:

```bash
npm run dev
```

Run the desktop app in development mode:

```bash
npm run dev:desktop
```

Run tests:

```bash
npm test
```

Build frontend only:

```bash
npm run build
```

Build desktop app and collect packages into `release/`:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run build:desktop
```

Collect already-built desktop packages into `release/`:

```bash
npm run collect:desktop
```

Check local Git state:

```bash
git status --short
```

Show recent commits:

```bash
git log --oneline -6
```

Push the current branch:

```bash
git push
```

Create and push a release tag:

```bash
git tag v0.1.3
git push origin v0.1.3
```

## Current Release Package Location

The latest local macOS package is in:

```text
release/Multi AI Mate.app
release/Multi AI Mate_0.1.2_aarch64.dmg
```

`release/` is ignored by Git on purpose.

## Known Notes

- Local macOS desktop builds should use rustup Rust first:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run build:desktop
```

The Homebrew Rust on this machine may be older than some current Tauri dependencies need.

- Windows packages should be produced by GitHub Actions on the Windows runner, not by cross-compiling from macOS.

- Vite currently reports Tauri API dynamic import warnings during build. They have not blocked successful builds.

## Recommended Next Steps

1. Treat the focused desktop zoom sequence as complete: all 10 required checks passed in `release/Multi AI Mate.app` with ChatGPT and DeepSeek.
2. Run a broader provider regression covering drag/drop, selection, zoom, and reset with ChatGPT, Claude, Gemini, and one Chinese provider.
3. Confirm `Right Ctrl + Enter` sends quickly.
4. Trigger or inspect GitHub Actions for `v0.1.2` to confirm Windows artifacts are generated.
5. If the UI is accepted, merge `codex/newUI` into the main release branch.
