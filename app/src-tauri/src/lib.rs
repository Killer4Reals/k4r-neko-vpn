// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod subscription;

use serde::Serialize;
use std::path::PathBuf;
use subscription::{Profile, SubHeader, SubResult};
use tauri::{Manager, State};

#[derive(Serialize, Clone)]
pub struct CoreInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub data_dir: String,
    pub admin: bool,
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

#[tauri::command]
fn core_info(app: tauri::AppHandle) -> Result<CoreInfo, String> {
    Ok(CoreInfo {
        name: "K4R Neko VPN".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        data_dir: data_dir(&app)?.display().to_string(),
        admin: engine::is_elevated(),
    })
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
        if dns.trim().is_empty() {
            "1.1.1.1"
        } else {
            dns.trim()
        },
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
            &format!(
                "Start-Process -FilePath '{}' -Verb RunAs",
                exe.display()
            ),
        ])
        .spawn()
        .map_err(|e| format!("не удалось запросить повышение прав: {e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(engine::Engine::default())
        .invoke_handler(tauri::generate_handler![
            core_info,
            sub_fetch,
            engine_start,
            engine_stop,
            engine_status,
            app_is_admin,
            app_relaunch_admin
        ])
        .run(tauri::generate_context!())
        .expect("error while running K4R Neko VPN");
}
