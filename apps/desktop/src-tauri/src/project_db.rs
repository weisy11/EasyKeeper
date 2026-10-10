use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::types::{ToSqlOutput, ValueRef};
use rusqlite::{Connection, Result as SqlResult, ToSql};
use serde_json::{Map, Number, Value};

static CONNECTIONS: Mutex<Option<HashMap<String, Connection>>> = Mutex::new(None);

/// Run a write statement against the project database.
/// `tool_prefix` is fixed for this call; the engine rejects every other table.
pub fn exec(project_path: &str, tool_prefix: &str, sql: &str, params: &[Value]) -> Result<(), String> {
    with_connection(project_path, tool_prefix, |conn| {
        let args = bind_args(params)?;
        conn.execute(sql, rusqlite::params_from_iter(args.iter()))
            .map(|_| ())
            .map_err(|err| err.to_string())
    })
}

/// Run a query and return JSON objects, one per row.
pub fn query(project_path: &str, tool_prefix: &str, sql: &str, params: &[Value]) -> Result<Vec<Value>, String> {
    with_connection(project_path, tool_prefix, |conn| {
        let args = bind_args(params)?;
        let mut stmt = conn.prepare(sql).map_err(|err| err.to_string())?;
        let columns: Vec<String> = stmt.column_names().iter().map(|name| (*name).to_string()).collect();
        let mut rows = stmt
            .query(rusqlite::params_from_iter(args.iter()))
            .map_err(|err| err.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|err| err.to_string())? {
            let mut record = Map::new();
            for (index, name) in columns.iter().enumerate() {
                record.insert(name.clone(), cell_value(row, index)?);
            }
            out.push(Value::Object(record));
        }
        Ok(out)
    })
}

fn with_connection<T>(project_path: &str, tool_prefix: &str, body: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    if !valid_prefix(tool_prefix) {
        return Err("invalid tool prefix".into());
    }
    let mut guard = CONNECTIONS.lock().map_err(|_| "project database lock".to_string())?;
    let connections = guard.get_or_insert_with(HashMap::new);
    if !connections.contains_key(project_path) {
        connections.insert(project_path.to_string(), open_project(project_path)?);
    }
    let conn = connections.get(project_path).expect("connection inserted");
    conn.authorizer(Some({
        let prefix = tool_prefix.to_string();
        move |ctx: AuthContext<'_>| {
            if allow_action(&prefix, &ctx.action) { Authorization::Allow } else { Authorization::Deny }
        }
    }));
    body(conn)
}

/// Write a consistent copy of the project database, including pages still in the WAL.
/// Returns false when this project has no database yet.
pub fn backup_database(project_path: &str, dest: &Path) -> Result<bool, String> {
    let mut guard = CONNECTIONS.lock().map_err(|_| "project database lock".to_string())?;
    let connections = guard.get_or_insert_with(HashMap::new);
    if let Some(conn) = connections.get(project_path) {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        conn.authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
        conn.backup(rusqlite::MAIN_DB, dest, None).map_err(|err| err.to_string())?;
        return Ok(true);
    }
    drop(guard);
    let db_file = Path::new(project_path).join("data").join("project.sqlite");
    if !db_file.exists() {
        return Ok(false);
    }
    let conn = Connection::open(&db_file).map_err(|err| err.to_string())?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    conn.backup(rusqlite::MAIN_DB, dest, None).map_err(|err| err.to_string())?;
    Ok(true)
}

fn open_project(project_path: &str) -> Result<Connection, String> {
    let dir = Path::new(project_path).join("data");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let conn = Connection::open(dir.join("project.sqlite")).map_err(|err| err.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|err| err.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON").map_err(|err| err.to_string())?;
    Ok(conn)
}

fn valid_prefix(prefix: &str) -> bool {
    let mut chars = prefix.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    prefix.ends_with('_')
        && first.is_ascii_lowercase()
        && prefix.chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
}

fn is_catalog(table_name: &str) -> bool {
    matches!(table_name, "sqlite_master" | "sqlite_schema" | "sqlite_temp_master" | "sqlite_temp_schema")
}

fn allow_action(prefix: &str, action: &AuthAction<'_>) -> bool {
    match action {
        AuthAction::Select | AuthAction::Transaction { .. } | AuthAction::Function { .. } | AuthAction::Savepoint { .. } | AuthAction::Recursive => true,
        AuthAction::Read { table_name, .. } => table_name.starts_with(prefix) || is_catalog(table_name),
        AuthAction::Insert { table_name } | AuthAction::Update { table_name, .. } | AuthAction::Delete { table_name } => table_name.starts_with(prefix) || is_catalog(table_name),
        AuthAction::CreateTable { table_name }
        | AuthAction::DropTable { table_name }
        | AuthAction::CreateTempTable { table_name }
        | AuthAction::DropTempTable { table_name }
        | AuthAction::Analyze { table_name } => table_name.starts_with(prefix),
        AuthAction::CreateIndex { index_name, table_name }
        | AuthAction::DropIndex { index_name, table_name }
        | AuthAction::CreateTempIndex { index_name, table_name }
        | AuthAction::DropTempIndex { index_name, table_name } => {
            table_name.starts_with(prefix) && (index_name.starts_with(prefix) || index_name.starts_with("sqlite_autoindex_"))
        }
        AuthAction::CreateTrigger { trigger_name, table_name }
        | AuthAction::DropTrigger { trigger_name, table_name }
        | AuthAction::CreateTempTrigger { trigger_name, table_name }
        | AuthAction::DropTempTrigger { trigger_name, table_name } => trigger_name.starts_with(prefix) && table_name.starts_with(prefix),
        AuthAction::CreateView { view_name } | AuthAction::DropView { view_name } | AuthAction::CreateTempView { view_name } | AuthAction::DropTempView { view_name } => {
            view_name.starts_with(prefix)
        }
        AuthAction::Reindex { index_name } => index_name.starts_with(prefix),
        _ => false,
    }
}

enum Arg {
    Null,
    Int(i64),
    Real(f64),
    Text(String),
}

impl ToSql for Arg {
    fn to_sql(&self) -> SqlResult<ToSqlOutput<'_>> {
        match self {
            Arg::Null => Ok(ToSqlOutput::Borrowed(ValueRef::Null)),
            Arg::Int(value) => Ok(ToSqlOutput::Owned(rusqlite::types::Value::Integer(*value))),
            Arg::Real(value) => Ok(ToSqlOutput::Owned(rusqlite::types::Value::Real(*value))),
            Arg::Text(value) => Ok(ToSqlOutput::Borrowed(ValueRef::Text(value.as_bytes()))),
        }
    }
}

fn bind_args(params: &[Value]) -> Result<Vec<Arg>, String> {
    params
        .iter()
        .map(|value| match value {
            Value::Null => Ok(Arg::Null),
            Value::String(text) => Ok(Arg::Text(text.clone())),
            Value::Number(number) => number
                .as_i64()
                .map(Arg::Int)
                .or_else(|| number.as_f64().map(Arg::Real))
                .ok_or_else(|| "unsupported number".to_string()),
            _ => Err("unsupported parameter".into()),
        })
        .collect()
}

fn cell_value(row: &rusqlite::Row<'_>, index: usize) -> Result<Value, String> {
    match row.get_ref(index).map_err(|err| err.to_string())? {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(value) => Ok(Value::Number(value.into())),
        ValueRef::Real(value) => Number::from_f64(value).map(Value::Number).ok_or_else(|| "non-finite number".to_string()),
        ValueRef::Text(value) => Ok(Value::String(String::from_utf8_lossy(value).into_owned())),
        ValueRef::Blob(_) => Err("blob column is not supported".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(name: &str) -> String {
        let path = std::env::temp_dir().join(format!("ek-project-db-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn tool_can_create_and_read_its_own_table() {
        let project = temp_project("own");
        exec(
            &project,
            "ek_scenario_",
            "CREATE TABLE ek_scenario_node (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
            &[],
        )
        .unwrap();
        exec(&project, "ek_scenario_", "INSERT INTO ek_scenario_node (id, title) VALUES (?1, ?2)", &[Value::String("a".into()), Value::String("灯塔".into())]).unwrap();
        let rows = query(&project, "ek_scenario_", "SELECT title FROM ek_scenario_node WHERE id = ?1", &[Value::String("a".into())]).unwrap();
        assert_eq!(rows[0]["title"], Value::String("灯塔".into()));
    }

    #[test]
    fn tool_cannot_read_another_tools_table() {
        let project = temp_project("other");
        exec(&project, "ek_dice_", "CREATE TABLE ek_dice_roll (id TEXT PRIMARY KEY)", &[]).unwrap();
        let denied = query(&project, "ek_scenario_", "SELECT id FROM ek_dice_roll", &[]);
        assert!(denied.is_err());
    }

    #[test]
    fn tool_cannot_create_a_table_outside_its_prefix() {
        let project = temp_project("prefix");
        let denied = exec(&project, "ek_scenario_", "CREATE TABLE ek_dice_roll (id TEXT PRIMARY KEY)", &[]);
        assert!(denied.is_err());
    }
}
