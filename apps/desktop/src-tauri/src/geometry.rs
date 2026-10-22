//! Window geometry in global logical coordinates (macOS points, top-left origin), taken from the
//! native window rather than WKWebView's `window.screenX/Y`, which is wrong on multi-monitor setups.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Monitor, Runtime, WebviewWindow};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MainWindowState {
  /// Last non-maximized, non-fullscreen frame: outer position + inner size.
  pub rect: Rect,
  pub maximized: bool,
  pub fullscreen: bool,
  pub monitor: Option<String>,
}

/// A window counts as reachable when this much of its title-bar strip lies on some monitor's work area.
const MIN_VISIBLE_W: f64 = 120.0;
const MIN_VISIBLE_H: f64 = 24.0;
const TITLE_STRIP: f64 = 32.0;

fn work_area(m: &Monitor) -> Rect {
  let wa = m.work_area();
  let p = wa.position.to_logical::<f64>(m.scale_factor());
  let s = wa.size.to_logical::<f64>(m.scale_factor());
  Rect { x: p.x, y: p.y, width: s.width, height: s.height }
}

fn overlap(a: &Rect, b: &Rect) -> (f64, f64) {
  let w = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
  let h = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
  (w.max(0.0), h.max(0.0))
}

pub fn window_rect<R: Runtime>(w: &WebviewWindow<R>) -> Option<Rect> {
  let scale = w.scale_factor().ok()?;
  let p = w.outer_position().ok()?.to_logical::<f64>(scale);
  let s = w.inner_size().ok()?.to_logical::<f64>(scale);
  Some(Rect { x: p.x, y: p.y, width: s.width, height: s.height })
}

pub fn monitor_name<R: Runtime>(w: &WebviewWindow<R>) -> Option<String> {
  w.current_monitor().ok().flatten().and_then(|m| m.name().cloned())
}

/// Keeps `rect` if its title bar is reachable on a connected monitor; otherwise moves it to the
/// primary monitor, shrunk to fit and centered. Returns the rect and whether it was changed.
pub fn fit_on_screen<R: Runtime>(app: &AppHandle<R>, rect: Rect) -> (Rect, bool) {
  let monitors = app.available_monitors().unwrap_or_default();
  let strip = Rect { height: TITLE_STRIP, ..rect };
  let reachable = monitors.iter().any(|m| {
    let (w, h) = overlap(&strip, &work_area(m));
    w >= MIN_VISIBLE_W.min(rect.width) && h >= MIN_VISIBLE_H
  });
  if reachable {
    return (rect, false);
  }
  let Some(primary) = app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next()) else {
    return (rect, false);
  };
  let wa = work_area(&primary);
  let width = rect.width.min(wa.width - 40.0).max(240.0);
  let height = rect.height.min(wa.height - 60.0).max(160.0);
  let fitted = Rect { x: wa.x + (wa.width - width) / 2.0, y: wa.y + (wa.height - height) / 2.0, width, height };
  (fitted, true)
}

/// Main window frame lives in the app database. Older builds kept it in `main-window.json`;
/// that file is imported once and deleted.
const MAIN_KV_KEY: &str = "ek.window.main";
const LEGACY_FILE: &str = "main-window.json";

fn legacy_path(app: &AppHandle) -> Option<std::path::PathBuf> {
  Some(app.path().app_config_dir().ok()?.join(LEGACY_FILE))
}

fn import_legacy(app: &AppHandle) {
  let Some(path) = legacy_path(app) else { return };
  let Ok(raw) = std::fs::read_to_string(&path) else { return };
  let valid = serde_json::from_str::<MainWindowState>(&raw).is_ok();
  let result = crate::app_db::with(app, |conn| {
    if valid && crate::app_db::kv_get(conn, MAIN_KV_KEY)?.is_none() {
      crate::app_db::kv_set(conn, MAIN_KV_KEY, &raw)?;
    }
    Ok(())
  });
  match result {
    Ok(()) => {
      let _ = std::fs::remove_file(&path);
      println!("[RUST] imported {LEGACY_FILE} into the app database");
    }
    Err(err) => eprintln!("[RUST] cannot import {LEGACY_FILE}: {err}"),
  }
}

pub fn load_main(app: &AppHandle) -> Option<MainWindowState> {
  import_legacy(app);
  let raw = crate::app_db::with(app, |conn| crate::app_db::kv_get(conn, MAIN_KV_KEY)).ok().flatten()?;
  serde_json::from_str(&raw).ok()
}

pub fn save_main(app: &AppHandle, state: &MainWindowState) {
  let Ok(json) = serde_json::to_string(state) else { return };
  if let Err(err) = crate::app_db::with(app, |conn| crate::app_db::kv_set(conn, MAIN_KV_KEY, &json)) {
    eprintln!("[RUST] cannot save main window frame: {err}");
  }
}

pub fn clear_main(app: &AppHandle) {
  let _ = crate::app_db::with(app, |conn| crate::app_db::kv_delete(conn, MAIN_KV_KEY));
  if let Some(path) = legacy_path(app) {
    let _ = std::fs::remove_file(path);
  }
}
