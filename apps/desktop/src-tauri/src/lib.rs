mod geometry;

use geometry::{MainWindowState, Rect};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// Geometry + routing tag that the front end queues right before dockview calls
/// `window.open`, because `NewWindowFeatures` arrives without size/position.
#[derive(Clone, Debug, Deserialize)]
struct PendingPopout {
  tag: String,
  x: Option<f64>,
  y: Option<f64>,
  width: Option<f64>,
  height: Option<f64>,
  /// x/y are offsets inside the main window's viewport rather than screen coordinates.
  #[serde(default)]
  relative: bool,
}

#[derive(Default)]
struct PopoutQueue(Mutex<VecDeque<PendingPopout>>);

#[derive(Default)]
struct MainGeometry(Mutex<Option<MainWindowState>>);

/// While the welcome page is up, resize events must not replace the project window frame.
struct PersistMainWindow(AtomicBool);

const WELCOME_W: f64 = 860.0;
const WELCOME_H: f64 = 564.0;

#[derive(Clone, Serialize)]
struct PopoutCreated {
  label: String,
  tag: String,
}

#[derive(Clone, Serialize)]
struct PopoutGeometry {
  label: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
}

#[tauri::command]
fn log_line(line: String) {
  println!("[FRONTEND] {line}");
}

#[tauri::command]
fn queue_popout(state: tauri::State<PopoutQueue>, pending: PendingPopout) {
  println!("[RUST] queue_popout {pending:?}");
  state.0.lock().unwrap().push_back(pending);
}

#[tauri::command]
fn clear_popout_queue(state: tauri::State<PopoutQueue>) {
  state.0.lock().unwrap().clear();
}

#[tauri::command]
fn reset_main_window_state(app: AppHandle) {
  app.state::<MainGeometry>().0.lock().unwrap().take();
  geometry::clear_main(&app);
}

fn record_main_geometry(app: &AppHandle) {
  if !app.state::<PersistMainWindow>().0.load(Ordering::SeqCst) {
    return;
  }
  let Some(w) = app.get_webview_window("main") else { return };
  let maximized = w.is_maximized().unwrap_or(false);
  let fullscreen = w.is_fullscreen().unwrap_or(false);
  let state = app.state::<MainGeometry>();
  let mut guard = state.0.lock().unwrap();
  let rect = match (maximized || fullscreen, guard.as_ref()) {
    (true, Some(prev)) => prev.rect,
    _ => match geometry::window_rect(&w) {
      Some(r) => r,
      None => return,
    },
  };
  let next = MainWindowState { rect, maximized, fullscreen, monitor: geometry::monitor_name(&w) };
  geometry::save_main(app, &next);
  *guard = Some(next);
}

#[tauri::command]
fn destroy_window(app: AppHandle, label: String) -> bool {
  match app.get_webview_window(&label) {
    Some(w) => {
      println!("[RUST] destroying {label}");
      let _ = w.destroy();
      true
    }
    None => false,
  }
}

#[tauri::command]
fn focus_window(app: AppHandle, label: String) -> bool {
  app.get_webview_window(&label).map(|w| w.set_focus().is_ok()).unwrap_or(false)
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
  std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
  std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn documents_dir(app: AppHandle) -> Result<String, String> {
  app.path().document_dir().map(|p| p.to_string_lossy().to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn join_path(parent: String, name: String) -> Result<String, String> {
  if !valid_folder_name(&name) {
    return Err("invalid-name".into());
  }
  Ok(std::path::Path::new(&parent).join(name).to_string_lossy().to_string())
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
  std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
  std::path::Path::new(&path).exists()
}

#[tauri::command]
fn list_child_dirs(path: String) -> Result<Vec<String>, String> {
  let mut names = Vec::new();
  for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
    if !is_dir {
      continue;
    }
    if let Some(name) = entry.file_name().to_str() {
      names.push(name.to_string());
    }
  }
  names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
  Ok(names)
}

fn welcome_origin(app: &AppHandle, anchor: Option<&MainWindowState>) -> Option<(f64, f64)> {
  let monitors = app.available_monitors().ok()?;
  let saved = anchor.map(|s| s.rect);
  let monitor = saved.and_then(|rect| {
    let cx = rect.x + rect.width / 2.0;
    let cy = rect.y + rect.height / 2.0;
    monitors.iter().find(|m| {
      let p = m.position().to_logical::<f64>(m.scale_factor());
      let s = m.size().to_logical::<f64>(m.scale_factor());
      cx >= p.x && cx < p.x + s.width && cy >= p.y && cy < p.y + s.height
    })
  });
  let m = monitor.or_else(|| monitors.first())?;
  let p = m.position().to_logical::<f64>(m.scale_factor());
  let s = m.size().to_logical::<f64>(m.scale_factor());
  Some((p.x + (s.width - WELCOME_W) / 2.0, p.y + (s.height - WELCOME_H) / 2.0))
}

fn place_welcome(app: &AppHandle, window: &tauri::WebviewWindow) {
  if window.is_maximized().unwrap_or(false) {
    let _ = window.unmaximize();
  }
  let _ = window.set_fullscreen(false);
  let _ = window.set_size(tauri::LogicalSize::new(WELCOME_W, WELCOME_H));
  let saved = app.state::<MainGeometry>().0.lock().unwrap().clone();
  if let Some((x, y)) = welcome_origin(app, saved.as_ref()) {
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
  } else {
    let _ = window.center();
  }
}

fn place_project(app: &AppHandle, window: &tauri::WebviewWindow) {
  let saved = app.state::<MainGeometry>().0.lock().unwrap().clone();
  match saved {
    Some(state) => {
      let (rect, _) = geometry::fit_on_screen(app, state.rect);
      let _ = window.set_size(tauri::LogicalSize::new(rect.width, rect.height));
      let _ = window.set_position(tauri::LogicalPosition::new(rect.x, rect.y));
      if state.maximized {
        let _ = window.maximize();
      }
      if state.fullscreen {
        let _ = window.set_fullscreen(true);
      }
    }
    None => {
      let _ = window.set_size(tauri::LogicalSize::new(1360.0, 820.0));
      let _ = window.center();
    }
  }
}

#[tauri::command]
fn set_welcome_window(app: AppHandle, welcome: bool) {
  let Some(window) = app.get_webview_window("main") else { return };
  if welcome {
    app.state::<PersistMainWindow>().0.store(false, Ordering::SeqCst);
    place_welcome(&app, &window);
  } else {
    place_project(&app, &window);
    app.state::<PersistMainWindow>().0.store(true, Ordering::SeqCst);
    record_main_geometry(&app);
  }
}

fn valid_folder_name(name: &str) -> bool {
  let name = name.trim();
  !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')
}

fn emit_geometry(app: &AppHandle, label: &str) {
  if let Some(w) = app.get_webview_window(label) {
    let scale = w.scale_factor().unwrap_or(1.0);
    if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
      let p = pos.to_logical::<f64>(scale);
      let s = size.to_logical::<f64>(scale);
      let _ = app.emit_to(
        "main",
        "ek:popout-geometry",
        PopoutGeometry { label: label.to_string(), x: p.x, y: p.y, width: s.width, height: s.height },
      );
    }
  }
}

fn is_popout_url(url: &tauri::Url) -> bool {
  url.path().ends_with("/popout.html")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let intercept_close = std::env::var("EK_NO_CLOSE_INTERCEPT").is_err();
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(PopoutQueue::default())
    .manage(MainGeometry::default())
    .manage(PersistMainWindow(AtomicBool::new(false)))
    .invoke_handler(tauri::generate_handler![
      log_line,
      queue_popout,
      clear_popout_queue,
      destroy_window,
      focus_window,
      reset_main_window_state,
      write_text_file,
      read_text_file,
      documents_dir,
      join_path,
      ensure_dir,
      path_exists,
      list_child_dirs,
      set_welcome_window
    ])
    .setup(move |app| {
      let handle = app.handle().clone();
      let saved = geometry::load_main(app.handle());
      let mut main_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("EasyKeeper")
        .visible(false)
        .min_inner_size(480.0, 360.0);
      match &saved {
        Some(s) => {
          let (r, moved) = geometry::fit_on_screen(app.handle(), s.rect);
          println!("[RUST] project frame {:?} monitor={:?} -> {r:?}{}", s.rect, s.monitor, if moved { " (off-screen, moved to primary)" } else { "" });
        }
        None => {}
      }
      main_builder = main_builder.inner_size(WELCOME_W, WELCOME_H);
      if let Some((x, y)) = welcome_origin(app.handle(), saved.as_ref()) {
        main_builder = main_builder.position(x, y);
      } else {
        main_builder = main_builder.center();
      }
      let main = main_builder
        .disable_drag_drop_handler()
        .on_new_window(move |url, features| {
          if !is_popout_url(&url) {
            println!("[RUST] denied non-popout window.open {url}");
            return NewWindowResponse::Deny;
          }
          let pending = handle.state::<PopoutQueue>().0.lock().unwrap().pop_front();
          let n = COUNTER.fetch_add(1, Ordering::SeqCst);
          let label = format!("popout-{n}");
          println!("[RUST] on_new_window {url} -> {label} pending={pending:?}");
          let mut b = WebviewWindowBuilder::new(&handle, &label, WebviewUrl::External("about:blank".parse().unwrap()))
            .window_features(features)
            .title("EasyKeeper · Pop-out")
            .disable_drag_drop_handler()
            .on_document_title_changed(|w, t| {
              let _ = w.set_title(&t);
            });
          let tag = pending.as_ref().map(|p| p.tag.clone()).unwrap_or_default();
          let origin = handle.get_webview_window("main").and_then(|m| {
            let scale = m.scale_factor().ok()?;
            Some(m.inner_position().ok()?.to_logical::<f64>(scale))
          });
          if let Some(p) = &pending {
            let width = p.width.unwrap_or(640.0).max(240.0);
            let height = p.height.unwrap_or(480.0).max(160.0);
            b = b.inner_size(width, height);
            if let (Some(x), Some(y)) = (p.x, p.y) {
              let (x, y) = match (p.relative, origin) {
                (true, Some(o)) => (o.x + x, o.y + y),
                _ => (x, y),
              };
              let (r, moved) = geometry::fit_on_screen(&handle, Rect { x, y, width, height });
              println!("[RUST] {label} position {},{}{}", r.x, r.y, if moved { " (off-screen, moved to primary)" } else { "" });
              b = b.inner_size(r.width, r.height).position(r.x, r.y);
            }
          }
          match b.build() {
            Ok(window) => {
              let h2 = handle.clone();
              let l2 = label.clone();
              window.on_window_event(move |ev| match ev {
                WindowEvent::CloseRequested { api, .. } if intercept_close => {
                  api.prevent_close();
                  println!("[RUST] close requested for {l2} -> dock back");
                  let _ = h2.emit_to("main", "ek:popout-close-requested", l2.clone());
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => emit_geometry(&h2, &l2),
                _ => {}
              });
              let (h4, l4) = (handle.clone(), label.clone());
              std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                emit_geometry(&h4, &l4);
              });
              let _ = handle.emit_to("main", "ek:popout-created", PopoutCreated { label: label.clone(), tag });
              NewWindowResponse::Create { window }
            }
            Err(e) => {
              println!("[RUST] build error {e}");
              NewWindowResponse::Deny
            }
          }
        })
        .build()?;

      if let Ok(js) = std::env::var("EK_AUTORUN_JS") {
        let m = main.clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_secs(6));
          println!("[RUST] autorun: {js}");
          let _ = m.eval(&js);
        });
      }

      main.show()?;
      *app.state::<MainGeometry>().0.lock().unwrap() = saved;

      let h3 = app.handle().clone();
      main.on_window_event(move |ev| match ev {
        WindowEvent::CloseRequested { .. } => {
          record_main_geometry(&h3);
          for (label, w) in h3.webview_windows() {
            if label.starts_with("popout-") {
              let _ = w.destroy();
            }
          }
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => record_main_geometry(&h3),
        _ => {}
      });

      #[cfg(target_os = "linux")]
      if std::env::var("EK_NO_AUTO_POPUPS").is_err() {
        main.with_webview(|pw| {
          use webkit2gtk::{SettingsExt, WebViewExt};
          if let Some(settings) = pw.inner().settings() {
            settings.set_javascript_can_open_windows_automatically(true);
            println!("[RUST] javascript_can_open_windows_automatically=true");
          }
        })?;
      }

      #[cfg(all(target_os = "macos", feature = "mac-auto-popups"))]
      main.with_webview(|pw| unsafe {
        use objc2_web_kit::WKWebView;
        let wv: &WKWebView = &*(pw.inner() as *const WKWebView);
        wv.configuration().preferences().setJavaScriptCanOpenWindowsAutomatically(true);
        println!("[RUST] WKPreferences.javaScriptCanOpenWindowsAutomatically=true");
      })?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
