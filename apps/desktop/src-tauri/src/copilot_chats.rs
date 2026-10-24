//! Copilot transcripts in `app.sqlite`.
//!
//! `copilot_chat` is the history list, `copilot_message` holds one row per turn (append-only:
//! messages are never edited), and `copilot_summary` holds the rolling context summaries. What the
//! panel shows (the newest page plus whatever the user scrolled back to) and what the model gets
//! (the latest summary plus every message after it) are separate reads over the same rows.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const MODULE_FILE: &str = "copilot-chat.json";
/// Messages shown when a chat opens, and per page when scrolling back.
pub const PAGE_SIZE: i64 = 10;

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

/// A message as stored, with its position in the chat.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub pos: i64,
    #[serde(flatten)]
    pub message: ChatMessage,
}

/// Chat-level fields. Sent with every append so the row exists before its first message.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMeta {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub module_path: String,
    #[serde(default)]
    pub module_name: String,
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSummary {
    pub covers_to: i64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOpen {
    #[serde(flatten)]
    pub meta: ChatMeta,
    pub updated_at: i64,
    pub total: i64,
    /// Newest `PAGE_SIZE` messages in chat order.
    pub messages: Vec<StoredMessage>,
    pub summary: Option<ContextSummary>,
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

fn check_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if safe_id(id) { Ok(id) } else { Err("bad-id".into()) }
}

fn row_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredMessage> {
    Ok(StoredMessage {
        pos: row.get(0)?,
        message: ChatMessage {
            id: row.get(1)?,
            role: row.get(2)?,
            text: row.get(3)?,
            prompt: row.get(4)?,
            thinking: row.get(5)?,
            thought_seconds: row.get(6)?,
        },
    })
}

const MESSAGE_COLUMNS: &str = "pos, id, role, text, prompt, thinking, thought_seconds";

pub fn list(conn: &Connection) -> Result<Vec<ChatSummary>, String> {
    let mut statement = conn
        .prepare("SELECT id, title, updated_at FROM copilot_chat WHERE message_count > 0 ORDER BY updated_at DESC")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| Ok(ChatSummary { id: row.get(0)?, title: row.get(1)?, updated_at: row.get(2)? }))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

pub fn latest_summary(conn: &Connection, chat_id: &str) -> Result<Option<ContextSummary>, String> {
    conn.query_row(
        "SELECT covers_to, text FROM copilot_summary WHERE chat_id = ?1 ORDER BY covers_to DESC LIMIT 1",
        params![chat_id],
        |row| Ok(ContextSummary { covers_to: row.get(0)?, text: row.get(1)? }),
    )
    .optional()
    .map_err(|err| err.to_string())
}

/// Messages with `pos > after`, in chat order. `after = -1` returns everything.
pub fn messages_after(conn: &Connection, chat_id: &str, after: i64) -> Result<Vec<StoredMessage>, String> {
    let mut statement = conn
        .prepare(&format!("SELECT {MESSAGE_COLUMNS} FROM copilot_message WHERE chat_id = ?1 AND pos > ?2 ORDER BY pos"))
        .map_err(|err| err.to_string())?;
    let rows = statement.query_map(params![chat_id, after], row_message).map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())
}

/// Up to `limit` messages with `pos < before`, returned in chat order (oldest first).
pub fn messages_before(conn: &Connection, chat_id: &str, before: i64, limit: i64) -> Result<Vec<StoredMessage>, String> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT {MESSAGE_COLUMNS} FROM copilot_message WHERE chat_id = ?1 AND pos < ?2 ORDER BY pos DESC LIMIT ?3"
        ))
        .map_err(|err| err.to_string())?;
    let rows = statement.query_map(params![chat_id, before, limit], row_message).map_err(|err| err.to_string())?;
    let mut page = rows.collect::<Result<Vec<_>, _>>().map_err(|err| err.to_string())?;
    page.reverse();
    Ok(page)
}

pub fn open(conn: &Connection, chat_id: &str) -> Result<Option<ChatOpen>, String> {
    let head = conn
        .query_row(
            "SELECT title, updated_at, module_path, module_name, service, model, message_count FROM copilot_chat WHERE id = ?1",
            params![chat_id],
            |row| {
                Ok((
                    ChatMeta {
                        id: chat_id.to_string(),
                        title: row.get(0)?,
                        module_path: row.get(2)?,
                        module_name: row.get(3)?,
                        service: row.get(4)?,
                        model: row.get(5)?,
                    },
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    let Some((meta, updated_at, total)) = head else { return Ok(None) };
    let messages = messages_before(conn, chat_id, i64::MAX, PAGE_SIZE)?;
    let summary = latest_summary(conn, chat_id)?;
    Ok(Some(ChatOpen { meta, updated_at, total, messages, summary }))
}

/// Remove a chat with everything stored under it. Returns true when a chat row was deleted.
pub fn delete(conn: &Connection, chat_id: &str) -> Result<bool, String> {
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM copilot_summary WHERE chat_id = ?1", params![chat_id]).map_err(|err| err.to_string())?;
    tx.execute("DELETE FROM copilot_message WHERE chat_id = ?1", params![chat_id]).map_err(|err| err.to_string())?;
    let removed = tx.execute("DELETE FROM copilot_chat WHERE id = ?1", params![chat_id]).map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(removed > 0)
}

/// Upsert the chat row and append one message. Returns the message position.
pub fn append(conn: &Connection, meta: &ChatMeta, message: &ChatMessage) -> Result<i64, String> {
    let now = crate::app_db::now_millis();
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO copilot_chat (id, title, updated_at, module_path, module_name, service, model, message_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, updated_at = excluded.updated_at,
           module_path = excluded.module_path, module_name = excluded.module_name,
           service = excluded.service, model = excluded.model",
        params![meta.id, meta.title, now, meta.module_path, meta.module_name, meta.service, meta.model],
    )
    .map_err(|err| err.to_string())?;
    let pos: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(pos), -1) + 1 FROM copilot_message WHERE chat_id = ?1",
            params![meta.id],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO copilot_message (chat_id, pos, id, role, text, prompt, thinking, thought_seconds)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![meta.id, pos, message.id, message.role, message.text, message.prompt, message.thinking, message.thought_seconds],
    )
    .map_err(|err| err.to_string())?;
    tx.execute(
        "UPDATE copilot_chat SET message_count = message_count + 1 WHERE id = ?1",
        params![meta.id],
    )
    .map_err(|err| err.to_string())?;
    tx.commit().map_err(|err| err.to_string())?;
    Ok(pos)
}

pub fn insert_summary(conn: &Connection, chat_id: &str, covers_to: i64, text: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO copilot_summary (chat_id, covers_to, text, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(chat_id, covers_to) DO UPDATE SET text = excluded.text, created_at = excluded.created_at",
        params![chat_id, covers_to, text, crate::app_db::now_millis()],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

/// Rough token count, the same rule as the panel's `estimateTokens`: every non-ASCII character is
/// one token, ASCII counts one token per four characters.
pub fn estimate_tokens(text: &str) -> u64 {
    let mut tokens = 0u64;
    let mut ascii = 0u64;
    for ch in text.chars() {
        if ch.is_ascii() {
            ascii += 1;
        } else {
            tokens += ascii.div_ceil(4);
            ascii = 0;
            tokens += 1;
        }
    }
    tokens + ascii.div_ceil(4)
}

#[tauri::command]
pub async fn copilot_chat_list(app: AppHandle) -> Result<Vec<ChatSummary>, String> {
    crate::blocking::run(move || crate::app_db::with(&app, list)).await
}

#[tauri::command]
pub async fn copilot_chat_open(app: AppHandle, id: String) -> Result<Option<ChatOpen>, String> {
    crate::blocking::run(move || {
        let id = check_id(&id)?;
        crate::app_db::with(&app, |conn| open(conn, id))
    })
    .await
}

#[tauri::command]
pub async fn copilot_chat_messages(app: AppHandle, id: String, before: i64) -> Result<Vec<StoredMessage>, String> {
    crate::blocking::run(move || {
        let id = check_id(&id)?;
        crate::app_db::with(&app, |conn| messages_before(conn, id, before, PAGE_SIZE))
    })
    .await
}

/// Delete one chat and its messages and summaries. True when something was removed.
#[tauri::command]
pub async fn copilot_chat_delete(app: AppHandle, id: String) -> Result<bool, String> {
    crate::blocking::run(move || {
        let id = check_id(&id)?;
        crate::app_db::with(&app, |conn| delete(conn, id))
    })
    .await
}

#[tauri::command]
pub async fn copilot_message_append(app: AppHandle, meta: ChatMeta, message: ChatMessage) -> Result<i64, String> {
    crate::blocking::run(move || {
        let meta = ChatMeta { id: check_id(&meta.id)?.to_string(), ..meta };
        let pos = crate::app_db::with(&app, |conn| append(conn, &meta, &message))?;
        if message.role == "assistant" {
            crate::copilot::maybe_compress(&app, &meta.id);
        }
        Ok(pos)
    })
    .await
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

#[tauri::command]
pub async fn copilot_module_chat_get(module_path: String) -> Result<Option<String>, String> {
    crate::blocking::run(move || {
        let _files = crate::blocking::files();
        module_chat_get(&module_path)
    })
    .await
}

fn module_chat_get(module_path: &str) -> Result<Option<String>, String> {
    let path = match module_chat_file(module_path) {
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
pub async fn copilot_module_chat_set(module_path: String, chat_id: String) -> Result<(), String> {
    crate::blocking::run(move || {
        let _files = crate::blocking::files();
        let id = check_id(&chat_id)?;
        let path = module_chat_file(&module_path)?;
        let text = serde_json::to_string_pretty(&ModuleChatPointer { last_chat_id: id.to_string() }).map_err(|err| err.to_string())?;
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, text).map_err(|err| err.to_string())?;
        fs::rename(&temp, &path).map_err(|err| err.to_string())?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        for sql in crate::app_db::SCHEMA {
            conn.execute_batch(sql).expect("schema");
        }
        conn
    }

    fn meta(id: &str) -> ChatMeta {
        ChatMeta { id: id.into(), title: "t".into(), module_path: String::new(), module_name: String::new(), service: "svc".into(), model: "m".into() }
    }

    fn message(role: &str, text: &str) -> ChatMessage {
        ChatMessage { id: uuid::Uuid::new_v4().to_string(), role: role.into(), text: text.into(), prompt: None, thinking: None, thought_seconds: None }
    }

    #[test]
    fn append_numbers_messages_and_lists_only_chats_with_messages() {
        let conn = memory_db();
        assert_eq!(append(&conn, &meta("a"), &message("user", "hi")).unwrap(), 0);
        assert_eq!(append(&conn, &meta("a"), &message("assistant", "hello")).unwrap(), 1);
        assert_eq!(append(&conn, &meta("b"), &message("user", "later")).unwrap(), 0);
        let listed = list(&conn).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed[0].updated_at >= listed[1].updated_at);
        let opened = open(&conn, "a").unwrap().unwrap();
        assert_eq!(opened.total, 2);
        assert_eq!(opened.messages.len(), 2);
        assert_eq!(opened.messages[0].pos, 0);
        assert!(opened.summary.is_none());
        assert!(open(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn open_returns_the_newest_page_and_older_pages_follow() {
        let conn = memory_db();
        for i in 0..25 {
            append(&conn, &meta("c"), &message(if i % 2 == 0 { "user" } else { "assistant" }, &format!("m{i}"))).unwrap();
        }
        let opened = open(&conn, "c").unwrap().unwrap();
        assert_eq!(opened.total, 25);
        let shown: Vec<i64> = opened.messages.iter().map(|m| m.pos).collect();
        assert_eq!(shown, (15..25).collect::<Vec<_>>());
        let older = messages_before(&conn, "c", 15, PAGE_SIZE).unwrap();
        assert_eq!(older.iter().map(|m| m.pos).collect::<Vec<_>>(), (5..15).collect::<Vec<_>>());
        let oldest = messages_before(&conn, "c", 5, PAGE_SIZE).unwrap();
        assert_eq!(oldest.iter().map(|m| m.pos).collect::<Vec<_>>(), (0..5).collect::<Vec<_>>());
        assert!(messages_before(&conn, "c", 0, PAGE_SIZE).unwrap().is_empty());
    }

    #[test]
    fn summary_splits_what_the_model_sees() {
        let conn = memory_db();
        for i in 0..6 {
            append(&conn, &meta("d"), &message(if i % 2 == 0 { "user" } else { "assistant" }, &format!("m{i}"))).unwrap();
        }
        assert!(latest_summary(&conn, "d").unwrap().is_none());
        insert_summary(&conn, "d", 3, "first summary").unwrap();
        insert_summary(&conn, "d", 1, "older summary").unwrap();
        let summary = latest_summary(&conn, "d").unwrap().unwrap();
        assert_eq!(summary.covers_to, 3);
        assert_eq!(summary.text, "first summary");
        let after = messages_after(&conn, "d", summary.covers_to).unwrap();
        assert_eq!(after.iter().map(|m| m.pos).collect::<Vec<_>>(), vec![4, 5]);
        assert_eq!(messages_after(&conn, "d", -1).unwrap().len(), 6);
    }

    #[test]
    fn delete_removes_the_chat_with_its_messages_and_summaries() {
        let conn = memory_db();
        append(&conn, &meta("a"), &message("user", "hi")).unwrap();
        append(&conn, &meta("a"), &message("assistant", "hello")).unwrap();
        append(&conn, &meta("b"), &message("user", "keep")).unwrap();
        insert_summary(&conn, "a", 1, "summary of a").unwrap();

        assert!(delete(&conn, "a").unwrap());
        assert!(open(&conn, "a").unwrap().is_none());
        assert!(messages_after(&conn, "a", -1).unwrap().is_empty());
        assert!(latest_summary(&conn, "a").unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), 1);

        // A chat that was never stored is not an error, it simply has nothing to remove.
        assert!(!delete(&conn, "missing").unwrap());
        assert!(open(&conn, "b").unwrap().is_some());
    }

    #[test]
    fn token_estimate_matches_the_panel_rule() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens("你好"), 2);
        assert_eq!(estimate_tokens("ab你cd"), 3);
    }
}
