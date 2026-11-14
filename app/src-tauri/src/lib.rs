// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod subscription;
mod zapret;

use serde::Serialize;
use std::path::PathBuf;
use subscription::{Profile, SubHeader, SubResult};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

#[derive(Serialize, Clone)]
pub struct CoreInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub data_dir: String,
    pub admin: bool,
    pub zapret_dir: Option<String>,
    pub autostart: bool,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))
}

fn resources_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"))
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "K4RNekoVPN";

fn autostart_enabled() -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, KEY_READ)
        .and_then(|k| k.get_value::<String, _>(RUN_VALUE))
        .is_ok()
}

fn set_autostart(enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_WRITE)
        .map_err(|e| format!("реестр недоступен: {e}"))?;
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        key.set_value(RUN_VALUE, &format!("\"{}\"", exe.display()))
            .map_err(|e| format!("не удалось включить автозапуск: {e}"))
    } else {
        let _ = key.delete_value(RUN_VALUE);
        Ok(())
    }
}

#[tauri::command]
fn core_info(app: tauri::AppHandle) -> Result<CoreInfo, String> {
    Ok(CoreInfo {
        name: "K4R Neko VPN".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        data_dir: data_dir(&app)?.display().to_string(),
        admin: engine::is_elevated(),
        zapret_dir: zapret::detect_dir().map(|p| p.display().to_string()),
        autostart: autostart_enabled(),
    })
}

#[tauri::command]
fn set_start_with_windows(enabled: bool) -> Result<bool, String> {
    set_autostart(enabled)?;
    Ok(autostart_enabled())
}

#[tauri::command]
async fn sub_fetch(
    url: String,
    user_agent: String,
    headers: Vec<SubHeader>,
) -> Result<SubResult, String> {
    tauri::async_runtime::spawn_blocking(move || subscription::fetch(&url, &user_agent, &headers))
        .await
        .map_err(|e| format!("задача упала: {e}"))?
}

#[tauri::command]
fn engine_start(
    app: tauri::AppHandle,
    engine: State<'_, engine::Engine>,
    profile: Profile,
    excluded: Vec<String>,
    dns: String,
) -> Result<engine::EngineStatus, String> {
    let bin = engine::sidecar_path(&resources_dir(&app));
    let log_path = data_dir(&app)?.join("logs").join("engine.log");
    engine::write_log_header(
        &log_path,
        &format!("start {}:{} ({})", profile.host, profile.port, profile.name),
    );

    let config = engine::build_config(
        &profile,
        &excluded,
        if dns.trim().is_empty() { "1.1.1.1" } else { dns.trim() },
    );

    engine::start(&engine, &bin, &config, &log_path, &profile.name)
}

#[tauri::command]
fn engine_stop(engine: State<'_, engine::Engine>) -> engine::EngineStatus {
    engine::stop(&engine)
}

#[tauri::command]
fn engine_status(engine: State<'_, engine::Engine>) -> engine::EngineStatus {
    engine::poll(&engine)
}

#[tauri::command]
fn app_is_admin() -> bool {
    engine::is_elevated()
}

#[tauri::command]
fn app_relaunch_admin(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display()),
        ])
        .spawn()
        .map_err(|e| format!("не удалось запросить повышение прав: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn zapret_detect() -> Option<String> {
    zapret::detect_dir().map(|p| p.display().to_string())
}

#[tauri::command]
fn zapret_presets(dir: String) -> Vec<String> {
    zapret::list_presets(&PathBuf::from(dir))
}

#[tauri::command]
fn zapret_status(
    app: tauri::AppHandle,
    state: State<'_, zapret::Zapret>,
) -> zapret::ZapretStatus {
    let status = zapret::poll(&state);
    if status.state == zapret::ZapretState::Off && zapret::external_instance_running() {
        return zapret::ZapretStatus {
            state: zapret::ZapretState::External,
            message: "Zapret уже запущен другой программой — мы его не трогаем".into(),
            preset: String::new(),
            pid: 0,
            dir: zapret::detect_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_default(),
        };
    }
    let _ = app;
    status
}

#[tauri::command]
fn zapret_start(
    app: tauri::AppHandle,
    state: State<'_, zapret::Zapret>,
    dir: String,
    preset: String,
) -> Result<zapret::ZapretStatus, String> {
    let log_path = data_dir(&app)?.join("logs").join("zapret.log");
    zapret::start(&state, &PathBuf::from(dir), &preset, &log_path)
}

#[tauri::command]
fn zapret_stop(state: State<'_, zapret::Zapret>) -> zapret::ZapretStatus {
    zapret::stop(&state)
}

#[tauri::command]
fn set_tray_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let bytes: &[u8] = match state.as_str() {
        "on" => include_bytes!("../icons/tray/tray_on_32.png"),
        "connecting" => include_bytes!("../icons/tray/tray_connecting_32.png"),
        "error" => include_bytes!("../icons/tray/tray_error_32.png"),
        _ => include_bytes!("../icons/tray/tray_off_32.png"),
    };
    let icon = tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Показать окно", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray/tray_off_32.png"
        ))?)
        .tooltip("K4R Neko VPN")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(engine::Engine::default())
        .manage(zapret::Zapret::default())
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_info,
            set_start_with_windows,
            sub_fetch,
            engine_start,
            engine_stop,
            engine_status,
            app_is_admin,
            app_relaunch_admin,
            zapret_detect,
            zapret_presets,
            zapret_start,
            zapret_stop,
            zapret_status,
            set_tray_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running K4R Neko VPN");
}
