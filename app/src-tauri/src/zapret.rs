use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use crate::engine::is_elevated;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ZapretState {
    Off,
    Running,
    External,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZapretStatus {
    pub state: ZapretState,
    pub message: String,
    pub preset: String,
    pub pid: u32,
    pub dir: String,
}

impl Default for ZapretStatus {
    fn default() -> Self {
        Self {
            state: ZapretState::Off,
            message: String::new(),
            preset: String::new(),
            pid: 0,
            dir: String::new(),
        }
    }
}

pub struct Zapret {
    pub status: Mutex<ZapretStatus>,
    pub child: Mutex<Option<Child>>,
}

impl Default for Zapret {
    fn default() -> Self {
        Self {
            status: Mutex::new(ZapretStatus::default()),
            child: Mutex::new(None),
        }
    }
}

/// Zapret 2 Dev keeps binaries, presets and lists side by side.
pub fn looks_like_zapret(dir: &Path) -> bool {
    dir.join("exe").join("winws2.exe").exists() || dir.join("exe").join("winws.exe").exists()
}

pub fn detect_dir() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(home) = std::env::var("USERPROFILE") {
        candidates.push(PathBuf::from(&home).join("Documents").join("Zapret").join("Dev"));
        candidates.push(PathBuf::from(&home).join("Documents").join("Zapret"));
        candidates.push(PathBuf::from(&home).join("Downloads").join("Zapret").join("Dev"));
    }
    for drive in ["C:", "D:", "E:"] {
        candidates.push(PathBuf::from(format!("{drive}\\Zapret\\Dev")));
        candidates.push(PathBuf::from(format!("{drive}\\Zapret")));
    }
    candidates.push(PathBuf::from("C:\\Program Files\\Zapret"));

    candidates.into_iter().find(|p| looks_like_zapret(p))
}

pub fn preset_dir(dir: &Path) -> PathBuf {
    let dev = dir.join("presets").join("winws2_builtin");
    if dev.exists() {
        return dev;
    }
    dir.join("presets").join("winws1_builtin")
}

pub fn list_presets(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(preset_dir(dir)) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("txt") {
                if let Some(name) = p.file_name().and_then(|x| x.to_str()) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out.sort();
    out
}

/// Preset files are plain arg lists: one argument per line, `--new` starts a profile.
pub fn args_from_preset(path: &Path) -> Result<Vec<String>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("пресет не читается: {e}"))?;
    let mut args = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_start_matches('\u{feff}').trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        args.push(line.to_string());
    }
    if args.is_empty() {
        return Err("пресет пустой".into());
    }
    Ok(args)
}

/// A foreign winws2 (e.g. the Zapret GUI the owner is using) must never be touched.
pub fn external_instance_running() -> bool {
    let Ok(out) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq winws2.exe", "/NH"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&out.stdout).to_lowercase().contains("winws2")
}

pub fn start(
    zapret: &Zapret,
    dir: &Path,
    preset_name: &str,
    log_path: &Path,
) -> Result<ZapretStatus, String> {
    if !looks_like_zapret(dir) {
        return Err(format!(
            "в папке {} нет winws2.exe — укажи папку Zapret 2 Dev",
            dir.display()
        ));
    }
    if external_instance_running() {
        let status = ZapretStatus {
            state: ZapretState::External,
            message: "Zapret уже запущен другой программой. Мы его не трогаем: останови его сам, если хочешь управлять из этого приложения.".into(),
            preset: preset_name.to_string(),
            pid: 0,
            dir: dir.display().to_string(),
        };
        *zapret.status.lock().unwrap() = status.clone();
        return Ok(status);
    }
    if !is_elevated() {
        return Err("Zapret требует прав администратора: перезапусти приложение от имени администратора".into());
    }

    let preset_path = preset_dir(dir).join(preset_name);
    let args = args_from_preset(&preset_path)?;

    let exe_name = if dir.join("exe").join("winws2.exe").exists() {
        "winws2.exe"
    } else {
        "winws.exe"
    };

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|e| format!("не удалось открыть журнал Zapret: {e}"))?;

    let mut child = Command::new(dir.join("exe").join(exe_name))
        .args(&args)
        .current_dir(dir)
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("winws2 не запустился: {e}"))?;

    std::thread::sleep(std::time::Duration::from_millis(1200));
    if let Ok(Some(code)) = child.try_wait() {
        return Err(format!(
            "winws2 завершился с кодом {code} — проверь пресет и занятость WinDivert"
        ));
    }

    let status = ZapretStatus {
        state: ZapretState::Running,
        message: "пресет активен".into(),
        preset: preset_name.to_string(),
        pid: child.id(),
        dir: dir.display().to_string(),
    };
    *zapret.child.lock().unwrap() = Some(child);
    *zapret.status.lock().unwrap() = status.clone();
    Ok(status)
}

pub fn stop(zapret: &Zapret) -> ZapretStatus {
    if let Some(mut child) = zapret.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let status = ZapretStatus::default();
    *zapret.status.lock().unwrap() = status.clone();
    status
}

pub fn poll(zapret: &Zapret) -> ZapretStatus {
    let mut guard = zapret.child.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if let Ok(Some(code)) = child.try_wait() {
            let mut st = zapret.status.lock().unwrap();
            st.state = ZapretState::Error;
            st.message = format!("winws2 остановился (код {code})");
            *guard = None;
        }
    }
    zapret.status.lock().unwrap().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner_dir() -> PathBuf {
        PathBuf::from(r"C:\Users\user\Documents\Zapret\Dev")
    }

    #[test]
    fn parses_the_owners_active_preset() {
        let dir = owner_dir();
        let preset = preset_dir(&dir).join("general ALT9 1.10.3 (game filter).txt");
        if !preset.exists() {
            return;
        }
        let args = args_from_preset(&preset).unwrap();
        assert!(args.len() > 20, "preset looks too small: {}", args.len());
        assert!(args.iter().any(|a| a == "--new"), "profile separator missing");
        assert!(args.iter().any(|a| a.starts_with("--lua-desync=")));
        assert!(args.iter().any(|a| a.starts_with("--wf-tcp-out=")));
        assert!(!args.iter().any(|a| a.starts_with('#')));
    }

    #[test]
    fn lists_presets_and_finds_the_dev_folder() {
        let dir = owner_dir();
        if !dir.exists() {
            return;
        }
        assert!(looks_like_zapret(&dir));
        let presets = list_presets(&dir);
        assert!(presets.len() > 10, "expected many presets, got {}", presets.len());
        assert!(presets.contains(&"general ALT9 1.10.3 (game filter).txt".to_string()));
    }

    #[test]
    fn rejects_empty_preset() {
        let p = std::env::temp_dir().join("k4r-empty-preset.txt");
        std::fs::write(&p, "# commentary only\n\n").unwrap();
        assert!(args_from_preset(&p).is_err());
        let _ = std::fs::remove_file(&p);
    }
}
