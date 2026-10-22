use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

/// Project open for this process. A webview reload keeps it; exiting the app drops it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenSession {
  pub mode: String,
  pub project_path: String,
  pub name: String,
  pub kind: String,
  pub module_path: Option<String>,
  pub module_editable: bool,
}

/// Open project for this process. Not written to disk, so it is gone when the app exits.
#[derive(Default)]
pub struct LaunchMemory {
  session: Mutex<Option<OpenSession>>,
}

impl LaunchMemory {
  pub fn is_open(&self) -> bool {
    self.session.lock().map(|slot| slot.is_some()).unwrap_or(false)
  }
}

pub fn session_if_present(slot: &mut Option<OpenSession>) -> Option<OpenSession> {
  if slot.as_ref().is_some_and(|session| !Path::new(&session.project_path).is_dir()) {
    *slot = None;
  }
  slot.clone()
}

const CLOSE_PROJECT_ID: &str = "close-project";

/// The item lives inside the File submenu. The top-level menu lookup does not see it.
pub fn set_close_project_enabled(app: &tauri::AppHandle, enabled: bool) {
  let Some(menu) = app.menu() else { return };
  let Ok(items) = menu.items() else { return };
  for item in items {
    let Some(submenu) = item.as_submenu() else { continue };
    let Some(kind) = submenu.get(CLOSE_PROJECT_ID) else { continue };
    if let Some(entry) = kind.as_menuitem() {
      let _ = entry.set_enabled(enabled);
      return;
    }
  }
}

/// Let the webview load `{dir}/images/*` through the asset protocol. The scope starts empty and only
/// ever grows by the folders of projects opened in this process; Tauri has no call to shrink it again.
fn allow_image_dir(app: &tauri::AppHandle, dir: &str) {
  use tauri::Manager;
  // Requests are canonicalized before the scope check, so the pattern must be too (`/var` → `/private/var`).
  // `images/` may not exist yet; canonicalize the project folder and append it.
  let root = std::fs::canonicalize(dir).unwrap_or_else(|_| Path::new(dir).to_path_buf());
  let images = root.join("images");
  if let Err(err) = app.asset_protocol_scope().allow_directory(&images, false) {
    eprintln!("[RUST] asset scope: cannot allow {}: {err}", images.display());
  }
}

#[tauri::command]
pub fn session_set(app: tauri::AppHandle, state: State<LaunchMemory>, session: Option<OpenSession>) {
  let enabled = session.is_some();
  if let Some(open) = &session {
    allow_image_dir(&app, &open.project_path);
    if let Some(module) = &open.module_path {
      allow_image_dir(&app, module);
    }
  }
  *state.session.lock().expect("session lock") = session;
  set_close_project_enabled(&app, enabled);
}

#[tauri::command]
pub fn session_get(state: State<LaunchMemory>) -> Option<OpenSession> {
  let mut slot = state.session.lock().expect("session lock");
  session_if_present(&mut slot)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample(path: &str) -> OpenSession {
    OpenSession {
      mode: "prep".into(),
      project_path: path.into(),
      name: "scenario".into(),
      kind: "scenario".into(),
      module_path: None,
      module_editable: true,
    }
  }

  #[test]
  fn missing_directory_clears_session() {
    let mut slot = Some(sample("/no/such/easykeeper-session-dir"));
    assert!(session_if_present(&mut slot).is_none());
    assert!(slot.is_none());
  }

  #[test]
  fn existing_directory_keeps_session() {
    let mut slot = Some(sample(&std::env::temp_dir().to_string_lossy()));
    let kept = session_if_present(&mut slot);
    assert_eq!(kept.as_ref().map(|session| session.name.as_str()), Some("scenario"));
    assert!(slot.is_some());
  }
}
