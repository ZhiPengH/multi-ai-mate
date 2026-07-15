use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
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

#[derive(Default)]
pub struct PanelZoomState {
    percentages: Mutex<HashMap<String, u16>>,
}

impl PanelZoomState {
    fn current_percent(&self, label: &str) -> Result<u16, String> {
        let percentages = self
            .percentages
            .lock()
            .map_err(|_| "Zoom state lock poisoned".to_string())?;
        Ok(*percentages.get(label).unwrap_or(&DEFAULT_ZOOM_PERCENT))
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
        .emit_to(
            EventTarget::webview("main"),
            PANEL_SELECTED_EVENT,
            label.to_string(),
        )
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
        next_zoom_percent, valid_bounds, valid_panel_label, valid_panel_url, PanelBounds,
        ZoomAction, PANEL_INIT_SCRIPT,
    };

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
