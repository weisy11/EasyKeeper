use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub id: String,
    pub created_at: String,
}

#[tauri::command]
pub fn create_project_snapshot(project_path: String) -> Result<ProjectSnapshot, String> {
    create(&project_path)
}

#[tauri::command]
pub fn list_project_snapshots(project_path: String) -> Result<Vec<ProjectSnapshot>, String> {
    list(&project_path)
}

#[tauri::command]
pub fn delete_project_snapshot(project_path: String, id: String) -> Result<(), String> {
    delete(&project_path, &id)
}

pub fn create(project_path: &str) -> Result<ProjectSnapshot, String> {
    let project = Path::new(project_path);
    if !project.is_dir() {
        return Err("missing project".into());
    }
    let versions = project.join("versions");
    fs::create_dir_all(&versions).map_err(|err| err.to_string())?;
    let millis = unique_millis(&versions)?;
    let id = format!("{millis:013}");
    let created_at = unix_millis_to_iso(millis);
    let dir = versions.join(&id);
    fs::create_dir(&dir).map_err(|err| err.to_string())?;
    let result = (|| {
        copy_pages(project, &dir)?;
        let copied = crate::project_db::backup_database(project_path, &dir.join("data").join("project.sqlite"))?;
        if !copied {
            let _ = fs::remove_dir_all(dir.join("data"));
        }
        let manifest = serde_json::json!({ "createdAt": created_at.clone() });
        fs::write(dir.join("manifest.json"), manifest.to_string()).map_err(|err| err.to_string())?;
        Ok(ProjectSnapshot { id, created_at })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result
}

pub fn list(project_path: &str) -> Result<Vec<ProjectSnapshot>, String> {
    let versions = Path::new(project_path).join("versions");
    if !versions.is_dir() {
        return Ok(Vec::new());
    }
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(&versions).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_id(&id) {
            continue;
        }
        let text = fs::read_to_string(entry.path().join("manifest.json")).ok();
        let Some(text) = text else { continue };
        let created_at = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|value| value.get("createdAt").and_then(|item| item.as_str()).map(str::to_string));
        let Some(created_at) = created_at else { continue };
        snapshots.push(ProjectSnapshot { id, created_at });
    }
    snapshots.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(snapshots)
}

pub fn delete(project_path: &str, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("invalid snapshot".into());
    }
    let dir = Path::new(project_path).join("versions").join(id);
    if !dir.is_dir() {
        return Err("missing snapshot".into());
    }
    fs::remove_dir_all(&dir).map_err(|err| err.to_string())
}

fn copy_pages(project: &Path, dest_root: &Path) -> Result<(), String> {
    let pages = project.join("pages");
    if !pages.is_dir() {
        return Ok(());
    }
    let out = dest_root.join("pages");
    fs::create_dir_all(&out).map_err(|err| err.to_string())?;
    for entry in fs::read_dir(&pages).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !name.ends_with(".json") || name.contains('/') || name.contains('\\') {
            continue;
        }
        fs::copy(entry.path(), out.join(name)).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn unique_millis(versions: &Path) -> Result<u128, String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|err| err.to_string())?;
    let mut millis = now.as_millis();
    while versions.join(format!("{millis:013}")).exists() {
        millis += 1;
    }
    Ok(millis)
}

fn valid_id(id: &str) -> bool {
    id.len() == 13 && id.bytes().all(|byte| byte.is_ascii_digit())
}

fn unix_millis_to_iso(ms: u128) -> String {
    let secs = (ms / 1000) as i64;
    let millis = (ms % 1000) as u32;
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = tod / 3600;
    let minute = (tod % 3600) / 60;
    let second = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Days since Unix epoch to a civil date. Algorithm from Howard Hinnant.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use serde_json::Value;

    fn temp_project(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("ek-snapshot-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(path.join("pages")).unwrap();
        fs::create_dir_all(path.join("images")).unwrap();
        path
    }

    #[test]
    fn unix_epoch_formats_as_utc() {
        assert_eq!(unix_millis_to_iso(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn snapshot_copies_pages_and_database_but_not_images() {
        let project = temp_project("copy");
        fs::write(project.join("pages").join("page.json"), r#"{"type":"doc"}"#).unwrap();
        fs::write(project.join("images").join("pic.png"), "image-bytes").unwrap();
        let project_text = project.to_string_lossy().to_string();
        crate::project_db::exec(
            &project_text,
            "ek_scenario_",
            "CREATE TABLE ek_scenario_node (id TEXT PRIMARY KEY, title TEXT NOT NULL)",
            &[],
        )
        .unwrap();
        crate::project_db::exec(
            &project_text,
            "ek_scenario_",
            "INSERT INTO ek_scenario_node (id, title) VALUES (?1, ?2)",
            &[Value::String("a".into()), Value::String("灯塔".into())],
        )
        .unwrap();

        let snapshot = create(&project_text).unwrap();
        let dir = project.join("versions").join(&snapshot.id);
        assert_eq!(fs::read_to_string(dir.join("pages").join("page.json")).unwrap(), r#"{"type":"doc"}"#);
        assert!(!dir.join("images").exists());
        let rows = crate::project_db::query(
            &dir.to_string_lossy(),
            "ek_scenario_",
            "SELECT title FROM ek_scenario_node WHERE id = ?1",
            &[Value::String("a".into())],
        )
        .unwrap();
        assert_eq!(rows[0]["title"], Value::String("灯塔".into()));

        let listed = list(&project_text).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, snapshot.id);

        delete(&project_text, &snapshot.id).unwrap();
        assert!(list(&project_text).unwrap().is_empty());
        assert!(delete(&project_text, "../secret").is_err());
    }
}
