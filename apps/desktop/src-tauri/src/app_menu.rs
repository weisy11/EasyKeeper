use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};

pub const GITHUB: &str = "https://github.com/weisy11/EasyKeeper";

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    name: String,
    path: String,
    kind: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MenuState {
    locale: String,
    theme: String,
    font_scale: f64,
    dice_muted: bool,
    project_open: bool,
    can_save: bool,
    recent: Vec<RecentEntry>,
}

impl Default for MenuState {
    fn default() -> Self {
        Self { locale: "zh".into(), theme: "dark".into(), font_scale: 1.0, dice_muted: false,
            project_open: false, can_save: false, recent: Vec::new() }
    }
}

#[derive(Default)]
pub struct MenuContext { state: Mutex<MenuState>, utility_save: Mutex<HashMap<String, bool>> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MenuAction {
    id: String,
    path: Option<String>,
    kind: Option<String>,
}

fn current(app: &AppHandle) -> MenuState {
    app.state::<MenuContext>().state.lock().map(|state| state.clone()).unwrap_or_default()
}

fn focused_utility(app: &AppHandle) -> Option<String> {
    app.webview_windows().iter().find(|(label, window)| label.starts_with("utility-") && window.is_focused().unwrap_or(false)).map(|(label, _)| label.clone())
}

fn can_save(app: &AppHandle, main: bool) -> bool {
    if let Some(label) = focused_utility(app) {
        return app.state::<MenuContext>().utility_save.lock().ok().and_then(|states| states.get(&label).copied()).unwrap_or(false);
    }
    main
}

#[tauri::command]
pub fn set_utility_save_enabled(app: AppHandle, window: tauri::WebviewWindow, enabled: bool) {
    if window.label().starts_with("utility-") {
        if let Ok(mut states) = app.state::<MenuContext>().utility_save.lock() { states.insert(window.label().into(), enabled); }
        update_save_enabled(&app);
    }
}

fn build(app: &AppHandle, state: &MenuState) -> tauri::Result<Menu<tauri::Wry>> {
    let text = |zh: &str, en: &str| if state.locale == "en" { en.to_string() } else { zh.to_string() };
    let item = |id: &str, zh: &str, en: &str, enabled: bool, key: Option<&str>| {
        MenuItem::with_id(app, id, text(zh, en), enabled, key)
    };
    let check = |id: &str, zh: &str, en: &str, checked: bool| {
        CheckMenuItem::with_id(app, id, text(zh, en), true, checked, None::<&str>)
    };
    let menu = Menu::new(app)?;
    let app_menu = Submenu::with_items(app, "EasyKeeper", true, &[
        &item("about", "关于 EasyKeeper", "About EasyKeeper", true, None)?,
        &PredefinedMenuItem::separator(app)?,
        &item("settings", "设置…", "Settings…", true, Some("CmdOrCtrl+,"))?,
        &PredefinedMenuItem::separator(app)?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::services(app, Some(&text("服务", "Services")))?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::separator(app)?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::hide(app, Some(&text("隐藏 EasyKeeper", "Hide EasyKeeper")))?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::hide_others(app, Some(&text("隐藏其他", "Hide Others")))?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::show_all(app, Some(&text("显示全部", "Show All")))?,
        &PredefinedMenuItem::separator(app)?,
        &item(super::QUIT_ID, "退出 EasyKeeper", "Quit EasyKeeper", true, Some("CmdOrCtrl+Q"))?,
    ])?;
    menu.append(&app_menu)?;

    let recent = Submenu::with_items(app, text("最近项目", "Open Recent"), true, &[])?;
    if state.recent.is_empty() {
        recent.append(&item("recent-empty", "没有最近项目", "No recent projects", false, None)?)?;
    } else {
        for (index, entry) in state.recent.iter().enumerate() {
            let kind = if entry.kind == "scenario" { text("模组", "Scenario") } else { text("跑团", "Game record") };
            // The path distinguishes projects that share a name.
            recent.append(&MenuItem::with_id(app, format!("recent-{index}"),
                format!("{} · {} — {}", entry.name, kind, entry.path), true, None::<&str>)?)?;
        }
    }
    menu.append(&Submenu::with_id_and_items(app, "file-menu", text("文件", "File"), true, &[
        &item("create-scenario", "创建模组…", "Create Scenario…", true, Some("CmdOrCtrl+N"))?,
        &item("open-scenario", "打开模组…", "Open Scenario…", true, Some("CmdOrCtrl+O"))?,
        &item("create-record", "使用模组跑团…", "Run with Scenario…", true, Some("CmdOrCtrl+Shift+N"))?,
        &item("open-record", "继续跑团…", "Continue Game…", true, Some("CmdOrCtrl+Shift+O"))?,
        &recent,
        &PredefinedMenuItem::separator(app)?,
        &item("save-form", "保存当前表单", "Save Current Form", can_save(app, state.can_save), Some("CmdOrCtrl+S"))?,
        &item("close-project", "关闭项目", "Close Project", state.project_open, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::close_window(app, Some(&text("关闭窗口", "Close Window")))?,
    ])?)?;
    menu.append(&Submenu::with_items(app, text("编辑", "Edit"), true, &[
        &PredefinedMenuItem::undo(app, Some(&text("撤销", "Undo")))?,
        &PredefinedMenuItem::redo(app, Some(&text("重做", "Redo")))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, Some(&text("剪切", "Cut")))?,
        &PredefinedMenuItem::copy(app, Some(&text("复制", "Copy")))?,
        &PredefinedMenuItem::paste(app, Some(&text("粘贴", "Paste")))?,
        &PredefinedMenuItem::select_all(app, Some(&text("全选", "Select All")))?,
    ])?)?;
    let theme = Submenu::with_items(app, text("主题", "Theme"), true, &[
        &check("theme-light", "浅色", "Light", state.theme == "light")?,
        &check("theme-dark", "深色", "Dark", state.theme != "light")?,
    ])?;
    menu.append(&Submenu::with_items(app, text("显示", "View"), true, &[
        &theme,
        &item("font-increase", "增大字号", "Increase Font Size", state.font_scale < 1.4, Some("CmdOrCtrl+Shift+="))?,
        &item("font-decrease", "减小字号", "Decrease Font Size", state.font_scale > 0.8, Some("CmdOrCtrl+-"))?,
        &item("font-reset", "重置字号", "Reset Font Size", true, Some("CmdOrCtrl+0"))?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::separator(app)?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::fullscreen(app, Some(&text("进入全屏幕", "Enter Full Screen")))?,
    ])?)?;
    menu.append(&Submenu::with_items(app, text("工具", "Tools"), true, &[
        &item("dice", "骰子", "Dice", state.project_open, None)?,
        &check("dice-mute", "骰子静音", "Mute Dice", state.dice_muted)?,
        &PredefinedMenuItem::separator(app)?,
        &item("models", "模型与代理配置…", "Models and Proxies…", true, None)?,
    ])?)?;
    menu.append(&Submenu::with_id_and_items(app, WINDOW_SUBMENU_ID, text("窗口", "Window"), true, &[
        &PredefinedMenuItem::minimize(app, Some(&text("最小化", "Minimize")))?,
        &PredefinedMenuItem::maximize(app, Some(&text("缩放", "Zoom")))?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::separator(app)?,
        #[cfg(target_os = "macos")]
        &PredefinedMenuItem::bring_all_to_front(app, Some(&text("前置全部窗口", "Bring All to Front")))?,
    ])?)?;
    let guides = Submenu::with_items(app, text("工具文档", "Tool Guides"), true, &[
        &item("help:scenario", "模组工具", "Scenario Tool", true, None)?,
        &item("help:copilot", "KP Copilot", "KP Copilot", true, None)?,
        &item("help:character", "角色工具", "Character Tool", true, None)?,
        &item("help:dice", "骰子工具", "Dice Tool", true, None)?,
    ])?;
    menu.append(&Submenu::with_id_and_items(app, HELP_SUBMENU_ID, text("帮助", "Help"), true, &[
        &item("help:quick-start", "快速上手", "Quick Start", true, None)?,
        &item("help:README", "文档目录", "Documentation", true, None)?,
        &item("help:prep-and-play", "备团与跑团", "Prep and Play", true, None)?,
        &guides,
        &PredefinedMenuItem::separator(app)?,
        &item("github", "GitHub 项目主页", "GitHub Project", true, None)?,
        &item("feedback", "反馈问题…", "Report an Issue…", true, None)?,
    ])?)?;
    Ok(menu)
}

#[tauri::command]
pub fn update_app_menu(app: AppHandle, state: MenuState) -> Result<(), String> {
    let menu = build(&app, &state).map_err(|err| err.to_string())?;
    *app.state::<MenuContext>().state.lock().map_err(|_| "menu busy")? = state;
    app.set_menu(menu).map_err(|err| err.to_string())?;
    Ok(())
}

pub fn update_save_enabled(app: &AppHandle) {
    let Some(menu) = app.menu() else { return };
    let Some(file) = menu.get("file-menu") else { return };
    let Some(file) = file.as_submenu() else { return };
    let Some(save) = file.get("save-form") else { return };
    if let Some(item) = save.as_menuitem() {
        let _ = item.set_enabled(can_save(app, current(app).can_save));
    }
}

#[tauri::command]
pub fn open_utility(app: AppHandle, kind: String, page: Option<String>) -> Result<(), String> {
    if !["about", "settings", "help", "models"].contains(&kind.as_str()) { return Err("unknown utility".into()); }
    let page = page.filter(|page| ["README", "quick-start", "prep-and-play", "scenario", "copilot", "character", "dice"].contains(&page.as_str())).unwrap_or_else(|| "README".into());
    let state = current(&app);
    let label = format!("utility-{kind}");
    if let Some(window) = app.get_webview_window(&label) {
        if kind == "help" { let _ = window.emit("ek:help-page", &page); }
        let _ = window.unminimize();
        return window.set_focus().map_err(|err| err.to_string());
    }
    let (width, height) = match kind.as_str() { "help" => (980.0, 760.0), "models" => (580.0, 680.0), "settings" => (480.0, 430.0), _ => (480.0, 360.0) };
    let title = match kind.as_str() { "help" => "EasyKeeper — Help", "settings" => "EasyKeeper — Settings", "models" => "EasyKeeper — Models", _ => "About EasyKeeper" };
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(format!("utility.html?kind={kind}&page={page}").into()))
        .title(title).inner_size(width, height).min_inner_size(360.0, 300.0).center()
        .initialization_script(format!("window.__EK_LOCALE__ = {};", serde_json::to_string(&state.locale).unwrap()))
        .build().map_err(|err| err.to_string())?;
    Ok(())
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    app.set_menu(build(app, &MenuState::default())?)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            super::QUIT_ID => { if super::start_close_flush(app, true) { app.exit(0); } }
            "about" | "settings" | "models" => { let _ = open_utility(app.clone(), id.into(), None); }
            "github" => { let _ = super::open_http_url(GITHUB.into()); }
            "feedback" => { let _ = super::open_http_url(format!("{GITHUB}/issues")); }
            _ if id.starts_with("help:") => { let _ = open_utility(app.clone(), "help".into(), Some(id[5..].into())); }
            _ => {
                if id == "save-form" {
                    let target = focused_utility(app).unwrap_or_else(|| "main".into());
                    let _ = app.emit_to(&target, "ek:save-form", ());
                    return;
                }
                let recent = id.strip_prefix("recent-").and_then(|index| index.parse::<usize>().ok())
                    .and_then(|index| current(app).recent.get(index).cloned());
                let action = MenuAction { id: id.into(), path: recent.as_ref().map(|entry| entry.path.clone()), kind: recent.map(|entry| entry.kind) };
                if let Some(main) = app.get_webview_window("main") {
                    if !id.starts_with("theme-") && !id.starts_with("font-") && id != "dice-mute" {
                        let _ = main.unminimize();
                        let _ = main.set_focus();
                    }
                    let _ = main.emit("ek:menu-action", action);
                }
            }
        }
    });
    Ok(())
}
