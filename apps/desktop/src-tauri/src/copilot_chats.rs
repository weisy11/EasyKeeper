//! Copilot transcripts live beside the app config, not inside a scenario project.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DIR_NAME: &str = "copilot-chats";
const MODULE_FILE: &str = "copilot-chat.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    /// Full model prompt for a user turn. Kept out of the chat transcript view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thought_seconds: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRecord {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub messages: Vec<ChatMessage>,
    /// Scenario this chat was started in. Empty for chats created before the field existed.
    #[serde(default)]
    pub module_path: String,
    #[serde(default)]
    pub module_name: String,
    /// Provider service name and model id last used for this chat.
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

fn chats_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?.join(DIR_NAME);
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

fn chat_path(dir: &PathBuf, id: &str) -> Result<PathBuf, String> {
    if !safe_id(id) {
        return Err("bad-id".into());
    }
    Ok(dir.join(format!("{id}.json")))
}

#[tauri::command]
pub fn copilot_chat_list(app: AppHandle) -> Result<Vec<ChatSummary>, String> {
    let dir = chats_dir(&app)?;
    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let Ok(chat) = serde_json::from_str::<ChatRecord>(&text) else {
            continue;
        };
        if chat.messages.is_empty() {
            continue;
        }
        items.push(ChatSummary { id: chat.id, title: chat.title, updated_at: chat.updated_at });
    }
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

#[tauri::command]
pub fn copilot_chat_load(app: AppHandle, id: String) -> Result<ChatRecord, String> {
    let path = chat_path(&chats_dir(&app)?, id.trim())?;
    let text = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn copilot_chat_save(app: AppHandle, chat: ChatRecord) -> Result<(), String> {
    let dir = chats_dir(&app)?;
    let path = chat_path(&dir, chat.id.trim())?;
    let text = serde_json::to_string_pretty(&chat).map_err(|err| err.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|err| err.to_string())?;
    fs::rename(&temp, &path).map_err(|err| err.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModuleChatPointer {
    last_chat_id: String,
}

fn module_chat_file(module_path: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(module_path.trim());
    if module_path.trim().is_empty() || !dir.is_dir() {
        return Err("missing module".into());
    }
    Ok(dir.join(MODULE_FILE))
}

/// Chat id the module last had open. Missing file or a bad id is "no chat".
#[tauri::command]
pub fn copilot_module_chat_get(module_path: String) -> Result<Option<String>, String> {
    let path = match module_chat_file(&module_path) {
        Ok(path) => path,
        Err(_) => return Ok(None),
    };
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) => return Ok(None),
    };
    let pointer: ModuleChatPointer = serde_json::from_str(&text).map_err(|err| err.to_string())?;
    let id = pointer.last_chat_id.trim();
    if safe_id(id) { Ok(Some(id.to_string())) } else { Ok(None) }
}

#[tauri::command]
pub fn copilot_module_chat_set(module_path: String, chat_id: String) -> Result<(), String> {
    let id = chat_id.trim();
    if !safe_id(id) {
        return Err("bad-id".into());
    }
    let path = module_chat_file(&module_path)?;
    let text = serde_json::to_string_pretty(&ModuleChatPointer { last_chat_id: id.to_string() }).map_err(|err| err.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|err| err.to_string())?;
    fs::rename(&temp, &path).map_err(|err| err.to_string())?;
    Ok(())
}
