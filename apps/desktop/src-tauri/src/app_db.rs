//! Application-level SQLite database at `{app_config_dir}/app.sqlite`.
//!
//! Holds settings that are not tied to one project: the host key/value store (window layout,
//! locale, recent projects...) and the Copilot provider and proxy records. Project data stays in
//! each project's own `data/project.sqlite` (see `project_db`). One connection, guarded by a mutex.

use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "app.sqlite";
/// The key/value store used to live in this file; it is imported once and then renamed.
const LEGACY_STATE_FILE: &str = "app-state.json";

pub(crate) const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS copilot_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )",
    "CREATE TABLE IF NOT EXISTS copilot_provider (
        name TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        vendor TEXT NOT NULL,
        format TEXT NOT NULL,
        address TEXT NOT NULL,
        nonce TEXT NOT NULL,
        secret TEXT NOT NULL,
        models TEXT NOT NULL,
        proxy_id TEXT NOT NULL DEFAULT ''
    )",
    "CREATE TABLE IF NOT EXISTS copilot_proxy (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        auth_nonce TEXT NOT NULL DEFAULT '',
        auth_secret TEXT NOT NULL DEFAULT ''
    )",
    // Chat transcripts. One row per chat for the history list, one row per message, and the
    // rolling context summaries (see `copilot_chats`).
    "CREATE TABLE IF NOT EXISTS copilot_chat (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        module_path TEXT NOT NULL DEFAULT '',
        module_name TEXT NOT NULL DEFAULT '',
        service TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        message_count INTEGER NOT NULL DEFAULT 0
    )",
    "CREATE INDEX IF NOT EXISTS copilot_chat_updated ON copilot_chat (updated_at DESC)",
    "CREATE TABLE IF NOT EXISTS copilot_message (
        chat_id TEXT NOT NULL,
        pos INTEGER NOT NULL,
        id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        prompt TEXT,
        thinking TEXT,
        thought_seconds INTEGER,
        PRIMARY KEY (chat_id, pos)
    )",
    "CREATE TABLE IF NOT EXISTS copilot_summary (
        chat_id TEXT NOT NULL,
        covers_to INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (chat_id, covers_to)
    )",
];

static CONNECTION: Mutex<Option<Connection>> = Mutex::new(None);

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

/// Open (or create) the database in `dir`, creating the directory and schema as needed.
/// Safe to call on a fresh install: every step is idempotent.
fn open(dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(dir).map_err(|err| format!("cannot create {}: {err}", dir.display()))?;
    let file = dir.join(FILE_NAME);
    let conn = Connection::open(&file).map_err(|err| format!("cannot open {}: {err}", file.display()))?;
    // The file carries encrypted API keys next to their wrapping id, so keep it owner-only.
    restrict(&file);
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|err| err.to_string())?;
    for sql in SCHEMA {
        conn.execute_batch(sql).map_err(|err| err.to_string())?;
    }
    import_legacy_state(&conn, dir)?;
    Ok(conn)
}

/// Run `work` against the shared connection, opening it on first use.
pub fn with<T>(app: &AppHandle, work: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = CONNECTION.lock().map_err(|_| "app database busy".to_string())?;
    if guard.is_none() {
        *guard = Some(open(&config_dir(app)?)?);
    }
    work(guard.as_ref().expect("connection opened above"))
}

pub fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// One-time import of the former `app-state.json` into `kv`. Existing keys win so a repeated
/// start after a partial import never overwrites newer values. The file is renamed afterwards.
fn import_legacy_state(conn: &Connection, dir: &Path) -> Result<(), String> {
    let legacy = dir.join(LEGACY_STATE_FILE);
    if !legacy.exists() {
        return Ok(());
    }
    let text = fs::read_to_string(&legacy).map_err(|err| err.to_string())?;
    let state: HashMap<String, String> = serde_json::from_str(&text).unwrap_or_default();
    let tx = conn.unchecked_transaction().map_err(|err| err.to_string())?;
    let at = now_millis();
    for (key, value) in state {
        tx.execute(
            "INSERT OR IGNORE INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, at],
        )
        .map_err(|err| err.to_string())?;
    }
    tx.commit().map_err(|err| err.to_string())?;
    let _ = fs::rename(&legacy, dir.join(format!("{LEGACY_STATE_FILE}.migrated")));
    Ok(())
}

pub fn kv_all(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut statement = conn.prepare("SELECT key, value FROM kv").map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|err| err.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|err| err.to_string())?;
        map.insert(key, value);
    }
    Ok(map)
}

pub fn kv_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
        .map_err(|err| err.to_string())
}

pub fn kv_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now_millis()],
    )
    .map(|_| ())
    .map_err(|err| err.to_string())
}

pub fn kv_delete(conn: &Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM kv WHERE key = ?1", params![key])
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn app_kv_all(app: AppHandle) -> Result<HashMap<String, String>, String> {
    crate::blocking::run(move || with(&app, kv_all)).await
}

#[tauri::command]
pub async fn app_kv_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    crate::blocking::run(move || with(&app, |conn| kv_get(conn, &key))).await
}

#[tauri::command]
pub async fn app_kv_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("empty key".into());
    }
    crate::blocking::run(move || with(&app, |conn| kv_set(conn, &key, &value))).await
}

#[tauri::command]
pub async fn app_kv_delete(app: AppHandle, key: String) -> Result<(), String> {
    crate::blocking::run(move || with(&app, |conn| kv_delete(conn, &key))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        for sql in SCHEMA {
            conn.execute_batch(sql).expect("schema");
        }
        conn
    }

    #[test]
    fn fresh_install_creates_directory_schema_and_file() {
        let dir = std::env::temp_dir().join(format!("ek-appdb-fresh-{}", uuid::Uuid::new_v4())).join("nested");
        assert!(!dir.exists());
        let conn = open(&dir).unwrap();
        assert!(dir.join(FILE_NAME).exists());
        let mut tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        tables.retain(|name| !name.starts_with("sqlite_"));
        assert_eq!(tables, ["copilot_chat", "copilot_message", "copilot_meta", "copilot_provider", "copilot_proxy", "copilot_summary", "kv"]);
        assert!(kv_all(&conn).unwrap().is_empty());
        kv_set(&conn, "ek.settings", "{}").unwrap();
        drop(conn);
        // Reopening keeps data and does not fail on the existing schema.
        let again = open(&dir).unwrap();
        assert_eq!(kv_get(&again, "ek.settings").unwrap().as_deref(), Some("{}"));
        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn kv_round_trips_and_overwrites() {
        let conn = memory_db();
        kv_set(&conn, "ek.a", "1").unwrap();
        kv_set(&conn, "ek.a", "2").unwrap();
        kv_set(&conn, "ek.b", "x").unwrap();
        assert_eq!(kv_get(&conn, "ek.a").unwrap().as_deref(), Some("2"));
        assert_eq!(kv_all(&conn).unwrap().len(), 2);
        kv_delete(&conn, "ek.a").unwrap();
        assert_eq!(kv_get(&conn, "ek.a").unwrap(), None);
    }

    #[test]
    fn legacy_state_is_imported_once_without_clobbering() {
        let dir = std::env::temp_dir().join(format!("ek-appdb-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(LEGACY_STATE_FILE), r#"{"ek.old":"legacy","ek.keep":"legacy"}"#).unwrap();
        let conn = memory_db();
        kv_set(&conn, "ek.keep", "newer").unwrap();
        import_legacy_state(&conn, &dir).unwrap();
        assert_eq!(kv_get(&conn, "ek.old").unwrap().as_deref(), Some("legacy"));
        assert_eq!(kv_get(&conn, "ek.keep").unwrap().as_deref(), Some("newer"));
        assert!(!dir.join(LEGACY_STATE_FILE).exists());
        assert!(dir.join(format!("{LEGACY_STATE_FILE}.migrated")).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
