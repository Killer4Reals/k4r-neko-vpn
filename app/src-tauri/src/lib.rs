use serde::Serialize;
use tauri::Manager;
use std::path::PathBuf;

#[derive(Serialize, Clone)]
pub struct CoreInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    /// Where per-user data lives (profiles, logs). Mirrors what the service will use.
    pub data_dir: String,
}

#[tauri::command]
fn core_info(app: tauri::AppHandle) -> Result<CoreInfo, String> {
    let data_dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    Ok(CoreInfo {
        name: "K4R Neko VPN".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        data_dir: data_dir.display().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![core_info])
        .run(tauri::generate_context!())
        .expect("error while running K4R Neko VPN");
}
