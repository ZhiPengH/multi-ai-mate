use tauri::Manager;
use std::sync::mpsc;
use std::time::Duration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      panel_webview_reload,
      panel_webview_focus,
      panel_webview_send,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn panel_webview_reload(app: tauri::AppHandle, label: String) -> Result<(), String> {
  let webview = app
    .get_webview(&label)
    .ok_or_else(|| format!("WebView not found: {label}"))?;
  webview.reload().map_err(|error| error.to_string())
}

#[tauri::command]
fn panel_webview_focus(app: tauri::AppHandle, label: String) -> Result<(), String> {
  let webview = app
    .get_webview(&label)
    .ok_or_else(|| format!("WebView not found: {label}"))?;
  webview.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn panel_webview_send(
  app: tauri::AppHandle,
  label: String,
  text: String,
  auto_submit: bool,
) -> Result<String, String> {
  let webview = app
    .get_webview(&label)
    .ok_or_else(|| format!("WebView not found: {label}"))?;
  let script = build_send_script(&text, auto_submit)?;
  let (tx, rx) = mpsc::channel();
  webview
    .eval_with_callback(script, move |result| {
      let _ = tx.send(result);
    })
    .map_err(|error| error.to_string())?;

  rx
    .recv_timeout(Duration::from_secs(2))
    .map_err(|error| format!("Timed out waiting for WebView send result: {error}"))
}

fn build_send_script(text: &str, auto_submit: bool) -> Result<String, String> {
  let text_json = serde_json::to_string(text).map_err(|error| error.to_string())?;
  let auto_submit_json = serde_json::to_string(&auto_submit).map_err(|error| error.to_string())?;

  Ok(format!(
    r#"
(() => {{
  const text = {text_json};
  const autoSubmit = {auto_submit_json};

  const isVisible = (element) => {{
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      rect.width > 4 &&
      rect.height > 4 &&
      !element.closest('[aria-hidden="true"], [hidden]');
  }};

  const setValue = (element, value) => {{
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
  }};

  const inputSelectors = [
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[role="textbox"]',
    'input[type="text"]:not([disabled])',
    'input:not([type]):not([disabled])'
  ];

  const inputs = inputSelectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter(isVisible)
    .filter((element) => !element.matches('input[type="search"], input[type="email"], input[type="password"]'));

  const input = inputs.sort((a, b) => {{
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return (br.width * br.height) - (ar.width * ar.height);
  }})[0];

  if (!input) return {{ ok: false, reason: 'input-not-found' }};

  input.focus();

  if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {{
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertText', false, text);
  }} else {{
    setValue(input, text);
  }}

  for (const eventName of ['beforeinput', 'input']) {{
    input.dispatchEvent(new InputEvent(eventName, {{
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }}));
  }}
  input.dispatchEvent(new Event('change', {{ bubbles: true }}));

  if (!autoSubmit) return {{ ok: true, submitted: false }};

  window.setTimeout(() => {{
    const buttonSelectors = [
      'button:not([disabled])',
      '[role="button"]:not([aria-disabled="true"])',
      '[data-testid*="send"]:not([disabled])',
      '[aria-label*="Send"]:not([disabled])',
      '[aria-label*="发送"]:not([disabled])',
      '[title*="Send"]:not([disabled])',
      '[title*="发送"]:not([disabled])'
    ];

    const buttons = buttonSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(isVisible);

    const scoreButton = (button) => {{
      const label = [
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
        button.getAttribute('data-testid'),
        button.textContent,
      ].filter(Boolean).join(' ').toLowerCase();
      let score = 0;
      if (/send|submit|发送|提交|arrow-up|paper-airplane/.test(label)) score += 20;
      const rect = button.getBoundingClientRect();
      score += Math.min(rect.width * rect.height / 100, 10);
      score += Math.max(0, window.innerHeight - rect.top) / 100;
      return score;
    }};

    const sendButton = buttons.sort((a, b) => scoreButton(b) - scoreButton(a))[0];
    if (sendButton) sendButton.click();
  }}, 180);

  return {{ ok: true, submitted: true }};
}})();
"#
  ))
}

#[cfg(test)]
mod tests {
  use super::build_send_script;

  #[test]
  fn send_script_serializes_user_text_safely() {
    let script = build_send_script("中文 \"quote\"\n<script>", true).expect("script");

    assert!(script.contains(r#"const autoSubmit = true;"#));
    assert!(script.contains(r#"中文 \"quote\"\n<script>"#));
    assert!(script.contains("input-not-found"));
  }
}
