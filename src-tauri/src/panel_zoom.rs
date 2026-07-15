use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Mutex, MutexGuard},
};
use tauri::{
    webview::WebviewBuilder, AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize,
    Manager, State, Url, Webview, WebviewUrl,
};

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
    const primaryModifier = isMac ? (event.metaKey && !event.ctrlKey) : (event.ctrlKey && !event.metaKey);
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

pub struct PanelZoomState {
    percentages: [Mutex<u16>; 4],
}

impl Default for PanelZoomState {
    fn default() -> Self {
        Self {
            percentages: std::array::from_fn(|_| Mutex::new(DEFAULT_ZOOM_PERCENT)),
        }
    }
}

impl PanelZoomState {
    fn lock_percent(&self, label: &str) -> Result<MutexGuard<'_, u16>, String> {
        let index = panel_index(label).ok_or_else(|| format!("Invalid panel label: {label}"))?;
        self.percentages[index]
            .lock()
            .map_err(|_| format!("Zoom state lock poisoned: {label}"))
    }
}

fn panel_index(label: &str) -> Option<usize> {
    match label {
        "ai-panel-a" => Some(0),
        "ai-panel-b" => Some(1),
        "ai-panel-c" => Some(2),
        "ai-panel-d" => Some(3),
        _ => None,
    }
}

fn valid_panel_label(label: &str) -> bool {
    matches!(
        label,
        "ai-panel-a" | "ai-panel-b" | "ai-panel-c" | "ai-panel-d"
    )
}

fn next_zoom_percent(current: u16, action: ZoomAction) -> u16 {
    match action {
        ZoomAction::In => current
            .saturating_add(ZOOM_STEP_PERCENT)
            .min(MAX_ZOOM_PERCENT),
        ZoomAction::Out => current
            .saturating_sub(ZOOM_STEP_PERCENT)
            .max(MIN_ZOOM_PERCENT),
        ZoomAction::Reset => DEFAULT_ZOOM_PERCENT,
    }
}

fn apply_zoom_percent(
    state: &PanelZoomState,
    label: &str,
    action: ZoomAction,
    set_zoom: impl FnOnce(f64) -> Result<(), String>,
) -> Result<u16, String> {
    let mut current = state.lock_percent(label)?;
    let next = next_zoom_percent(*current, action);

    if next != *current {
        set_zoom(f64::from(next) / 100.0)?;
        *current = next;
    }

    Ok(next)
}

fn restore_zoom_percent(
    state: &PanelZoomState,
    label: &str,
    set_zoom: impl FnOnce(f64) -> Result<(), String>,
) -> Result<(), String> {
    let current = state.lock_percent(label)?;
    let result = set_zoom(f64::from(*current) / 100.0);
    drop(current);
    result
}

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

fn duplicate_panel_label(labels: &[String]) -> Option<&str> {
    let mut seen = HashSet::with_capacity(labels.len());
    labels
        .iter()
        .find_map(|label| (!seen.insert(label.as_str())).then_some(label.as_str()))
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
        .emit_to(
            EventTarget::webview("main"),
            PANEL_SELECTED_EVENT,
            label.to_string(),
        )
        .map_err(|error| error.to_string())
}

fn replace_existing_panel_webview<T>(
    existing: Option<T>,
    close_existing: impl FnOnce(T) -> Result<(), String>,
    create: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if let Some(existing) = existing {
        close_existing(existing)?;
    }
    create()
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
    apply_zoom_percent(state, label, action, |scale| {
        webview.set_zoom(scale).map_err(|error| error.to_string())
    })
}

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
    let parsed_url = url.parse::<Url>().map_err(|error| error.to_string())?;
    replace_existing_panel_webview(
        caller.get_webview(&label),
        |existing| existing.close().map_err(|error| error.to_string()),
        || {
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
            restore_zoom_percent(&state, &label, |scale| {
                child.set_zoom(scale).map_err(|error| error.to_string())
            })
        },
    )
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
    if let Some(label) = duplicate_panel_label(&labels) {
        return Err(format!("Duplicate panel label: {label}"));
    }

    Ok(labels
        .into_iter()
        .map(
            |label| match apply_zoom(caller.app_handle(), &state, &label, action) {
                Ok(percent) => PanelZoomResult {
                    label,
                    percent: Some(percent),
                    error: None,
                },
                Err(error) => PanelZoomResult {
                    label,
                    percent: None,
                    error: Some(error),
                },
            },
        )
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_zoom_percent, duplicate_panel_label, next_zoom_percent, restore_zoom_percent,
        replace_existing_panel_webview, valid_bounds, valid_panel_label, valid_panel_url,
        PanelBounds, PanelZoomState, ZoomAction, PANEL_INIT_SCRIPT,
    };
    use serde_json::Value;
    use std::{
        collections::BTreeMap,
        fs,
        path::PathBuf,
        sync::{mpsc, Arc, Mutex},
        thread,
        time::Duration,
    };
    use tauri::utils::acl::RemoteUrlPattern;

    fn read_project_json(relative_path: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative_path);
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
        serde_json::from_str(&contents)
            .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
    }

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
    fn only_http_panel_urls_are_accepted() {
        assert!(valid_panel_url("https://chatgpt.com"));
        assert!(valid_panel_url("http://localhost:3000"));
        assert!(!valid_panel_url("file:///tmp/panel.html"));
        assert!(!valid_panel_url("not a url"));
    }

    #[test]
    fn panel_bounds_must_be_finite_and_positive() {
        assert!(valid_bounds(&PanelBounds {
            x: 1.0,
            y: 2.0,
            width: 800.0,
            height: 600.0,
        }));
        assert!(!valid_bounds(&PanelBounds {
            x: 1.0,
            y: 2.0,
            width: 0.0,
            height: 600.0,
        }));
        assert!(!valid_bounds(&PanelBounds {
            x: f64::NAN,
            y: 2.0,
            width: 800.0,
            height: 600.0,
        }));
    }

    #[test]
    fn existing_panel_is_replaced_and_close_errors_stop_creation() {
        let events = std::cell::RefCell::new(Vec::new());
        let result = replace_existing_panel_webview(
            Some("old"),
            |existing| {
                events.borrow_mut().push(format!("close:{existing}"));
                Ok(())
            },
            || {
                events.borrow_mut().push("create".to_string());
                Ok(())
            },
        );
        assert_eq!(result, Ok(()));
        assert_eq!(*events.borrow(), ["close:old", "create"]);

        let mut create_without_existing = false;
        assert_eq!(
            replace_existing_panel_webview(
                Option::<&str>::None,
                |_| panic!("no existing panel should be closed"),
                || {
                    create_without_existing = true;
                    Ok(())
                },
            ),
            Ok(())
        );
        assert!(create_without_existing);

        let mut created_after_failure = false;
        assert_eq!(
            replace_existing_panel_webview(
                Some("old"),
                |_| Err("close failed".to_string()),
                || {
                    created_after_failure = true;
                    Ok(())
                },
            ),
            Err("close failed".to_string())
        );
        assert!(!created_after_failure);
    }

    #[test]
    fn remote_panel_capability_grants_only_selection_and_single_zoom() {
        let capability = read_project_json("capabilities/remote-panels.json");

        assert_eq!(capability["local"], false);
        assert!(capability.get("windows").is_none());
        assert_eq!(capability["webviews"], serde_json::json!(["ai-panel-*"]));
        assert_eq!(
            capability["permissions"],
            serde_json::json!([
                "allow-panel-webview-select",
                "allow-panel-webview-zoom-shortcut"
            ])
        );

        let url_patterns = capability["remote"]["urls"]
            .as_array()
            .expect("remote URL patterns")
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .expect("URL pattern string")
                    .parse::<RemoteUrlPattern>()
                    .expect("valid URL pattern")
            })
            .collect::<Vec<_>>();
        for allowed in [
            "http://localhost:3000/chat",
            "https://chatgpt.com/",
            "https://custom-provider.example/path?q=1",
        ] {
            let url = allowed.parse().expect("allowed URL");
            assert!(url_patterns.iter().any(|pattern| pattern.test(&url)));
        }
        let file_url = "file:///tmp/panel.html".parse().expect("file URL");
        assert!(!url_patterns.iter().any(|pattern| pattern.test(&file_url)));
    }

    #[test]
    fn main_capability_retains_only_required_local_panel_commands() {
        let capability = read_project_json("capabilities/default.json");
        let app_permissions = capability["permissions"]
            .as_array()
            .expect("main permissions")
            .iter()
            .map(|value| value.as_str().expect("permission string"))
            .filter(|permission| !permission.starts_with("core:"))
            .collect::<Vec<_>>();

        assert_eq!(
            app_permissions,
            [
                "allow-panel-webview-reload",
                "allow-panel-webview-focus",
                "allow-panel-webview-send",
                "allow-panel-webview-create",
                "allow-panel-webview-zoom-many",
            ]
        );
    }

    #[test]
    fn app_permissions_map_exactly_to_registered_panel_commands() {
        let manifest = read_project_json("permissions/panel-commands.json");
        let permissions = manifest["permission"]
            .as_array()
            .expect("app command permissions");
        let actual = permissions
            .iter()
            .map(|permission| {
                let identifier = permission["identifier"]
                    .as_str()
                    .expect("permission identifier");
                let commands = permission["commands"]["allow"]
                    .as_array()
                    .expect("allowed commands");
                assert_eq!(commands.len(), 1);
                (
                    identifier.to_string(),
                    commands[0].as_str().expect("allowed command").to_string(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let expected = [
            ("allow-panel-webview-create", "panel_webview_create"),
            ("allow-panel-webview-focus", "panel_webview_focus"),
            ("allow-panel-webview-reload", "panel_webview_reload"),
            ("allow-panel-webview-select", "panel_webview_select"),
            ("allow-panel-webview-send", "panel_webview_send"),
            ("allow-panel-webview-zoom-many", "panel_webview_zoom_many"),
            (
                "allow-panel-webview-zoom-shortcut",
                "panel_webview_zoom_shortcut",
            ),
        ]
        .into_iter()
        .map(|(permission, command)| (permission.to_string(), command.to_string()))
        .collect::<BTreeMap<_, _>>();

        assert_eq!(actual, expected);
    }

    #[test]
    fn restore_and_zoom_update_are_serialized_for_the_same_panel() {
        let state = Arc::new(PanelZoomState::default());
        assert_eq!(
            apply_zoom_percent(&state, "ai-panel-a", ZoomAction::In, |_| Ok(())),
            Ok(110)
        );

        let zoom_calls = Arc::new(Mutex::new(Vec::new()));
        let (restore_started_tx, restore_started_rx) = mpsc::channel();
        let (release_restore_tx, release_restore_rx) = mpsc::channel();
        let restore_state = Arc::clone(&state);
        let restore_calls = Arc::clone(&zoom_calls);
        let restore_thread = thread::spawn(move || {
            restore_zoom_percent(&restore_state, "ai-panel-a", |scale| {
                restore_calls
                    .lock()
                    .expect("restore calls lock")
                    .push(scale);
                restore_started_tx.send(()).expect("restore started");
                release_restore_rx
                    .recv_timeout(Duration::from_secs(1))
                    .expect("release restore");
                Ok(())
            })
        });

        restore_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("restore reached native zoom while holding the slot lock");

        let (update_attempted_tx, update_attempted_rx) = mpsc::channel();
        let (update_entered_tx, update_entered_rx) = mpsc::channel();
        let update_state = Arc::clone(&state);
        let update_calls = Arc::clone(&zoom_calls);
        let update_thread = thread::spawn(move || {
            update_attempted_tx.send(()).expect("update attempted");
            apply_zoom_percent(&update_state, "ai-panel-a", ZoomAction::In, |scale| {
                update_calls.lock().expect("update calls lock").push(scale);
                update_entered_tx.send(()).expect("update entered");
                Ok(())
            })
        });

        update_attempted_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("update thread started");
        assert!(
            update_entered_rx
                .recv_timeout(Duration::from_millis(100))
                .is_err(),
            "same-panel update entered while restore still owned the serial boundary"
        );

        release_restore_tx.send(()).expect("release restore");
        assert_eq!(restore_thread.join().expect("restore thread"), Ok(()));
        assert_eq!(update_thread.join().expect("update thread"), Ok(120));
        assert_eq!(*zoom_calls.lock().expect("zoom calls lock"), vec![1.1, 1.2]);
    }

    #[test]
    fn duplicate_panel_labels_are_detected_before_batch_zoom() {
        let unique = vec!["ai-panel-a".to_string(), "ai-panel-b".to_string()];
        assert_eq!(duplicate_panel_label(&unique), None);

        let duplicate = vec![
            "ai-panel-a".to_string(),
            "ai-panel-b".to_string(),
            "ai-panel-a".to_string(),
        ];
        assert_eq!(duplicate_panel_label(&duplicate), Some("ai-panel-a"));
    }

    #[test]
    fn initialization_script_reports_selection_and_intercepts_zoom() {
        assert!(PANEL_INIT_SCRIPT.contains("panel_webview_select"));
        assert!(PANEL_INIT_SCRIPT.contains("panel_webview_zoom_shortcut"));
        assert!(PANEL_INIT_SCRIPT.contains("preventDefault"));
        assert!(PANEL_INIT_SCRIPT.contains("stopImmediatePropagation"));
    }

    #[test]
    fn initialization_script_requires_exclusive_platform_modifier() {
        assert!(PANEL_INIT_SCRIPT.contains(
            "isMac ? (event.metaKey && !event.ctrlKey) : (event.ctrlKey && !event.metaKey)"
        ));
        assert!(PANEL_INIT_SCRIPT.contains("if (!primaryModifier || event.altKey) return;"));
    }
}
