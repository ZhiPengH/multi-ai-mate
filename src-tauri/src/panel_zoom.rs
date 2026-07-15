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

    #[test]
    fn initialization_script_requires_exclusive_platform_modifier() {
        assert!(PANEL_INIT_SCRIPT.contains(
            "isMac ? (event.metaKey && !event.ctrlKey) : (event.ctrlKey && !event.metaKey)"
        ));
        assert!(PANEL_INIT_SCRIPT.contains("if (!primaryModifier || event.altKey) return;"));
    }
}
