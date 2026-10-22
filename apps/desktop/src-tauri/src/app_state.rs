//! UI configuration that used to live in the webview's localStorage.
//! One JSON object in the app config directory, keyed like `ek.settings`.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "app-state.json";

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(FILE_NAME))
}

#[tauri::command]
pub fn app_state_load(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn app_state_save(app: AppHandle, state: HashMap<String, String>) -> Result<(), String> {
    let path = state_path(&app)?;
    let text = serde_json::to_string_pretty(&state).map_err(|err| err.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|err| err.to_string())?;
    fs::rename(&temp, &path).map_err(|err| err.to_string())?;
    Ok(())
}
