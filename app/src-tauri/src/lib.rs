// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod engine;
pub mod probe;
pub mod store;
pub mod subscription;
pub mod zapret;

use serde::Serialize;
use std::path::PathBuf;
use probe::PingResult;
use store::AppState;
use subscription::{Profile, SubHeader, SubResult};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};
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
fn profiles_import(text: String) -> Result<Vec<Profile>, String> {
    subscription::import_text(&text)
}

#[tauri::command]
fn probe_ping(profiles: Vec<Profile>) -> Vec<PingResult> {
    probe::ping_all(&profiles)
}

#[tauri::command]
fn state_load(app: tauri::AppHandle) -> Result<AppState, String> {
    Ok(store::load(&data_dir(&app)?))
}

#[tauri::command]
fn state_save(app: tauri::AppHandle, mut state: AppState) -> Result<(), String> {
    let dir = data_dir(&app)?;
    // Never lose the install id: it is our device slot with the provider.
    if state.hwid.is_empty() {
        state.hwid = store::install_id(&dir);
    }
    store::save(&dir, &state)
}

#[tauri::command]
fn logs_tail(app: tauri::AppHandle, which: String, lines: usize) -> Result<String, String> {
    Ok(store::tail(&data_dir(&app)?, &which, lines.clamp(10, 500)))
}

#[derive(Serialize, Clone)]
pub struct InstalledApp {
    pub exe: String,
    pub name: String,
    pub path: String,
    pub running: bool,
}

/// Running process names, lowercased. Empty when tasklist is unavailable.
fn running_processes() -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let Ok(res) = std::process::Command::new("tasklist")
        .args(["/fo", "csv", "/nh"])
        .output()
    else {
        return out;
    };
    for line in String::from_utf8_lossy(&res.stdout).lines() {
        if let Some(first) = line.split("\",\"").next() {
            let name = first.trim_matches('"').trim().to_lowercase();
            if !name.is_empty() {
                out.insert(name);
            }
        }
    }
    out
}

/// Executables Windows itself knows about (App Paths), plus what is running now.
#[tauri::command]
fn apps_scan() -> Vec<InstalledApp> {
    scan_installed()
}

/// Programs the user actually has open: what split tunneling is about.
fn running_apps() -> Vec<(String, String)> {
    let Ok(res) = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Process | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique",
        ])
        .output()
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in String::from_utf8_lossy(&res.stdout).lines() {
        let path = line.trim();
        let lower = path.to_lowercase();
        if !lower.ends_with(".exe") || lower.contains("\\windows\\") {
            continue; // system processes are noise, never the user's apps
        }
        let exe = path.rsplit('\\').next().unwrap_or(path).to_lowercase();
        out.push((exe, path.to_string()));
    }
    out
}

pub fn scan_installed() -> Vec<InstalledApp> {
    use std::collections::BTreeMap;
    let running = running_processes();
    let mut found: BTreeMap<String, InstalledApp> = BTreeMap::new();

    for (exe, path) in running_apps() {
        found.entry(exe.clone()).or_insert(InstalledApp {
            running: true,
            name: exe.trim_end_matches(".exe").to_string(),
            exe,
            path,
        });
    }

    let roots = [
        (winreg::enums::HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg::enums::HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
    ];
    for (root, key_path) in roots {
        let Ok(key) = RegKey::predef(root).open_subkey(key_path) else {
            continue;
        };
        for sub in key.enum_keys().flatten() {
            let Ok(app) = key.open_subkey(&sub) else { continue };
            let path: String = app.get_value::<String, _>("").unwrap_or_default();
            let exe = sub.to_lowercase();
            if !exe.ends_with(".exe") || path.trim().is_empty() {
                continue;
            }
            found.entry(exe.clone()).or_insert(InstalledApp {
                running: running.contains(&exe),
                name: exe.trim_end_matches(".exe").to_string(),
                exe,
                path,
            });
        }
    }
    found.into_values().collect()
}

/// One readable file the user can hand over when something breaks.
#[tauri::command]
fn export_log(app: tauri::AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let out_dir = dir.join("exports");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = out_dir.join(format!("k4r-log-{stamp}.txt"));
    let mut text = String::new();
    text.push_str("K4R Neko VPN — журнал для поддержки
");
    text.push_str(&format!("версия: {}
", env!("CARGO_PKG_VERSION")));
    text.push_str(&format!("админ: {}
", engine::is_elevated()));
    text.push_str("
--- engine.log ---
");
    text.push_str(&store::tail(&dir, "engine", 400));
    text.push_str("

--- zapret.log ---
");
    text.push_str(&store::tail(&dir, "zapret", 200));
    // never include the subscription url or ids here
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn set_start_with_windows(enabled: bool) -> Result<bool, String> {
    set_autostart(enabled)?;
    Ok(autostart_enabled())
}

/// Providers that gate on a device id get ours: stable per install, never impersonates
/// another client's identity.
#[tauri::command]
async fn sub_fetch(
    app: tauri::AppHandle,
    url: String,
    user_agent: String,
    headers: Vec<SubHeader>,
) -> Result<SubResult, String> {
    let hwid = store::install_id(&data_dir(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let mut all = headers;
        if !all.iter().any(|h| h.name.eq_ignore_ascii_case("x-hwid")) {
            all.push(SubHeader {
                name: "X-HWID".into(),
                value: hwid,
            });
        }
        subscription::fetch(&url, &user_agent, &all)
    })
    .await
    .map_err(|e| format!("задача упала: {e}"))?
}

#[tauri::command]
fn install_id(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store::install_id(&data_dir(&app)?))
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

    let saved = store::load(&data_dir(&app)?);
    let opts = engine::NetOptions {
        dns_mode: if saved.dns_mode.is_empty() { "tunnel".into() } else { saved.dns_mode },
        block_ipv6: saved.block_ipv6,
        dns_server: if dns.trim().is_empty() {
            "1.1.1.1".to_string()
        } else {
            dns.trim().to_string()
        },
    };

    let config = engine::build_config(&profile, &excluded, &opts);
    let status = engine::start(&engine, &bin, &config, &log_path, &profile.name)?;
    supervise(app, saved.reconnect);
    Ok(status)
}

/// Watches the engine: three silent retries, then an honest error in the UI.
fn supervise(app: tauri::AppHandle, reconnect: bool) {
    std::thread::spawn(move || {
        let engine = app.state::<engine::Engine>();
        let mut attempts: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            if !engine.wanted.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let st = engine::poll(&engine);
            match st.state {
                engine::EngineState::Idle => break,
                engine::EngineState::Error if reconnect && attempts < 3 => {
                    attempts += 1;
                    let _ = app.emit(
                        "engine-event",
                        engine::EngineStatus {
                            state: engine::EngineState::Starting,
                            message: format!("переподключаемся ({attempts}/3)"),
                            server: st.server.clone(),
                            pid: 0,
                        },
                    );
                    std::thread::sleep(std::time::Duration::from_millis(1400));
                    if !engine.wanted.load(std::sync::atomic::Ordering::SeqCst) {
                        break;
                    }
                    let bin = engine::sidecar_path(&resources_dir(&app));
                    let log_path = match data_dir(&app) {
                        Ok(d) => d.join("logs").join("engine.log"),
                        Err(_) => break,
                    };
                    match engine::respawn(&engine, &bin, &log_path, &st.server) {
                        Ok(ok) => {
                            attempts = 0;
                            let _ = app.emit("engine-event", ok);
                        }
                        Err(e) => {
                            let _ = app.emit(
                                "engine-event",
                                engine::EngineStatus {
                                    state: engine::EngineState::Error,
                                    message: format!("переподключение не удалось: {e}"),
                                    server: st.server.clone(),
                                    pid: 0,
                                },
                            );
                        }
                    }
                }
                engine::EngineState::Error => {
                    let _ = app.emit("engine-event", st);
                    break;
                }
                _ => {
                    attempts = 0;
                }
            }
        }
    });
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(engine::Engine::default())
        .manage(zapret::Zapret::default())
        .setup(|app| {
            build_tray(app.handle())?;
            // the X button hides to tray unless the user asked for a real quit
            if let Some(win) = app.get_webview_window("main") {
                let target = win.clone();
                let handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let to_tray = data_dir(&handle)
                            .map(|d| store::load(&d).close_to_tray)
                            .unwrap_or(true);
                        if to_tray {
                            api.prevent_close();
                            let _ = target.hide();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_info,
            set_start_with_windows,
            sub_fetch,
            install_id,
            profiles_import,
            probe_ping,
            state_load,
            state_save,
            logs_tail,
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
            set_tray_state,
            apps_scan,
            export_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running K4R Neko VPN");
}
