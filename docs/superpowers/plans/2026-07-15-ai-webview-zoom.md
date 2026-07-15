# AI WebView Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add app-scoped keyboard zoom that targets one selected AI WebView or all open AI WebViews while leaving the Multi AI Mate shell unchanged.

**Architecture:** Keep zoom state in a focused Tauri backend module and create panel WebViews through that module so a navigation-persistent initialization script can report panel clicks and intercept zoom shortcuts inside remote pages. Keep target selection and shell interaction state in React, with pure TypeScript helpers for shortcut parsing, target routing, label mapping, and selection normalization.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, Tauri 2.11, Rust, CSS.

## Global Constraints

- macOS shortcuts are `Command + -`, `Command + +`/`Command + =`, and `Command + 0`; Windows/Linux use `Ctrl`.
- Each zoom step is exactly 10 percentage points, clamped to 50%–200%.
- A selected open panel receives the shortcut alone; no selection means every open and visible panel receives the action.
- Global in/out preserves relative differences; global reset sets every target to 100%.
- Sidebar, title bar, panel geometry, and composer never zoom.
- Selection clears when the selected panel closes or becomes hidden.
- Zoom survives provider replacement in the same slot for the current process only and resets to 100% after app restart.
- Do not add a system-global shortcut, settings screen, permanent percentage label, or new dependency.
- Do not stage or commit the unrelated `AGENTS.md` change.

---

## File Structure

- Create `src/zoomModel.ts`: pure shortcut, target, label, and selection helpers shared by the React app and WebView hook.
- Create `src/zoomModel.test.ts`: Vitest coverage for every routing and parsing rule.
- Create `src-tauri/src/panel_zoom.rs`: Rust zoom state, injected bridge script, secure caller validation, child WebView creation, and zoom commands.
- Modify `src-tauri/src/lib.rs`: register the module, managed state, and commands.
- Modify `src/useTauriPanelWebviews.ts`: use backend-created child WebViews, listen for panel selection events, and expose multi-panel zoom.
- Modify `src/App.tsx`: own selected-slot state, route outer-shell shortcuts, clear/select targets, and add the selected class.
- Modify `src/styles.css`: render the non-layout-shifting selected-panel highlight.
- Modify `docs/PROJECT_HANDOFF.md`: record the delivered behavior and verification boundary.

---

### Task 1: Pure frontend zoom routing model

**Files:**
- Create: `src/zoomModel.ts`
- Create: `src/zoomModel.test.ts`

**Interfaces:**
- Consumes: `SlotId` from `src/appModel.ts`.
- Produces: `ZoomAction`, `PANEL_SELECTED_EVENT`, `panelWebviewLabel(slot)`, `slotFromPanelWebviewLabel(label)`, `zoomActionFromKeyboardEvent(event)`, `zoomTargetSlots(selectedSlot, openSlots)`, and `normalizeSelectedSlot(selectedSlot, openSlots)`.

- [ ] **Step 1: Write the failing model tests**

Create `src/zoomModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  normalizeSelectedSlot,
  panelWebviewLabel,
  slotFromPanelWebviewLabel,
  zoomActionFromKeyboardEvent,
  zoomTargetSlots,
} from './zoomModel';

const shortcut = (key: string, overrides: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

describe('zoom model', () => {
  it('parses only supported primary-modifier zoom shortcuts', () => {
    expect(zoomActionFromKeyboardEvent(shortcut('-', { metaKey: true }))).toBe('out');
    expect(zoomActionFromKeyboardEvent(shortcut('=', { metaKey: true }))).toBe('in');
    expect(zoomActionFromKeyboardEvent(shortcut('+', { ctrlKey: true }))).toBe('in');
    expect(zoomActionFromKeyboardEvent(shortcut('0', { metaKey: true }))).toBe('reset');
    expect(zoomActionFromKeyboardEvent(shortcut('-', { altKey: true, metaKey: true }))).toBeNull();
    expect(zoomActionFromKeyboardEvent(shortcut('-'))).toBeNull();
  });

  it('targets one valid selection or every open slot in global mode', () => {
    expect(zoomTargetSlots('B', ['A', 'B'])).toEqual(['B']);
    expect(zoomTargetSlots(null, ['A', 'B'])).toEqual(['A', 'B']);
    expect(zoomTargetSlots('C', ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('maps only known panel labels to slots', () => {
    expect(panelWebviewLabel('D')).toBe('ai-panel-d');
    expect(slotFromPanelWebviewLabel('ai-panel-a')).toBe('A');
    expect(slotFromPanelWebviewLabel('ai-panel-d')).toBe('D');
    expect(slotFromPanelWebviewLabel('main')).toBeNull();
    expect(slotFromPanelWebviewLabel('ai-panel-e')).toBeNull();
  });

  it('clears a selection that is no longer open and visible', () => {
    expect(normalizeSelectedSlot('A', ['A', 'B'])).toBe('A');
    expect(normalizeSelectedSlot('C', ['A', 'B'])).toBeNull();
    expect(normalizeSelectedSlot(null, ['A', 'B'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/zoomModel.test.ts`

Expected: FAIL because `./zoomModel` does not exist.

- [ ] **Step 3: Implement the pure model**

Create `src/zoomModel.ts`:

```ts
import type { SlotId } from './appModel';

export type ZoomAction = 'in' | 'out' | 'reset';

type ZoomKeyboardEvent = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

export const PANEL_SELECTED_EVENT = 'ai-panel-selected';

export function panelWebviewLabel(slot: SlotId) {
  return `ai-panel-${slot.toLowerCase()}`;
}

export function slotFromPanelWebviewLabel(label: string): SlotId | null {
  const match = /^ai-panel-([a-d])$/.exec(label);
  return match ? (match[1].toUpperCase() as SlotId) : null;
}

export function zoomActionFromKeyboardEvent(event: ZoomKeyboardEvent): ZoomAction | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === '-') return 'out';
  if (event.key === '=' || event.key === '+') return 'in';
  if (event.key === '0') return 'reset';
  return null;
}

export function zoomTargetSlots(selectedSlot: SlotId | null, openSlots: SlotId[]): SlotId[] {
  return selectedSlot && openSlots.includes(selectedSlot) ? [selectedSlot] : [...openSlots];
}

export function normalizeSelectedSlot(selectedSlot: SlotId | null, openSlots: SlotId[]): SlotId | null {
  return selectedSlot && openSlots.includes(selectedSlot) ? selectedSlot : null;
}
```

- [ ] **Step 4: Run focused and full frontend tests**

Run: `npm test -- src/zoomModel.test.ts && npm test`

Expected: the new zoom-model tests PASS and the full Vitest suite PASS.

- [ ] **Step 5: Commit the pure model**

```bash
git add src/zoomModel.ts src/zoomModel.test.ts
git commit -m "test: define AI panel zoom routing"
```

---

### Task 2: Rust zoom domain and navigation-persistent bridge

**Files:**
- Create: `src-tauri/src/panel_zoom.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: no earlier runtime code; only `serde` and standard-library types already present.
- Produces: `PanelZoomState`, `ZoomAction`, `PanelBounds`, `PanelZoomResult`, `PANEL_SELECTED_EVENT`, `PANEL_INIT_SCRIPT`, `valid_panel_label`, and `next_zoom_percent` for the Tauri commands in Task 3.

- [ ] **Step 1: Add failing Rust unit tests and module declaration**

Add `mod panel_zoom;` at the top of `src-tauri/src/lib.rs`. Create `src-tauri/src/panel_zoom.rs` with this test module first:

```rust
#[cfg(test)]
mod tests {
  use super::{next_zoom_percent, valid_panel_label, ZoomAction, PANEL_INIT_SCRIPT};

  #[test]
  fn zoom_steps_and_resets_in_ten_percent_points() {
    assert_eq!(next_zoom_percent(100, ZoomAction::In), 110);
    assert_eq!(next_zoom_percent(100, ZoomAction::Out), 90);
    assert_eq!(next_zoom_percent(170, ZoomAction::Reset), 100);
  }

  #[test]
  fn zoom_is_clamped_to_supported_bounds() {
    assert_eq!(next_zoom_percent(200, ZoomAction::In), 200);
    assert_eq!(next_zoom_percent(50, ZoomAction::Out), 50);
  }

  #[test]
  fn only_panel_labels_are_accepted() {
    assert!(valid_panel_label("ai-panel-a"));
    assert!(valid_panel_label("ai-panel-d"));
    assert!(!valid_panel_label("main"));
    assert!(!valid_panel_label("ai-panel-e"));
  }

  #[test]
  fn initialization_script_reports_selection_and_intercepts_zoom() {
    assert!(PANEL_INIT_SCRIPT.contains("panel_webview_select"));
    assert!(PANEL_INIT_SCRIPT.contains("panel_webview_zoom_shortcut"));
    assert!(PANEL_INIT_SCRIPT.contains("preventDefault"));
    assert!(PANEL_INIT_SCRIPT.contains("stopImmediatePropagation"));
  }
}
```

- [ ] **Step 2: Run the Rust test and verify it fails**

Run: `PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml panel_zoom -- --nocapture`

Expected: FAIL with unresolved imports for the zoom helpers and constants.

- [ ] **Step 3: Implement the domain types, state, validation, and injected script**

Place this implementation above the test module in `src-tauri/src/panel_zoom.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};

pub const PANEL_SELECTED_EVENT: &str = "ai-panel-selected";
const DEFAULT_ZOOM_PERCENT: u16 = 100;
const MIN_ZOOM_PERCENT: u16 = 50;
const MAX_ZOOM_PERCENT: u16 = 200;
const ZOOM_STEP_PERCENT: u16 = 10;

pub const PANEL_INIT_SCRIPT: &str = r#"
(() => {
  if (window.__MULTI_AI_MATE_ZOOM_BRIDGE__) return;
  Object.defineProperty(window, '__MULTI_AI_MATE_ZOOM_BRIDGE__', { value: true });

  const invoke = (command, args = {}) => {
    const tauri = window.__TAURI_INTERNALS__;
    if (!tauri || typeof tauri.invoke !== 'function') return;
    tauri.invoke(command, args).catch((error) => console.error('[Multi AI Mate]', error));
  };

  window.addEventListener('pointerdown', () => invoke('panel_webview_select'), true);
  window.addEventListener('keydown', (event) => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
    if (!primaryModifier || event.altKey) return;

    let action = null;
    if (event.key === '-') action = 'out';
    else if (event.key === '=' || event.key === '+') action = 'in';
    else if (event.key === '0') action = 'reset';
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    invoke('panel_webview_zoom_shortcut', { action });
  }, true);
})();
"#;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ZoomAction {
  In,
  Out,
  Reset,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelBounds {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelZoomResult {
  pub label: String,
  pub percent: Option<u16>,
  pub error: Option<String>,
}

#[derive(Default)]
pub struct PanelZoomState {
  percentages: Mutex<HashMap<String, u16>>,
}

impl PanelZoomState {
  fn current_percent(&self, label: &str) -> Result<u16, String> {
    let percentages = self.percentages.lock().map_err(|_| "Zoom state lock poisoned".to_string())?;
    Ok(*percentages.get(label).unwrap_or(&DEFAULT_ZOOM_PERCENT))
  }
}

fn valid_panel_label(label: &str) -> bool {
  matches!(label, "ai-panel-a" | "ai-panel-b" | "ai-panel-c" | "ai-panel-d")
}

fn next_zoom_percent(current: u16, action: ZoomAction) -> u16 {
  match action {
    ZoomAction::In => current.saturating_add(ZOOM_STEP_PERCENT).min(MAX_ZOOM_PERCENT),
    ZoomAction::Out => current.saturating_sub(ZOOM_STEP_PERCENT).max(MIN_ZOOM_PERCENT),
    ZoomAction::Reset => DEFAULT_ZOOM_PERCENT,
  }
}
```

- [ ] **Step 4: Run Rust tests and verify they pass**

Run: `PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml panel_zoom -- --nocapture`

Expected: four `panel_zoom` tests PASS; existing backend tests remain compilable.

- [ ] **Step 5: Commit the tested Rust domain**

```bash
git add src-tauri/src/panel_zoom.rs src-tauri/src/lib.rs
git commit -m "test: define native panel zoom behavior"
```

---

### Task 3: Secure Tauri commands and backend-created panel WebViews

**Files:**
- Modify: `src-tauri/src/panel_zoom.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `PanelZoomState`, `ZoomAction`, `PanelBounds`, `PanelZoomResult`, `PANEL_SELECTED_EVENT`, and `PANEL_INIT_SCRIPT` from Task 2.
- Produces Tauri commands: `panel_webview_create(label, url, bounds)`, `panel_webview_select()`, `panel_webview_zoom_shortcut(action)`, and `panel_webview_zoom_many(labels, action)`.
- Produces event payload: `ai-panel-selected` with a validated label string.

- [ ] **Step 1: Extend Rust tests for state retention and URL/bounds validation helpers**

Add these cases to the existing `panel_zoom` test module, with helper functions `valid_panel_url` and `valid_bounds` referenced before implementation:

First extend the test import to:

```rust
use super::{
  next_zoom_percent, valid_bounds, valid_panel_label, valid_panel_url, PanelBounds,
  ZoomAction, PANEL_INIT_SCRIPT,
};
```

```rust
#[test]
fn only_http_panel_urls_are_accepted() {
  assert!(valid_panel_url("https://chatgpt.com"));
  assert!(valid_panel_url("http://localhost:3000"));
  assert!(!valid_panel_url("file:///tmp/panel.html"));
  assert!(!valid_panel_url("not a url"));
}

#[test]
fn panel_bounds_must_be_finite_and_positive() {
  assert!(valid_bounds(&PanelBounds { x: 1.0, y: 2.0, width: 800.0, height: 600.0 }));
  assert!(!valid_bounds(&PanelBounds { x: 1.0, y: 2.0, width: 0.0, height: 600.0 }));
  assert!(!valid_bounds(&PanelBounds { x: f64::NAN, y: 2.0, width: 800.0, height: 600.0 }));
}
```

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run: `PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml panel_zoom -- --nocapture`

Expected: FAIL because `valid_panel_url` and `valid_bounds` do not exist.

- [ ] **Step 3: Implement validation and zoom application**

Extend imports in `src-tauri/src/panel_zoom.rs`:

```rust
use tauri::{
  webview::WebviewBuilder, AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize,
  Manager, State, Url, Webview, WebviewUrl,
};
```

Add these helpers below `next_zoom_percent`:

```rust
fn valid_panel_url(value: &str) -> bool {
  value
    .parse::<Url>()
    .map(|url| matches!(url.scheme(), "http" | "https"))
    .unwrap_or(false)
}

fn valid_bounds(bounds: &PanelBounds) -> bool {
  [bounds.x, bounds.y, bounds.width, bounds.height]
    .into_iter()
    .all(f64::is_finite)
    && bounds.width > 0.0
    && bounds.height > 0.0
}

fn ensure_main_caller(caller: &Webview) -> Result<(), String> {
  (caller.label() == "main")
    .then_some(())
    .ok_or_else(|| "Only the main WebView may perform this operation".to_string())
}

fn panel_caller_label(caller: &Webview) -> Result<String, String> {
  let label = caller.label();
  valid_panel_label(label)
    .then(|| label.to_string())
    .ok_or_else(|| format!("Invalid panel caller: {label}"))
}

fn emit_selected(caller: &Webview, label: &str) -> Result<(), String> {
  caller
    .emit_to(EventTarget::webview("main"), PANEL_SELECTED_EVENT, label.to_string())
    .map_err(|error| error.to_string())
}

fn apply_zoom(
  app: &AppHandle,
  state: &PanelZoomState,
  label: &str,
  action: ZoomAction,
) -> Result<u16, String> {
  if !valid_panel_label(label) {
    return Err(format!("Invalid panel label: {label}"));
  }

  let webview = app
    .get_webview(label)
    .ok_or_else(|| format!("WebView not found: {label}"))?;
  let mut percentages = state
    .percentages
    .lock()
    .map_err(|_| "Zoom state lock poisoned".to_string())?;
  let current = *percentages.get(label).unwrap_or(&DEFAULT_ZOOM_PERCENT);
  let next = next_zoom_percent(current, action);

  if next != current {
    webview
      .set_zoom(f64::from(next) / 100.0)
      .map_err(|error| error.to_string())?;
    percentages.insert(label.to_string(), next);
  }

  Ok(next)
}
```

- [ ] **Step 4: Implement the four Tauri commands**

Add to `src-tauri/src/panel_zoom.rs`:

```rust
#[tauri::command]
pub async fn panel_webview_create(
  caller: Webview,
  state: State<'_, PanelZoomState>,
  label: String,
  url: String,
  bounds: PanelBounds,
) -> Result<(), String> {
  ensure_main_caller(&caller)?;
  if !valid_panel_label(&label) {
    return Err(format!("Invalid panel label: {label}"));
  }
  if !valid_panel_url(&url) {
    return Err(format!("Invalid panel URL: {url}"));
  }
  if !valid_bounds(&bounds) {
    return Err("Invalid panel bounds".to_string());
  }
  if caller.get_webview(&label).is_some() {
    return Ok(());
  }

  let parsed_url = url.parse::<Url>().map_err(|error| error.to_string())?;
  let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed_url))
    .initialization_script(PANEL_INIT_SCRIPT);
  let child = caller
    .window()
    .add_child(
      builder,
      LogicalPosition::new(bounds.x, bounds.y),
      LogicalSize::new(bounds.width, bounds.height),
    )
    .map_err(|error| error.to_string())?;
  let percent = state.current_percent(&label)?;
  child
    .set_zoom(f64::from(percent) / 100.0)
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn panel_webview_select(caller: Webview) -> Result<(), String> {
  let label = panel_caller_label(&caller)?;
  emit_selected(&caller, &label)
}

#[tauri::command]
pub fn panel_webview_zoom_shortcut(
  caller: Webview,
  state: State<'_, PanelZoomState>,
  action: ZoomAction,
) -> Result<u16, String> {
  let label = panel_caller_label(&caller)?;
  emit_selected(&caller, &label)?;
  apply_zoom(caller.app_handle(), &state, &label, action)
}

#[tauri::command]
pub fn panel_webview_zoom_many(
  caller: Webview,
  state: State<'_, PanelZoomState>,
  labels: Vec<String>,
  action: ZoomAction,
) -> Result<Vec<PanelZoomResult>, String> {
  ensure_main_caller(&caller)?;
  for label in &labels {
    if !valid_panel_label(label) {
      return Err(format!("Invalid panel label: {label}"));
    }
  }

  Ok(labels
    .into_iter()
    .map(|label| match apply_zoom(caller.app_handle(), &state, &label, action) {
      Ok(percent) => PanelZoomResult { label, percent: Some(percent), error: None },
      Err(error) => PanelZoomResult { label, percent: None, error: Some(error) },
    })
    .collect())
}
```

- [ ] **Step 5: Register managed state and commands**

In `src-tauri/src/lib.rs`, add `.manage(panel_zoom::PanelZoomState::default())` before `.invoke_handler(...)`, then include these entries in `tauri::generate_handler!`:

```rust
panel_zoom::panel_webview_create,
panel_zoom::panel_webview_select,
panel_zoom::panel_webview_zoom_shortcut,
panel_zoom::panel_webview_zoom_many,
```

- [ ] **Step 6: Run backend tests and a compile check**

Run:

```bash
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
PATH="$HOME/.cargo/bin:$PATH" cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: every Rust test PASS and `cargo check` exits 0 with no command-signature errors.

- [ ] **Step 7: Commit the native command layer**

```bash
git add src-tauri/src/panel_zoom.rs src-tauri/src/lib.rs
git commit -m "feat: add native AI panel zoom controller"
```

---

### Task 4: Connect the React WebView lifecycle to the native controller

**Files:**
- Modify: `src/useTauriPanelWebviews.ts`

**Interfaces:**
- Consumes: `ZoomAction`, `PANEL_SELECTED_EVENT`, `panelWebviewLabel`, and `slotFromPanelWebviewLabel` from Task 1; four Tauri commands from Task 3.
- Adds optional option: `onPanelSelected?: (slot: SlotId) => void`.
- Adds control: `zoomSlots(targetSlots: SlotId[], action: ZoomAction): Promise<NativeZoomResult[]>`.

- [ ] **Step 1: Replace the local label helper and define result types**

Import the Task 1 interfaces:

```ts
import { listen } from '@tauri-apps/api/event';
import {
  PANEL_SELECTED_EVENT,
  panelWebviewLabel,
  slotFromPanelWebviewLabel,
  type ZoomAction,
} from './zoomModel';
```

Delete the private `webviewLabel` function. Add:

```ts
export type NativeZoomResult = {
  label: string;
  percent: number | null;
  error: string | null;
};
```

Change `TauriPanelWebviewsOptions` and `TauriPanelWebviewControls` to include:

```ts
onPanelSelected?: (slot: SlotId) => void;
zoomSlots: (targetSlots: SlotId[], action: ZoomAction) => Promise<NativeZoomResult[]>;
```

- [ ] **Step 2: Listen for validated native selection events**

Destructure `onPanelSelected` in the hook. Add this effect after `enabled` is initialized and before the WebView sync effect:

```ts
useEffect(() => {
  if (!enabled) return;
  let disposed = false;
  let unlisten: (() => void) | undefined;

  void listen<string>(PANEL_SELECTED_EVENT, (event) => {
    const slot = slotFromPanelWebviewLabel(event.payload);
    if (!disposed && slot) onPanelSelected?.(slot);
  }).then((dispose) => {
    if (disposed) dispose();
    else unlisten = dispose;
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}, [enabled, onPanelSelected]);
```

- [ ] **Step 3: Create child WebViews through the backend**

Inside `syncWebviews`, replace `new Webview(currentWindow, panelWebviewLabel(slot), { url, ...bounds })` with:

```ts
const label = panelWebviewLabel(slot);
await invoke('panel_webview_create', { label, url, bounds });
const webview = await Webview.getByLabel(label);
if (!webview) throw new Error(`Created WebView not found: ${label}`);
```

At the start of `syncWebviews`, also remove the now-unused `@tauri-apps/api/window` dynamic import and `currentWindow` variable. Keep only:

```ts
const [{ Webview }, { LogicalPosition, LogicalSize }] = await Promise.all([
  import('@tauri-apps/api/webview'),
  import('@tauri-apps/api/dpi'),
]);
```

Keep the existing `NativeWebviewEntry`, hide/show, close, resize, reload, and send behavior unchanged.

- [ ] **Step 4: Add the multi-panel zoom control**

Add this callback beside `reloadSlots` and `sendToSlots`:

```ts
const zoomSlots = useCallback(
  async (targetSlots: SlotId[], action: ZoomAction) => {
    if (!enabled) return [];
    const labels = targetSlots
      .filter((slot) => webviewsRef.current.has(slot))
      .map(panelWebviewLabel);
    const results = await invoke<NativeZoomResult[]>('panel_webview_zoom_many', { labels, action });
    const failures = results.filter((result) => result.error);
    if (failures.length) {
      throw new Error(failures.map((result) => `${result.label}: ${result.error}`).join('; '));
    }
    return results;
  },
  [enabled],
);
```

Return `zoomSlots` from the memoized controls object and include it in the memo dependency list.

- [ ] **Step 5: Run type/build and regression checks**

Run:

```bash
npm run build
npm test
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: TypeScript/Vite build PASS, all Vitest tests PASS, and all Rust tests PASS.

- [ ] **Step 6: Commit WebView lifecycle integration**

```bash
git add src/useTauriPanelWebviews.ts
git commit -m "feat: connect panel WebViews to zoom controller"
```

---

### Task 5: Selected-panel UI and outer-shell shortcuts

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `normalizeSelectedSlot`, `zoomActionFromKeyboardEvent`, and `zoomTargetSlots` from Task 1; `onPanelSelected` and `zoomSlots` from Task 4.
- Produces: React state `selectedSlot: SlotId | null` and `Panel` prop `selected: boolean`.

- [ ] **Step 1: Add selected-slot state and native selection callback**

Import the Task 1 helpers:

```ts
import {
  normalizeSelectedSlot,
  zoomActionFromKeyboardEvent,
  zoomTargetSlots,
} from './zoomModel';
```

Add state beside the other UI state:

```ts
const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
```

Pass the stable React setter to the hook:

```ts
const nativeWebviews = useTauriPanelWebviews({
  mode,
  slots,
  providersById,
  panelBodyRefs,
  suspended: Boolean(draggingProvider),
  onPanelSelected: setSelectedSlot,
});
```

- [ ] **Step 2: Normalize selection when slots change**

Add an effect after `openSlots` is computed:

```ts
useEffect(() => {
  setSelectedSlot((current) => normalizeSelectedSlot(current, openSlots));
}, [mode, slots.A.provider, slots.B.provider, slots.C.provider, slots.D.provider]);
```

The effect deliberately depends on the underlying slot/mode fields instead of the newly allocated `openSlots` array.

- [ ] **Step 3: Route zoom shortcuts before existing reload/slot shortcuts**

At the beginning of the existing global `onKeyDown`, after the Right-Control send handling and before `Command/Ctrl + R`, add:

```ts
const zoomAction = zoomActionFromKeyboardEvent(event);
if (zoomAction) {
  event.preventDefault();
  const targets = zoomTargetSlots(selectedSlot, openSlots);
  if (targets.length) {
    void nativeWebviews.zoomSlots(targets, zoomAction).catch((error) => {
      console.error('Failed to zoom native webviews', error);
      showToast('网页缩放失败');
    });
  }
  return;
}
```

Do not alter `Command/Ctrl + R`, numbered reload/close shortcuts, or Right-Control send behavior.

- [ ] **Step 4: Implement click-to-select and click-outer-shell-to-clear**

Add this handler inside `App`:

```ts
function onAppPointerDownCapture(event: PointerEvent<HTMLElement>) {
  const panel = (event.target as Element).closest<HTMLElement>('.panel[data-slot]');
  const slot = panel?.dataset.slot as SlotId | undefined;
  setSelectedSlot(slot && slots[slot].provider && activeSlots.includes(slot) ? slot : null);
}
```

Attach it to the root element:

```tsx
<main
  className={`app ${nativeWebviews.enabled ? 'native-webviews' : ''}`}
  onPointerDownCapture={onAppPointerDownCapture}
>
```

This selects loaded panel headers and browser-preview content, clears on dock/title/composer/empty slots, and leaves native panel-body clicks to the injected bridge.

- [ ] **Step 5: Render the selected class without changing panel layout**

Pass `selected={selectedSlot === slot}` to every `Panel`. Add `selected: boolean` to the component props and update the class expression:

```tsx
className={`panel ${auxiliary ? 'aux' : ''} ${visible ? '' : 'hidden'} ${dropping ? 'drop' : ''} ${
  selected ? 'selected' : ''
}`}
```

Add this rule before `.panel.drop` in `src/styles.css` so drag/drop remains the strongest temporary highlight:

```css
.panel.selected {
  border-color: color-mix(in oklab, var(--accent) 72%, var(--line));
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 7px var(--accent-soft), var(--shadow-panel);
}

.panel.aux.selected {
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 7px var(--accent-soft), var(--shadow-panel-2);
}
```

- [ ] **Step 6: Run frontend and backend verification**

Run:

```bash
npm test
npm run build
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Vitest and Rust tests PASS; the production frontend build exits 0.

- [ ] **Step 7: Commit the user-facing interaction**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: add selected and global AI webpage zoom"
```

---

### Task 6: Desktop verification and project handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

**Interfaces:**
- Consumes: the complete feature from Tasks 1–5.
- Produces: verified macOS desktop behavior, a refreshed package in `release/`, and an updated continuity record.

- [ ] **Step 1: Run the complete automated suite from a clean feature diff**

Run:

```bash
git status --short
npm test
npm run build
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: only the known unrelated `AGENTS.md`, the existing handoff file state, and task-related files appear before commits; all three verification commands exit 0.

- [ ] **Step 2: Build the macOS desktop package**

Run: `PATH="$HOME/.cargo/bin:$PATH" npm run build:desktop`

Expected: Tauri build exits 0 and `release/Multi AI Mate.app` plus a DMG are refreshed.

- [ ] **Step 3: Perform focused desktop interaction checks**

Launch `release/Multi AI Mate.app` and verify this exact sequence:

1. Load two AI providers.
2. Click inside the first remote webpage; only that panel gains the selected border.
3. Press `Command + +`, `Command + -`, and `Command + 0`; only that webpage changes.
4. Set the two panels to different percentages, click the dock, and press `Command + -`; both decrease by one 10-point step while retaining their difference.
5. Press global `Command + 0`; both return to 100%.
6. Confirm title bar, dock, panel geometry, and composer never change size.
7. Refresh/navigate the selected webpage and repeat selection plus zoom.
8. Close or hide the selected slot and confirm the border clears and the next shortcut uses global mode.
9. Repeat until 50% and 200% are reached and confirm the bounds hold.
10. Switch to another macOS app and confirm its normal shortcut behavior is unaffected.

Expected: all ten checks pass. If any check fails, record the exact provider, slot, shortcut, and observed behavior before returning to the relevant earlier task.

- [ ] **Step 4: Update the project handoff with verified facts**

In `docs/PROJECT_HANDOFF.md`:

- Change `Last updated` to `2026-07-15`.
- Add current-state bullets stating that AI webpages support selected/global `Command + -`, `Command + +`/`=`, and `Command + 0`; panel selection is visibly highlighted; and application chrome is not scaled.
- Add `src/zoomModel.ts` and `src-tauri/src/panel_zoom.rs` to “Main Files To Know”.
- Add any desktop verification limitation only if a manual check could not be completed; do not claim an unperformed check passed.

- [ ] **Step 5: Commit only the continuity update**

Run `git status --short`, confirm `AGENTS.md` is not staged, then:

```bash
git add docs/PROJECT_HANDOFF.md
git commit -m "docs: update AI webpage zoom handoff"
```

- [ ] **Step 6: Final diff and history audit**

Run:

```bash
git status --short
git log --oneline -7
git diff 67fb22e..HEAD --stat
```

Expected: `AGENTS.md` remains unstaged; the implementation history contains focused commits for model, Rust behavior, native commands, lifecycle integration, UI interaction, and handoff; no unrelated file is included.
