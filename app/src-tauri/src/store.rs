use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::subscription::Profile;

/// Everything the app needs to work without any external program.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppState {
    pub profiles: Vec<Profile>,
    pub sub_url: String,
    pub sub_ua: String,
    pub selected: String,
    pub split: Vec<SplitEntry>,
    pub zapret_dir: String,
    pub zapret_preset: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitEntry {
    pub exe: String,
    pub via: bool,
}

pub fn state_path(data_dir: &Path) -> PathBuf {
    data_dir.join("state.json")
}

pub fn load(data_dir: &Path) -> AppState {
    std::fs::read_to_string(state_path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(data_dir: &Path, state: &AppState) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("не удалось создать каталог данных: {e}"))?;
    let tmp = state_path(data_dir).with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| format!("не удалось сохранить настройки: {e}"))?;
    std::fs::rename(&tmp, state_path(data_dir))
        .map_err(|e| format!("не удалось заменить настройки: {e}"))
}

/// Last `lines` lines of one of our own log files. Never reads foreign programs.
pub fn tail(data_dir: &Path, which: &str, lines: usize) -> String {
    let name = match which {
        "zapret" => "zapret.log",
        _ => "engine.log",
    };
    let path = data_dir.join("logs").join(name);
    let Ok(text) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Profile {
        Profile {
            id: "a".into(),
            name: "A".into(),
            host: "example.com".into(),
            port: 443,
            uuid: "u".into(),
            flow: String::new(),
            security: "tls".into(),
            network: "tcp".into(),
            sni: String::new(),
            public_key: String::new(),
            short_id: String::new(),
            fingerprint: String::new(),
        }
    }

    #[test]
    fn round_trips_state() {
        let dir = std::env::temp_dir().join("k4r-state-test");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::default();
        st.profiles.push(sample());
        st.sub_ua = "K4R-Neko-VPN/0.1".into();
        st.split.push(SplitEntry {
            exe: "steam.exe".into(),
            via: false,
        });
        save(&dir, &st).unwrap();

        let back = load(&dir);
        assert_eq!(back.profiles.len(), 1);
        assert_eq!(back.sub_ua, "K4R-Neko-VPN/0.1");
        assert_eq!(back.split[0].exe, "steam.exe");
        assert!(!back.split[0].via);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_state_is_not_an_error() {
        let dir = std::env::temp_dir().join("k4r-state-missing");
        let st = load(&dir);
        assert!(st.profiles.is_empty());
    }

    #[test]
    fn tail_returns_empty_for_unknown_log() {
        let dir = std::env::temp_dir().join("k4r-logs-missing");
        assert_eq!(tail(&dir, "engine", 10), "");
    }
}
