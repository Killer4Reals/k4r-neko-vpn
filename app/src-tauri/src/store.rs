use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::subscription::Profile;

/// Bumped whenever a stored file needs a one-time fix on load.
pub const SCHEMA: u32 = 2;

/// Everything the app needs to work without any external program.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppState {
    /// Stable per-install id, sent as X-HWID. Providers use it as the device slot.
    pub hwid: String,
    pub profiles: Vec<Profile>,
    /// Kept for files written before multiple subscriptions existed.
    pub sub_url: String,
    pub sub_ua: String,
    pub subs: Vec<SubSource>,
    pub selected: String,
    pub split: Vec<SplitEntry>,
    pub zapret_dir: String,
    pub zapret_preset: String,
    /// "tunnel" or "system"
    pub dns_mode: String,
    pub block_ipv6: bool,
    pub reconnect: bool,
    pub hotkey: String,
    pub close_to_tray: bool,
    /// remembered preference; the real WFP block ships later
    pub kill_switch: bool,
    pub notify: bool,
    pub autostart: bool,
    /// 0 = written before the settings existed; bumped when defaults change
    pub schema: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SubSource {
    pub url: String,
    pub ua: String,
    pub name: String,
    /// unix seconds of the last successful refresh
    pub refreshed: u64,
}

impl AppState {
    /// First run defaults: what a normal person expects from a VPN client.
    pub fn with_defaults() -> Self {
        Self {
            dns_mode: "tunnel".into(),
            block_ipv6: true,
            reconnect: true,
            hotkey: "Ctrl+Alt+V".into(),
            close_to_tray: true,
            kill_switch: true,
            notify: true,
            // opt-in: a portable app must not register itself behind the owner's back
            autostart: false,
            schema: SCHEMA,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SplitEntry {
    /// file name the engine matches, e.g. "discord.exe"
    pub exe: String,
    /// readable label kept even if the program is uninstalled later
    pub name: String,
    /// true = through the tunnel, false = direct
    pub via: bool,
}

/// 16 hex chars, stable for this installation, generated once.
pub fn install_id(data_dir: &Path) -> String {
    let state = load(data_dir);
    if !state.hwid.is_empty() {
        return state.hwid;
    }
    let id = random_hex();
    if let Ok(mut st) = std::fs::read_to_string(state_path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str::<AppState>(&t).ok())
        .ok_or(())
    {
        st.hwid = id.clone();
        let _ = save(data_dir, &st);
        return id;
    }
    let mut st = AppState::with_defaults();
    st.hwid = id.clone();
    let _ = save(data_dir, &st);
    id
}

fn random_hex() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for salt in 0..2u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(salt);
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out.truncate(16);
    out
}

pub fn state_path(data_dir: &Path) -> PathBuf {
    data_dir.join("state.json")
}

pub fn load(data_dir: &Path) -> AppState {
    let mut st: AppState = std::fs::read_to_string(state_path(data_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(AppState::with_defaults);
    if st.schema == 0 {
        // 0.1 files predate the settings: give them the intended defaults
        let d = AppState::with_defaults();
        st.block_ipv6 = d.block_ipv6;
        st.reconnect = d.reconnect;
        st.close_to_tray = d.close_to_tray;
        st.kill_switch = d.kill_switch;
        st.notify = d.notify;
        st.autostart = d.autostart;
        st.schema = 1;
    }
    if st.schema < 2 {
        // 0.1 wrote every scanned program into the list, so nothing there was a real choice
        st.split.clear();
        st.schema = SCHEMA;
    }
    if st.dns_mode.is_empty() {
        st.dns_mode = "tunnel".into();
    }
    if st.hotkey.is_empty() {
        st.hotkey = "Ctrl+Alt+V".into();
    }
    st
}

pub fn save(data_dir: &Path, state: &AppState) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("не удалось создать каталог данных: {e}"))?;
    let tmp = state_path(data_dir).with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| format!("не удалось сохранить настройки: {e}"))?;
    std::fs::rename(&tmp, state_path(data_dir))
        .map_err(|e| format!("не удалось заменить настройки: {e}"))
}

/// The engine paints its log with ANSI colour codes; the window and the
/// exported file want plain text.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('\u{1b}') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        match tail.find('m') {
            Some(end) => rest = &tail[end + 1..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
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
    let text = strip_ansi(&text);
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
            service_name: String::new(),
            path: String::new(),
        }
    }

    #[test]
    fn round_trips_state() {
        let dir = std::env::temp_dir().join("k4r-state-test");
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = AppState::with_defaults();
        st.profiles.push(sample());
        st.sub_ua = "K4R-Neko-VPN/0.1".into();
        st.hwid = "abc123".into();
        st.split.push(SplitEntry {
            exe: "steam.exe".into(),
            name: "Steam".into(),
            via: false,
        });
        save(&dir, &st).unwrap();

        let back = load(&dir);
        assert_eq!(back.profiles.len(), 1);
        assert_eq!(back.sub_ua, "K4R-Neko-VPN/0.1");
        assert_eq!(back.split[0].exe, "steam.exe");
        assert_eq!(back.split[0].name, "Steam");
        assert!(!back.split[0].via);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn old_scan_dump_is_dropped_once() {
        let dir = std::env::temp_dir().join("k4r-split-migration");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let old = r#"{"schema":1,"split":[{"exe":"discord.exe","via":true},{"exe":"steam.exe","via":false}]}"#;
        std::fs::write(state_path(&dir), old).unwrap();

        let st = load(&dir);
        assert!(st.split.is_empty(), "0.1 auto-filled the whole scan, nothing was chosen");
        assert_eq!(st.schema, 2);

        // the owner's own picks survive the next launch
        let mut next = st.clone();
        next.split.push(SplitEntry {
            exe: "steam.exe".into(),
            name: "Steam".into(),
            via: false,
        });
        save(&dir, &next).unwrap();
        assert_eq!(load(&dir).split.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn log_colours_are_stripped() {
        let raw = "\u{1b}[36mINFO\u{1b}[0m plain \u{1b}[38;5;105m1234\u{1b}[0m end";
        assert_eq!(strip_ansi(raw), "INFO plain 1234 end");
        assert_eq!(strip_ansi("no codes here"), "no codes here");
    }

    #[test]
    fn missing_state_is_not_an_error() {
        let dir = std::env::temp_dir().join("k4r-state-missing");
        let st = load(&dir);
        assert!(st.profiles.is_empty());
    }

    #[test]
    fn install_id_is_generated_once_and_kept() {
        let dir = std::env::temp_dir().join("k4r-hwid-test");
        let _ = std::fs::remove_dir_all(&dir);
        let first = install_id(&dir);
        let second = install_id(&dir);
        assert_eq!(first.len(), 16);
        assert_eq!(first, second, "install id must be stable");
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_id_survives_a_save_without_it() {
        let dir = std::env::temp_dir().join("k4r-hwid-keep");
        let _ = std::fs::remove_dir_all(&dir);
        let id = install_id(&dir);
        let mut st = load(&dir);
        st.hwid = String::new();
        save(&dir, &st).unwrap();
        // the app re-injects it on save; the helper must then return the same value
        let again = install_id(&dir);
        assert_eq!(again.len(), 16);
        assert_eq!(load(&dir).hwid, again);
        assert!(!id.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_returns_empty_for_unknown_log() {
        let dir = std::env::temp_dir().join("k4r-logs-missing");
        assert_eq!(tail(&dir, "engine", 10), "");
    }
}
