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

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
  Some(app.path().app_config_dir().ok()?.join("main-window.json"))
}

pub fn load_main<R: Runtime>(app: &AppHandle<R>) -> Option<MainWindowState> {
  let raw = std::fs::read_to_string(state_path(app)?).ok()?;
  serde_json::from_str(&raw).ok()
}

pub fn save_main<R: Runtime>(app: &AppHandle<R>, state: &MainWindowState) {
  let Some(path) = state_path(app) else { return };
  if let Some(dir) = path.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  if let Ok(json) = serde_json::to_string_pretty(state) {
    let _ = std::fs::write(path, json);
  }
}

pub fn clear_main<R: Runtime>(app: &AppHandle<R>) {
  if let Some(path) = state_path(app) {
    let _ = std::fs::remove_file(path);
  }
}
