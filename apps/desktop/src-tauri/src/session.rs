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

pub fn session_if_present(slot: &mut Option<OpenSession>) -> Option<OpenSession> {
  if slot.as_ref().is_some_and(|session| !Path::new(&session.project_path).is_dir()) {
    *slot = None;
  }
  slot.clone()
}

#[tauri::command]
pub fn session_set(state: State<LaunchMemory>, session: Option<OpenSession>) {
  *state.session.lock().expect("session lock") = session;
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
